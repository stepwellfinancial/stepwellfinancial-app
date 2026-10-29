/* Stepwell Financial: CSV writing with the spreadsheet formula guard.
   PURE: no DOM, no storage. Shared by every export; an import screen may use
   csvGuard() too (for example to show how a cell would export).

   The guard: any TEXT cell that starts with = + - @ a tab or a carriage
   return gets a leading ' so a spreadsheet shows it as text and never runs
   it as a formula. Amounts are not text: amount() marks a cell as a plain
   number ("-4.50"), which is written as-is and never guarded. */
(function (root) {
  'use strict';

  var DANGER = { '=': 1, '+': 1, '-': 1, '@': 1, '\t': 1, '\r': 1 };
  var BOM = String.fromCharCode(0xFEFF); // UTF-8 byte order mark, so spreadsheets read the file as UTF-8

  // csvGuard('=1+1') -> "'=1+1"; csvGuard('Rent') -> 'Rent'
  function csvGuard(text) {
    var s = String(text === undefined || text === null ? '' : text);
    return s.length && DANGER[s[0]] ? "'" + s : s;
  }
  // Quote a cell when it holds a comma, a quote or a line break.
  function quote(s) {
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === ',' || c === '"' || c === '\n' || c === '\r') return '"' + s.split('"').join('""') + '"';
    }
    return s;
  }
  // A number cell: cents -> "-4.50". Throws on anything but a safe integer.
  function Amount(text) { this.text = text; }
  function amount(cents) {
    if (typeof cents !== 'number' || !Number.isSafeInteger(cents)) throw new TypeError('amount() takes whole cents');
    var a = Math.abs(cents);
    return new Amount((cents < 0 ? '-' : '') + Math.floor(a / 100) + '.' + String(a % 100 + 100).slice(1));
  }
  function cell(v) {
    if (v instanceof Amount) return v.text;
    return quote(csvGuard(v));
  }
  function row(cells) { return cells.map(cell).join(','); }
  // rows: arrays of cells (text or amount()). bom: start with a UTF-8 byte order mark.
  function toCsv(rows, opts) {
    opts = opts || {};
    return (opts.bom ? BOM : '') + rows.map(row).join('\r\n') + '\r\n';
  }

  // The transactions export (spec 9.8): date,account,payee,amount,category,note.
  // A split line is written once per part, with the part's amount and category,
  // so the amounts still add up to the line.
  function transactionsCsv(transactions, accounts, categories) {
    var an = {}, cn = {};
    accounts.forEach(function (a) { an[a.id] = a.name; });
    categories.forEach(function (c) { cn[c.id] = c.name; });
    var list = transactions.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0); });
    var rows = [['date', 'account', 'payee', 'amount', 'category', 'note']];
    list.forEach(function (t) {
      var parts = t.splits && t.splits.length ? t.splits : [{ cents: t.cents, categoryId: t.categoryId }];
      parts.forEach(function (p) {
        rows.push([t.date, an[t.accountId] || '', t.payee, amount(p.cents), p.categoryId ? (cn[p.categoryId] || '') : '', t.note || '']);
      });
    });
    return toCsv(rows, { bom: true });
  }

  var api = { csvGuard: csvGuard, amount: amount, cell: cell, row: row, toCsv: toCsv, transactionsCsv: transactionsCsv };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SWCsv = api;
})(this);
