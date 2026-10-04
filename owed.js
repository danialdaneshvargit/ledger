// owed.js — loaded after app.js (plain file, no base64 step).
// 1) Dashboard: the Monthly Spending chart replaces Highlights + Spending Pace.
// 2) Funds: "What I Owe" card, read from owed.txt in the repo root.

renderInsights = function () {};
renderPaceChart = function () { renderBarChart(); };

// Savings is money set aside, not spending — keep it out of the pie chart.
const _renderPieChartBase = renderPieChart;
renderPieChart = function (byCat) {
  const copy = { ...(byCat || {}) };
  delete copy['cat-savings'];
  return _renderPieChartBase(copy);
};

// ---- What I Owe (owed.txt in the repo root) -------------------------
// One upcoming payment / debt per line:
//   YYYY-MM-DD | What | Amount | Note (optional)
// The date is the DUE date. Lines starting with # are ignored.
// When something is paid, delete the line (or comment it out with #).

let owedState = { items: [], loaded: false, error: null };

function parseOwedText(text) {
  const items = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) return;
    const parts = line.split('|').map((x) => x.trim());
    if (parts.length < 3) return;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(parts[0]) ? parts[0] : null;
    const amount = parseFloat(String(parts[2]).replace(/[$,\s]/g, ''));
    if (!date || !Number.isFinite(amount)) return;
    items.push({ id: `owed-${i}`, date, what: parts[1] || 'Payment', amount: Math.abs(amount), note: parts.slice(3).join(' | ') });
  });
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

async function loadOwed() {
  if (!REMOTE_MODE) return;
  try {
    const res = await fetch(`owed.txt?_=${Date.now()}`, { cache: 'no-store' });
    if (res.status === 404) owedState = { items: [], loaded: true, error: null };
    else if (!res.ok) throw new Error(`HTTP ${res.status}`);
    else owedState = { items: parseOwedText(await res.text()), loaded: true, error: null };
  } catch (e) {
    owedState = { ...owedState, error: e.message };
  }
  try { localStorage.setItem('ledger_owed_cache', JSON.stringify(owedState.items)); } catch (_) { /* ignore */ }
  if (document.getElementById('page-reserves')?.classList.contains('active')) renderOwed();
}

function owedDaysLeft(iso) {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  const due = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due - today) / 86400000);
}

function renderOwed() {
  const el = document.getElementById('owed-list');
  if (!el) return;
  let items = owedState.items;
  if (!owedState.loaded && !items.length) {
    try { items = JSON.parse(localStorage.getItem('ledger_owed_cache') || '[]'); } catch (_) { items = []; }
  }
  const total = items.reduce((s, x) => s + x.amount, 0);
  const next = items[0];
  const rows = items.map((x) => {
    const days = owedDaysLeft(x.date);
    const urg = days < 0 ? 'overdue' : days <= 14 ? 'soon' : days <= 45 ? 'near' : 'later';
    const when = days < 0 ? `${-days} day${days === -1 ? '' : 's'} overdue`
      : days === 0 ? 'due today' : days === 1 ? 'due tomorrow' : `${days} days left`;
    return `
      <div class="owed-row owed-${urg}">
        <div class="owed-main">
          <span class="owed-what">${escapeHtml(x.what)}</span>
          ${x.note ? `<span class="owed-note">${escapeHtml(x.note)}</span>` : ''}
        </div>
        <div class="owed-side">
          <strong class="owed-amt">${formatMoney(x.amount)}</strong>
          <span class="owed-due">${formatDisplayDate(x.date)} · <span class="owed-when">${when}</span></span>
        </div>
      </div>`;
  }).join('');
  const sub = items.length
    ? `${items.length} payment${items.length === 1 ? '' : 's'} · ${formatMoney(total)} total${next ? ` · next due ${formatDisplayDate(next.date)}` : ''}`
    : 'Nothing owed right now';
  el.innerHTML = `
    <div class="card owed-card">
      <div class="owed-head">
        <div>
          <h2>What I Owe</h2>
          <p class="section-hint">${sub}</p>
        </div>
        ${items.length ? `<span class="owed-total">${formatMoney(total)}</span>` : ''}
      </div>
      ${items.length ? `<div class="owed-rows">${rows}</div>` : '<p class="empty-inline">All clear — tell Claude when something new comes up.</p>'}
      ${owedState.error ? `<p class="empty-inline">⚠ Couldn't refresh (${escapeHtml(owedState.error)}) — showing last copy.</p>` : ''}
    </div>`;
}


const _renderReservesBase = renderReserves;
renderReserves = function () { _renderReservesBase(); renderOwed(); };

const _syncInboxBase = syncInbox;
syncInbox = function (opts) { loadOwed(); return _syncInboxBase(opts); };
