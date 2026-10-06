// owed.js — loaded after app.js (plain file, no base64 step).
// Layout + money-planning add-on:
//   • Dashboard = Sep 2026 onward (Income + total Spent on top); History = everything before.
//   • Obligations page = fixed + temporary payments, what I owe, reserves, held/invested money.
//   • Data files (repo root, edited by Claude from the phone):
//       obligations.txt  recurring payments      owed.txt  balances still owed      reserves.txt  money set aside

const NEW_ERA_START = '2026-09';
let ledgerView = 'now'; // 'now' = Dashboard, 'history' = before Sep 2026
const eraOk = (m) => (ledgerView === 'history' ? m < NEW_ERA_START : m >= NEW_ERA_START);

// ---- Categories ------------------------------------------------------
(function () {
  const c = DEFAULT_CATEGORIES.find((x) => x.id === 'cat-to-go');
  if (c) c.name = 'Food & Coffee';
  DEFAULT_CATEGORIES.push(
    { id: 'cat-housing', name: 'Housing', emoji: '🏠', color: '#A2845E' },
    { id: 'cat-car', name: 'Car Costs', emoji: '🚙', color: '#64D2FF' },
  );
  Object.assign(CATEGORY_NAME_ALIASES, {
    'launch & coffee': 'cat-to-go', 'food & coffee': 'cat-to-go', 'food and coffee': 'cat-to-go',
    housing: 'cat-housing', 'car costs': 'cat-car', 'car cost': 'cat-car',
  });
})();
function ensureAddonCategories() {
  if (!Array.isArray(state.categories)) return;
  state.categories.forEach((c) => { if (c.id === 'cat-to-go') c.name = 'Food & Coffee'; });
  const have = new Set(state.categories.map((c) => c.id));
  DEFAULT_CATEGORIES.forEach((c) => {
    if ((c.id === 'cat-housing' || c.id === 'cat-car') && !have.has(c.id)) state.categories.push({ ...c });
  });
}

// ---- Text files: obligations.txt / owed.txt / reserves.txt ------------
let obligState = { items: [], loaded: false };
let owedState = { items: [], loaded: false, error: null };
let reservesState = { items: [], loaded: false };

const splitLine = (raw) => {
  const line = raw.trim();
  if (!line || line.startsWith('#') || line.startsWith('//')) return null;
  return line.split('|').map((x) => x.trim());
};
const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const num = (s) => parseFloat(String(s || '').replace(/[$,\s]/g, ''));

// Name | Amount | monthly or biweekly | First due date | fixed or temporary | match words
function parseObligations(text) {
  const items = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const p = splitLine(raw);
    if (!p || p.length < 5) return;
    const amount = num(p[1]);
    if (!Number.isFinite(amount) || !isISO(p[3])) return;
    items.push({
      id: `oblig-${i}`,
      name: p[0],
      amount: Math.abs(amount),
      schedule: /bi/i.test(p[2]) ? 'biweekly' : 'monthly',
      start: p[3],
      type: /temp/i.test(p[4]) ? 'temporary' : 'fixed',
      words: (p[5] || '').toLowerCase().split(',').map((w) => w.trim()).filter(Boolean),
    });
  });
  return items;
}

// YYYY-MM-DD | What | Amount | Note
function parseOwedText(text) {
  const items = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const p = splitLine(raw);
    if (!p || p.length < 3) return;
    const amount = num(p[2]);
    if (!isISO(p[0]) || !Number.isFinite(amount)) return;
    items.push({ id: `owed-${i}`, date: p[0], what: p[1] || 'Payment', amount: Math.abs(amount), note: p.slice(3).join(' | ') });
  });
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

// YYYY-MM-DD | What | +/-Amount | Where / note   (+ added, − used)
function parseReserves(text) {
  const items = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const p = splitLine(raw);
    if (!p || p.length < 3) return;
    const amount = num(p[2]);
    if (!isISO(p[0]) || !Number.isFinite(amount)) return;
    items.push({ id: `res-${i}`, date: p[0], what: p[1], amount, note: p.slice(3).join(' | ') });
  });
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

function readCache(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; }
}
function writeCache(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) { /* ignore */ }
}
(function hydrateFromCache() {
  obligState.items = readCache('ledger_oblig_cache') || [];
  owedState.items = readCache('ledger_owed_cache') || [];
  reservesState.items = readCache('ledger_reserves_cache') || [];
})();

async function fetchText(name) {
  const res = await fetch(`${name}?_=${Date.now()}`, { cache: 'no-store' });
  if (res.status === 404) return '';
  if (!res.ok) throw new Error(`${name} HTTP ${res.status}`);
  return res.text();
}

async function loadOwed() {
  if (!REMOTE_MODE) return;
  try {
    const [o, w, r] = await Promise.all([fetchText('obligations.txt'), fetchText('owed.txt'), fetchText('reserves.txt')]);
    obligState = { items: parseObligations(o), loaded: true };
    owedState = { items: parseOwedText(w), loaded: true, error: null };
    reservesState = { items: parseReserves(r), loaded: true };
    writeCache('ledger_oblig_cache', obligState.items);
    writeCache('ledger_owed_cache', owedState.items);
    writeCache('ledger_reserves_cache', reservesState.items);
  } catch (e) {
    owedState = { ...owedState, error: e.message };
  }
  const active = document.querySelector('.page.active')?.id;
  if (active === 'page-dashboard' || active === 'page-obligations') renderAll();
}

// ---- Obligation maths --------------------------------------------------
const pad2n = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad2n(d.getMonth() + 1)}-${pad2n(d.getDate())}`;
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

function obligDueDates(o, key) {
  const [y, m] = key.split('-').map(Number);
  if (key < o.start.slice(0, 7)) return [];
  if (o.schedule === 'monthly') {
    const last = new Date(y, m, 0).getDate();
    const day = Math.min(parseInt(o.start.slice(8, 10), 10), last);
    return [`${key}-${pad2n(day)}`];
  }
  const out = [];
  const d = parseISO(o.start);
  const end = new Date(y, m, 0);
  while (d <= end) {
    if (d.getFullYear() === y && d.getMonth() === m - 1) out.push(isoOf(d));
    d.setDate(d.getDate() + 14);
  }
  return out;
}

// Which obligation (if any) a transaction pays. Shared keywords (e.g. "apple")
// are told apart by the closest amount, within 15%.
function obligationFor(t) {
  if (t.type !== 'expense') return null;
  const desc = (t.description || '').toLowerCase();
  const cands = obligState.items.filter((o) => o.words.some((w) => desc.includes(w)));
  if (!cands.length) return null;
  if (cands.length === 1) return cands[0];
  const best = cands.map((o) => ({ o, diff: Math.abs(o.amount - t.amount) })).sort((a, b) => a.diff - b.diff)[0];
  return best.diff <= best.o.amount * 0.15 ? best.o : null;
}

function monthPlan(key) {
  const tx = getMonthTransactions(key);
  const current = monthKey();
  const rows = obligState.items.map((o) => {
    const due = obligDueDates(o, key);
    const paid = tx.filter((t) => obligationFor(t) === o);
    const paidAmt = paid.reduce((s, t) => s + t.amount, 0);
    const planned = o.amount * due.length;
    const counted = key < current ? (paidAmt || planned) : Math.max(paidAmt, planned);
    return { o, due, paid, paidAmt, planned, counted };
  }).filter((r) => r.due.length || r.paid.length);
  const obligTxIds = new Set();
  tx.forEach((t) => { if (obligationFor(t)) obligTxIds.add(t.id); });
  const income = sumByType(tx, 'income');
  const fixed = rows.filter((r) => r.o.type === 'fixed').reduce((s, r) => s + r.counted, 0);
  const temporary = rows.filter((r) => r.o.type === 'temporary').reduce((s, r) => s + r.counted, 0);
  const saved = tx.filter((t) => t.type === 'expense' && t.categoryId === 'cat-savings').reduce((s, t) => s + t.amount, 0);
  const spent = tx.filter((t) => t.type === 'expense' && t.categoryId !== 'cat-savings' && !obligTxIds.has(t.id))
    .reduce((s, t) => s + t.amount, 0);
  const surplus = income - fixed;
  return { key, rows, obligTxIds, income, fixed, temporary, saved, spent, surplus, left: surplus - temporary - spent - saved };
}

function fixedMonthlyAverage() {
  return obligState.items.filter((o) => o.type === 'fixed')
    .reduce((s, o) => s + (o.schedule === 'biweekly' ? (o.amount * 26) / 12 : o.amount), 0);
}

// Fixed costs I can't control — kept OUT of "Spent" and the pie, shown beside Income instead.
// Rent ($1,800) + truck ($342 × 2) + ICBC insurance (~$200) + Telus phone ≈ $2,900 a month.
const FIXED_COSTS_MONTHLY = 2900;
const FIXED_COST_OBLIGATIONS = /^(rent|truck financing|icbc|telus)/i;
function isFixedCost(t) {
  if (t.type !== 'expense') return false;
  if (t.categoryId === 'cat-housing' || t.categoryId === 'cat-car') return true;
  const o = obligationFor(t);
  return !!(o && FIXED_COST_OBLIGATIONS.test(o.name));
}

// ---- Dashboard / History split ---------------------------------------
const _getTransactionMonthsBase = getTransactionMonths;
getTransactionMonths = function () { return _getTransactionMonthsBase().filter(eraOk); };

const _getYearMonthsBase = getYearMonths;
getYearMonths = function (year) {
  const months = _getYearMonthsBase(year).filter(eraOk);
  return months.length ? months : _getYearMonthsBase(year).slice(-1);
};

const _shiftTxMonthBase = shiftTxMonth;
shiftTxMonth = function (delta) {
  const [y, m] = (txSelectedMonth || monthKey()).split('-').map(Number);
  const target = monthKey(new Date(y, m - 1 + delta, 1));
  if (!eraOk(target)) return;
  if (ledgerView === 'now' && target > monthKey(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1))) return;
  return _shiftTxMonthBase(delta);
};

renderInsights = function () {};
renderPaceChart = function () { renderBarChart(); };

// Pie: never Savings; on the Dashboard also leave out the fixed costs (rent, truck,
// insurance, phone) so the pie adds up to the Spent card.
const _renderPieChartBase = renderPieChart;
renderPieChart = function (byCat) {
  let copy = { ...(byCat || {}) };
  if (ledgerView === 'now' && txSelectedMonth) {
    copy = {};
    getMonthTransactions(txSelectedMonth).forEach((t) => {
      if (t.type !== 'expense' || isFixedCost(t)) return;
      copy[t.categoryId] = (copy[t.categoryId] || 0) + t.amount;
    });
  }
  delete copy['cat-savings'];
  return _renderPieChartBase(copy);
};

const _renderDashStatsBase = renderDashStats;
renderDashStats = function () {
  if (ledgerView === 'history') return _renderDashStatsBase();
  const el = document.getElementById('dash-stats');
  if (!el) return;
  const key = txSelectedMonth || monthKey();
  const tx = getMonthTransactions(key);
  const income = sumByType(tx, 'income');
  const exp = tx.filter((t) => t.type === 'expense' && t.categoryId !== 'cat-savings' && !isFixedCost(t));
  const spent = exp.reduce((s, t) => s + t.amount, 0);
  const saved = tx.filter((t) => t.type === 'expense' && t.categoryId === 'cat-savings').reduce((s, t) => s + t.amount, 0);
  const pct = income > 0 ? Math.round((spent / income) * 100) : null;
  const bar = pct === null ? 0 : Math.min(pct, 100);
  const incCount = tx.filter((t) => t.type === 'income').length;
  el.innerHTML = `
    <div class="dash-stat dash-stat-card">
      <span class="dash-stat-label"><i class="dash-dot income"></i>Income</span>
      <span class="dash-stat-value income">${formatMoney(income)}</span>
      <span class="dash-stat-sub">${incCount} deposit${incCount === 1 ? '' : 's'}${saved ? ` · ${formatMoney(saved)} saved` : ''} · <span title="Rent $1,800 · Truck $684 · Insurance $200 · Phone $117">$${FIXED_COSTS_MONTHLY.toLocaleString()}/mo fixed costs</span></span>
    </div>
    <div class="dash-stat dash-stat-card">
      <span class="dash-stat-label"><i class="dash-dot expense"></i>Spent</span>
      <span class="dash-stat-value expense">${formatMoney(spent)}</span>
      <div class="dash-meter${pct !== null && pct > 100 ? ' over' : ''}"><span style="width:${bar}%"></span></div>
      <span class="dash-stat-sub">${pct === null ? `${exp.length} transactions` : `${pct}% of income · fixed costs not included`}</span>
    </div>`;
};

// ---- Navigation: Dashboard | Obligations | Funds | History ------------
(function setupPages() {
  const tabs = document.querySelector('.nav-tabs');
  const main = document.querySelector('main.main');
  if (!tabs || !main) return;
  tabs.querySelector('[data-page="savings"]')?.remove();
  const mk = (page, label) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'nav-tab'; b.dataset.page = page; b.textContent = label;
    return b;
  };
  tabs.querySelector('[data-page="dashboard"]')?.after(mk('obligations', 'Obligations'));
  tabs.appendChild(mk('history', 'History'));

  const sec = document.createElement('section');
  sec.className = 'page'; sec.id = 'page-obligations';
  sec.innerHTML = `
    <header class="page-header">
      <h1>Obligations</h1>
      <p class="section-hint">What has to be paid no matter what, what's still owed, and the money set aside to fall back on</p>
    </header>
    <div class="summary-grid oblig-summary" id="oblig-summary"></div>
    <div id="oblig-fixed"></div>
    <div id="oblig-temp"></div>
    <div id="reserves-list"></div>
    <div id="oblig-savings-slot"></div>`;
  const funds = document.getElementById('page-reserves');
  main.insertBefore(sec, funds || null);
  const owed = document.getElementById('owed-list');
  if (owed) sec.querySelector('#oblig-temp').after(owed);
  const savList = document.getElementById('savings-list');
  if (savList) sec.querySelector('#oblig-savings-slot').appendChild(savList);
  document.getElementById('page-savings')?.remove();
})();

const _navigateBase = navigate;
navigate = function (page) {
  if (page === 'savings') page = 'obligations';
  if (page === 'dashboard' || page === 'history') {
    const v = page === 'history' ? 'history' : 'now';
    if (v !== ledgerView) { ledgerView = v; txSelectedMonth = null; }
    document.body.classList.toggle('view-history', v === 'history');
    _navigateBase('dashboard');
    document.querySelectorAll('.nav-tab').forEach((t) => t.classList.toggle('active', t.dataset.page === page));
    return;
  }
  return _navigateBase(page);
};

const _renderPageBase = renderPage;
renderPage = function (page) {
  ensureAddonCategories();
  if (page === 'obligations') { renderObligations(); return; }
  return _renderPageBase(page);
};

// ---- Obligations page -----------------------------------------------
function obligStatus(r, key) {
  const today = isoOf(new Date());
  if (r.paidAmt > 0) {
    const last = r.paid[r.paid.length - 1];
    const more = r.due.length > r.paid.length ? ` · ${r.due.length - r.paid.length} more due` : '';
    return { cls: 'paid', text: `Paid ${formatDisplayDate(last.date)}${r.paid.length > 1 ? ` (×${r.paid.length})` : ''}${more}` };
  }
  const next = r.due.find((d) => d >= today) || r.due[r.due.length - 1];
  if (key < monthKey()) return { cls: 'missing', text: 'Not seen in statements' };
  if (next < today) return { cls: 'overdue', text: `Was due ${formatDisplayDate(next)}` };
  return { cls: 'due', text: `Due ${formatDisplayDate(next)}` };
}

const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

function obligTable(rows, key) {
  if (!rows.length) return '<p class="empty-inline">Nothing here.</p>';
  return `<div class="oblig-rows">${rows.map((r) => {
    const st = obligStatus(r, key);
    const every = r.o.schedule === 'biweekly' ? 'every 2 weeks' : `monthly · ${ordinal(parseInt(r.o.start.slice(8, 10), 10))}`;
    const amt = r.paidAmt > 0 ? r.paidAmt : r.planned;
    return `
      <div class="oblig-row oblig-${st.cls}">
        <div class="owed-main">
          <span class="owed-what">${escapeHtml(r.o.name)}</span>
          <span class="owed-note">${formatMoney(r.o.amount)} ${every}</span>
        </div>
        <div class="owed-side">
          <strong class="owed-amt">${formatMoney(amt)}</strong>
          <span class="owed-due oblig-status">${st.text}</span>
        </div>
      </div>`;
  }).join('')}</div>`;
}

function renderObligations() {
  const key = monthKey();
  const p = monthPlan(key);
  const fixedRows = p.rows.filter((r) => r.o.type === 'fixed');
  const tempRows = p.rows.filter((r) => r.o.type === 'temporary');
  const avg = fixedMonthlyAverage();
  const resBal = reservesState.items.reduce((s, x) => s + x.amount, 0);
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };

  set('oblig-summary', `
    <div class="summary-card">
      <span class="summary-label">Fixed Bills · ${monthLabel(key)}</span>
      <span class="summary-value expense">${formatMoney(p.fixed)}</span>
      <span class="summary-sub">about ${formatMoney(avg)} in a normal month</span>
    </div>
    <div class="summary-card">
      <span class="summary-label">Income · ${monthLabel(key)}</span>
      <span class="summary-value income">${formatMoney(p.income)}</span>
      <span class="summary-sub">so far this month</span>
    </div>
    <div class="summary-card">
      <span class="summary-label">Surplus</span>
      <span class="summary-value ${p.surplus >= 0 ? 'income' : 'expense'}">${p.surplus >= 0 ? '' : '−'}${formatMoney(Math.abs(p.surplus))}</span>
      <span class="summary-sub">income − fixed bills</span>
    </div>
    <div class="summary-card">
      <span class="summary-label">Reserves</span>
      <span class="summary-value balance">${formatMoney(resBal)}</span>
      <span class="summary-sub">set aside to fall back on</span>
    </div>`);

  set('oblig-fixed', `
    <div class="card owed-card">
      <div class="owed-head">
        <div><h2>Fixed — every month</h2><p class="section-hint">Counted in your surplus · ${monthLabel(key)}</p></div>
        <span class="owed-total">${formatMoney(p.fixed)}</span>
      </div>
      ${obligTable(fixedRows, key)}
    </div>`);

  set('oblig-temp', `
    <div class="card owed-card">
      <div class="owed-head">
        <div><h2>Temporary — until paid off</h2><p class="section-hint">Not counted in your surplus · ${monthLabel(key)}</p></div>
        ${p.temporary ? `<span class="owed-total">${formatMoney(p.temporary)}</span>` : ''}
      </div>
      ${obligTable(tempRows, key)}
    </div>`);

  renderOwed();
  renderReservesList(resBal);
  if (typeof renderSavingsList === 'function') renderSavingsList();
}

function renderReservesList(bal) {
  const el = document.getElementById('reserves-list');
  if (!el) return;
  let run = 0;
  const rows = reservesState.items.map((x) => { run += x.amount; return { ...x, run }; }).reverse().map((x) => `
    <tr>
      <td class="funds-date">${formatDisplayDate(x.date)}</td>
      <td>${escapeHtml(x.what)}${x.note ? `<div class="owed-note">${escapeHtml(x.note)}</div>` : ''}</td>
      <td class="num ${x.amount >= 0 ? 'income' : 'expense'}">${x.amount >= 0 ? '+' : '−'}${formatMoney(Math.abs(x.amount))}</td>
      <td class="num">${formatMoney(x.run)}</td>
    </tr>`).join('');
  el.innerHTML = `
    <div class="card owed-card">
      <div class="owed-head">
        <div><h2>Reserves</h2><p class="section-hint">Money set aside for courses and for months income doesn't cover</p></div>
        <span class="owed-total reserves-total">${formatMoney(bal)}</span>
      </div>
      ${rows ? `<div class="trends-table-wrap"><table class="trends-table funds-table">
        <thead><tr><th>Date</th><th>What</th><th class="num">Amount</th><th class="num">Balance</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : '<p class="empty-inline">Nothing set aside yet.</p>'}
    </div>`;
}

function owedDaysLeft(iso) {
  const due = parseISO(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due - today) / 86400000);
}

function renderOwed() {
  const el = document.getElementById('owed-list');
  if (!el) return;
  const items = owedState.items;
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
    ? `${items.length} balance${items.length === 1 ? '' : 's'} · next due ${formatDisplayDate(next.date)}`
    : 'Nothing owed right now';
  el.innerHTML = `
    <div class="card owed-card">
      <div class="owed-head">
        <div><h2>What I Still Owe</h2><p class="section-hint">${sub}</p></div>
        ${items.length ? `<span class="owed-total">${formatMoney(total)}</span>` : ''}
      </div>
      ${items.length ? `<div class="owed-rows">${rows}</div>` : '<p class="empty-inline">All clear.</p>'}
      ${owedState.error ? `<p class="empty-inline">⚠ Couldn't refresh (${escapeHtml(owedState.error)}) — showing last copy.</p>` : ''}
    </div>`;
}

const _syncInboxBase = syncInbox;
syncInbox = function (opts) { loadOwed(); return _syncInboxBase(opts); };

// Pie card heading: on the Dashboard it shows everyday spending only (rent + fixed bills left out).
function setPieHeading() {
  const head = document.querySelector('.dash-box-pie .dash-box-head');
  if (!head) return;
  head.innerHTML = ledgerView === 'history'
    ? '<h2>Spending by Category</h2>'
    : '<div><h2>Everyday Spending</h2><p class="section-hint">By category · rent, truck, insurance &amp; phone not included</p></div>';
}
const _renderPieChartHead = renderPieChart;
renderPieChart = function (byCat) { setPieHeading(); return _renderPieChartHead(byCat); };
setPieHeading();
