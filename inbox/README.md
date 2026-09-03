# Inbox

Claude appends new transactions here from the phone. One file per calendar month,
named by **today's** date (`YYYY-MM.txt`), one transaction per line:

```
YYYY-MM-DD | Description | Amount | Category
```

- Lines starting with `#` are ignored.
- The app reads every file from the month before the base data snapshot up to next month,
  and merges the lines on top of `ledger-data.js`.
- Periodically the lines get folded into `ledger-data.js` and the file is emptied (compaction).
