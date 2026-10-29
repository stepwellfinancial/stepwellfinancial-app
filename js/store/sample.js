/* Stepwell Financial: "Try with sample data".
   PURE: turns the prototype's sample household (js/data.js, plus the rules
   and splits in js/data-ext/eng-a.js) into store records, every one with
   source 'sample'. No DOM, no storage, no clock: the store passes newId,
   the time and the categories that already exist.

   What it gives (and what the tests check):
   - 9 accounts and their month-end balances. Debts become the positive
     amount owed. Net worth on 28 Oct 2026 = 52,145.58 - 23,686.95 =
     28,458.63; on 30 Sep 27,246.23.
   - The 50 October lines and the 14 fee lines from earlier months, in the
     starter categories ("Bills" becomes "Bills and utilities").
   - The rules, the one split, October's budget (planned income 5,200.00,
     targets 4,360.00 = the six budgets 3,350.00 + bills and utilities
     1,010.00, so "not yet given a job" is 840.00), the bills and the goals.
   - The brokerage account's fund cost, 0.20%: 6,215.40 x 0.20% = 12.43. */
(function (root) {
  'use strict';

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var TYPES = { checking: 'checking', savings: 'savings', k401: 'retirement', brokerage: 'investment', car: 'property',
    card4021: 'credit_card', card7730: 'credit_card', carloan: 'loan', student: 'loan' };
  var BY_GROUP = { cash: 'other_cash', invest: 'investment', property: 'property', card: 'credit_card', loan: 'loan' };
  var CAT_NAMES = { housing: 'Housing', groceries: 'Groceries', eating: 'Eating out', transport: 'Transport', fun: 'Fun',
    other: 'Other', bills: 'Bills and utilities', income: 'Income', fees: 'Fees' };
  var CAT_KINDS = { income: 'income' };

  function cents(v) { return Math.round(Number(v) * 100); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function monthEnd(m) { var y = +m.slice(0, 4), mo = +m.slice(5, 7); return m + '-' + pad2(new Date(Date.UTC(y, mo, 0)).getUTCDate()); }
  // "Updated by you on 27 Oct" -> '2026-10-27' (year from asOf); null if it can't tell.
  function updatedDate(text, asOf) {
    var words = String(text || '').split(' '), d = Number(words[words.length - 2]), m = MONTHS.indexOf(words[words.length - 1]);
    if (!(d >= 1 && d <= 31) || m < 0) return null;
    return asOf.slice(0, 4) + '-' + pad2(m + 1) + '-' + pad2(d);
  }

  // build(data, ext, { newId, nowIso, categories }) -> { accounts: [...], balances: [...], ... }
  // categories: the ones already in the store; sample lines use them by name,
  // and any that are missing are added (also as sample records).
  function build(data, ext, opts) {
    var newId = opts.newId, at = opts.nowIso;
    var out = { accounts: [], balances: [], categories: [], transactions: [], rules: [], budgets: [], payPlans: [], bills: [], goals: [], scenarios: [], scores: [], imports: [] };
    function rec(extra) { var r = { id: newId(), source: 'sample', createdAt: at, updatedAt: at }; Object.keys(extra).forEach(function (k) { r[k] = extra[k]; }); return r; }

    // Categories, by name, reusing what exists.
    var byName = {};
    (opts.categories || []).forEach(function (c) { byName[c.name.toLowerCase()] = c.id; });
    function cat(sampleId) {
      var name = CAT_NAMES[sampleId] || sampleId, k = name.toLowerCase();
      if (!byName[k]) {
        var c = rec({ name: name, kind: CAT_KINDS[sampleId] || 'expense', isFee: sampleId === 'fees' });
        out.categories.push(c);
        byName[k] = c.id;
      }
      return byName[k];
    }

    // Accounts and balances.
    var acct = {}, last = data.months.length - 1;
    data.accounts.forEach(function (a) {
      var g = null;
      data.groups.forEach(function (x) { if (x.id === a.group) g = x; });
      var debt = g && g.kind === 'debt';
      var m = /ending ([0-9]{4})$/.exec(a.name);
      var r = rec({ name: a.name, type: TYPES[a.id] || BY_GROUP[a.group], last4: m ? m[1] : '', aprBps: null,
        fundCostBps: a.id === 'brokerage' ? 20 : null });
      out.accounts.push(r);
      acct[a.id] = r.id;
      a.history.forEach(function (v, i) {
        var date = i < last ? monthEnd(data.months[i]) : (updatedDate(a.updated, data.asOf) || data.asOf);
        out.balances.push(rec({ accountId: r.id, date: date, cents: debt ? -cents(v) : cents(v) }));
      });
    });

    // Lines: October, then the fee lines. Splits keep the line's category.
    var splits = (ext && ext.splits) || [];
    data.transactions.forEach(function (t) {
      var sp = null;
      splits.forEach(function (s) { if (s.date === t.date && s.text === t.text && cents(s.amount) === cents(t.amount)) sp = s; });
      var c = cat(t.cat);
      out.transactions.push(rec({ accountId: acct[t.account], date: t.date, cents: cents(t.amount), payee: t.text, note: '',
        categoryId: c, splits: sp ? sp.parts.map(function (p) { return { categoryId: c, cents: cents(p.amount) }; }) : [],
        importId: null, fitId: null }));
    });
    (data.feeLines || []).forEach(function (t) {
      out.transactions.push(rec({ accountId: acct[t.account], date: t.date, cents: cents(t.amount), payee: t.text, note: '',
        categoryId: cat('fees'), splits: [], importId: null, fitId: null }));
    });

    // Rules, in their listed order.
    ((ext && ext.rules) || []).forEach(function (r, i) { out.rules.push(rec({ text: r.match, categoryId: cat(r.cat), order: i })); });

    // October's budget: the six budgets, plus the monthly bills (rent is in Housing).
    var month = data.asOf.slice(0, 7), lines = [];
    data.categories.forEach(function (c) { if (c.budget !== null) lines.push({ categoryId: cat(c.id), targetCents: cents(c.budget) }); });
    var billsCents = 0;
    data.bills.forEach(function (b) { if (!b.inBudget) billsCents += cents(b.amount); });
    lines.push({ categoryId: cat('bills'), targetCents: billsCents });
    var income = 0;
    data.transactions.forEach(function (t) { if (t.cat === 'income' && t.date.slice(0, 7) === month) income += cents(t.amount); });
    out.budgets.push(rec({ month: month, plannedIncomeCents: income, lines: lines }));

    // Bills: each falls due next after the sample's "today".
    data.bills.forEach(function (b) {
      var y = +data.asOf.slice(0, 4), mo = +data.asOf.slice(5, 7), d = +data.asOf.slice(8, 10);
      if (b.day <= d) { mo += 1; if (mo > 12) { mo = 1; y += 1; } }
      out.bills.push(rec({ name: b.name, cents: cents(b.amount), frequency: 'monthly', nextDue: y + '-' + pad2(mo) + '-' + pad2(b.day),
        accountId: null, categoryId: cat(b.inBudget || 'bills'), endsOn: null }));
    });

    // Goals.
    data.goals.forEach(function (g) {
      var kind = g.kind === 'sinking fund' ? 'sinking' : g.typicalMonthlySpend ? 'emergency' : 'goal';
      var by = g.by ? (g.by.length === 7 ? g.by + '-01' : g.by) : null;
      out.goals.push(rec({ name: g.name, kind: kind, targetCents: cents(g.target), savedCents: cents(g.saved), savedAsOf: data.asOf, targetDate: by }));
    });
    return out;
  }

  var api = { build: build, updatedDate: updatedDate };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SWSample = api;
})(this);
