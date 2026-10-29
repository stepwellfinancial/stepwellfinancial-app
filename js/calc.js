/* Stepwell Financial prototype: every calculation and number format.
   PURE: no DOM, no globals read, no side effects, so it can be tested alone
   (open tests/calc.html, or load it in any JavaScript runtime).
   Money is added in whole cents, then turned back into dollars, so sums tie
   to the cent. */
(function (root) {
  'use strict';

  var MINUS = '−';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];

  // ---------- Cents ----------
  function toCents(v) { return Math.round(Number(v) * 100); }
  function fromCents(c) { return c / 100; }
  function sum(values) {
    var c = 0;
    for (var i = 0; i < values.length; i++) c += toCents(values[i]);
    return fromCents(c);
  }
  // Half up to the cent, for a final figure only.
  function round2(v) { return Math.round((v + (v >= 0 ? 1 : -1) * Number.EPSILON) * 100) / 100; }

  // ---------- Balances ----------
  function monthCount(data) { return data.months.length; }
  function lastIndex(data) { return data.months.length - 1; }
  function group(data, id) {
    for (var i = 0; i < data.groups.length; i++) if (data.groups[i].id === id) return data.groups[i];
    return null;
  }
  function accountsIn(data, groupId) {
    return data.accounts.filter(function (a) { return a.group === groupId; });
  }
  function groupTotal(data, groupId, i) {
    return sum(accountsIn(data, groupId).map(function (a) { return a.history[i]; }));
  }
  function groupSeries(data, groupId) {
    return data.months.map(function (m, i) { return groupTotal(data, groupId, i); });
  }
  function kindTotal(data, kind, i) {
    return sum(data.groups.filter(function (g) { return g.kind === kind; })
      .map(function (g) { return groupTotal(data, g.id, i); }));
  }
  function assets(data, i) { return kindTotal(data, 'asset', i); }
  function debts(data, i) { return kindTotal(data, 'debt', i); } // negative
  function netWorth(data, i) { return sum([assets(data, i), debts(data, i)]); }
  function netSeries(data) { return data.months.map(function (m, i) { return netWorth(data, i); }); }

  // Change in net worth between two months, itemised by account.
  function changeBetween(data, from, to) {
    var items = data.accounts.map(function (a) {
      return { id: a.id, name: a.name, group: a.group, amount: sum([a.history[to], -a.history[from]]) };
    }).filter(function (x) { return x.amount !== 0; });
    items.sort(function (a, b) { return b.amount - a.amount; });
    var before = netWorth(data, from), after = netWorth(data, to), amount = sum([after, -before]);
    return { from: before, to: after, amount: amount, items: items, itemsTotal: sum(items.map(function (x) { return x.amount; })),
      pct: before === 0 ? null : (amount / Math.abs(before)) * 100 };
  }

  // Average monthly change over the last n months, to the cent.
  function averageMonthlyChange(series, n) {
    var last = series.length - 1;
    if (n < 1 || last - n < 0) return null;
    return round2((series[last] - series[last - n]) / n);
  }
  // Illustration: start, plus the same step for each month ahead.
  function illustrate(start, step, months) {
    var out = [];
    for (var k = 1; k <= months; k++) out.push(fromCents(toCents(start) + k * toCents(step)));
    return out;
  }

  // Shares of a total, one decimal. Largest-remainder, so they add to 100.0.
  function shares(values) {
    var abs = values.map(function (v) { return Math.abs(toCents(v)); });
    var total = abs.reduce(function (s, v) { return s + v; }, 0);
    if (!total) return values.map(function () { return 0; });
    var raw = abs.map(function (v) { return v * 1000 / total; });
    var fl = raw.map(Math.floor), left = 1000 - fl.reduce(function (s, v) { return s + v; }, 0);
    raw.map(function (v, i) { return { i: i, r: v - fl[i] }; })
      .sort(function (a, b) { return b.r - a.r; })
      .slice(0, left).forEach(function (x) { fl[x.i] += 1; });
    return fl.map(function (v) { return v / 10; });
  }

  // ---------- Transactions ----------
  function inMonth(tx, month) { return tx.date.slice(0, 7) === month; }
  function spendingByCategory(data, month) {
    var out = {};
    data.transactions.forEach(function (t) {
      if (!inMonth(t, month) || t.cat === 'income' || t.cat === 'bills') return;
      out[t.cat] = sum([out[t.cat] || 0, -t.amount]);
    });
    return out;
  }
  function totalWhere(data, month, test) {
    return sum(data.transactions.filter(function (t) { return inMonth(t, month) && test(t); })
      .map(function (t) { return t.amount; }));
  }
  function recent(data, n) {
    // Newest first; within a day, the line entered last comes first.
    var list = data.transactions.map(function (t, i) { return { t: t, i: i }; });
    list.sort(function (a, b) { return a.t.date < b.t.date ? 1 : a.t.date > b.t.date ? -1 : b.i - a.i; });
    return list.slice(0, n).map(function (x) { return x.t; });
  }
  function categoryName(data, id) {
    for (var i = 0; i < data.categories.length; i++) if (data.categories[i].id === id) return data.categories[i].name;
    return id;
  }

  // ---------- Formats ----------
  function grouped(n, dp) {
    return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  // money(-1212.4) -> "−$1,212.40"; money(5, {sign:true}) -> "+$5.00"
  function money(v, opts) {
    opts = opts || {};
    var dp = opts.dp === undefined ? 2 : opts.dp, c = toCents(v);
    var s = grouped(Math.abs(c) / 100, dp);
    if (c < 0) return MINUS + '$' + s;
    return (opts.sign && c > 0 ? '+' : '') + '$' + s;
  }
  function axisMoney(v) {
    if (v === 0) return '$0';
    return (v < 0 ? MINUS : '') + '$' + grouped(Math.abs(v) / 1000, 0) + 'k';
  }
  function number(v, dp) {
    dp = dp === undefined ? 2 : dp;
    return (v < 0 ? MINUS : '') + grouped(Math.abs(v), dp);
  }
  function pct(v, dp, opts) {
    opts = opts || {};
    dp = dp === undefined ? 1 : dp;
    var s = Math.abs(v).toFixed(dp);
    var sign = v < 0 && Number(s) !== 0 ? MINUS : (opts.sign && v > 0 && Number(s) !== 0 ? '+' : '');
    return sign + s + '%';
  }
  function monthShort(key) { return MONTHS[Number(key.slice(5, 7)) - 1]; }
  function monthLong(key) { return MONTHS_LONG[Number(key.slice(5, 7)) - 1] + ' ' + key.slice(0, 4); }
  function dayShort(date) { return Number(date.slice(8, 10)) + ' ' + MONTHS[Number(date.slice(5, 7)) - 1]; }
  function addMonths(key, k) {
    var y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7)) - 1 + k;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + (m < 9 ? '0' : '') + (m + 1);
  }

  // ---------- CSV ----------
  function csvCell(v) {
    var s = String(v);
    if (/^[=+\-@]/.test(s) && isNaN(Number(s))) s = "'" + s; // no formulas in spreadsheets
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function balancesCsv(data) {
    var rows = [['Account', 'Type'].concat(data.months)];
    data.accounts.forEach(function (a) {
      rows.push([a.name, group(data, a.group).name].concat(a.history.map(function (v) { return v.toFixed(2); })));
    });
    rows.push(['Net worth', 'Assets minus debts'].concat(netSeries(data).map(function (v) { return v.toFixed(2); })));
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n') + '\n';
  }

  // ---------- Markets (sample feed) ----------
  // Returns a clean copy of a markets object, or null if the shape is wrong.
  function cleanMarkets(obj) {
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.indices)) return null;
    var fin = function (v) { return typeof v === 'number' && isFinite(v); };
    var list = obj.indices.filter(function (x) {
      return x && typeof x.symbol === 'string' && typeof x.name === 'string' && fin(x.last) && fin(x.prevClose) &&
        fin(x.change) && fin(x.changePct) && Array.isArray(x.spark) && x.spark.length >= 2 && x.spark.every(fin);
    }).slice(0, 5).map(function (x) {
      return { symbol: x.symbol, name: x.name, last: x.last, prevClose: x.prevClose, change: x.change,
        changePct: x.changePct, spark: x.spark.slice(-100) };
    });
    if (!list.length) return null;
    return { source: String(obj.source || ''), asOf: String(obj.asOf || ''), indices: list };
  }
  function direction(v) { return v > 0 ? 'up' : v < 0 ? 'down' : 'no change'; }

  // ---------- Ties ----------
  // Every sum the sample promises. Returns [{name, ok, got, want}].
  function checkTies(data) {
    var out = [], last = lastIndex(data), E = data.expected;
    function eq(name, got, want) { out.push({ name: name, ok: toCents(got) === toCents(want), got: got, want: want }); }
    data.months.forEach(function (m, i) {
      data.groups.forEach(function (g) { eq(m + ' ' + g.name + ' = its accounts', groupTotal(data, g.id, i), data.groupTotals[g.id][i]); });
      eq(m + ' net worth = assets + debts', netWorth(data, i), sum([assets(data, i), debts(data, i)]));
    });
    eq('Net worth, Oct 2026', netWorth(data, last), E.netWorth);
    eq('Assets, Oct 2026', assets(data, last), E.assets);
    eq('Debts, Oct 2026', debts(data, last), E.debts);
    eq('Net worth, Sep 2026', netWorth(data, last - 1), E.netWorthSep);
    eq('Net worth, Nov 2025', netWorth(data, data.months.indexOf('2025-11')), E.netWorthNov2025);
    var ch = changeBetween(data, last - 1, last);
    eq('Change since 30 Sep', ch.amount, E.change);
    eq('What changed lines add up', ch.itemsTotal, ch.amount);
    out.push({ name: 'Change %, one decimal', ok: ch.pct.toFixed(1) === E.changePct, got: ch.pct.toFixed(1), want: E.changePct });
    eq('Average monthly change, last 6 months', averageMonthlyChange(netSeries(data), 6), E.avg6);
    var oct = data.months[last], sp = spendingByCategory(data, oct);
    eq('October spending', sum(Object.keys(sp).map(function (k) { return sp[k]; })), E.spentOct);
    eq('October money in', totalWhere(data, oct, function (t) { return t.cat === 'income'; }), E.incomeOct);
    eq('Budgets add up', sum(data.categories.filter(function (c) { return c.budget !== null; }).map(function (c) { return c.budget; })), E.budgetTotal);
    eq('Monthly bills, rent excluded', sum(data.bills.filter(function (b) { return !b.inBudget; }).map(function (b) { return b.amount; })), E.billsTotal);
    eq('October bills lines', -totalWhere(data, oct, function (t) { return t.cat === 'bills'; }), E.billsTotal);
    eq('Not yet given a job', sum([E.incomeOct, -E.budgetTotal, -E.billsTotal]), E.noJob);
    eq('Fees add up', sum(data.fees.map(function (f) { return f.amount; })), E.feesTotal);
    var fund = data.fees.filter(function (f) { return f.rate; })[0];
    eq('Fund cost = balance x rate', round2(fund.base * fund.rate / 100), fund.amount);
    var eat = data.transactions.filter(function (t) { return inMonth(t, oct) && t.cat === 'eating'; });
    out.push({ name: 'Eating out: 14 payments', ok: eat.length === 14, got: eat.length, want: 14 });
    return out;
  }

  // =====================================================================
  // Totals from stored records (the working app). Every input is a list of
  // records from SW.store; every amount is whole cents and every result is
  // whole cents. Debts are stored as the positive amount owed, so
  // net worth = assets - debts. Nothing here reads the clock: pass "today".
  // =====================================================================
  var GROUP_OF = { checking: 'cash', savings: 'cash', other_cash: 'cash', investment: 'invest', retirement: 'invest',
    property: 'property', other_asset: 'other', credit_card: 'card', loan: 'loan', other_debt: 'loan' };
  var GROUP_IDS = ['cash', 'invest', 'property', 'other', 'card', 'loan'];
  var DEBT_GROUP = { card: true, loan: true };
  function typeGroup(type) { return GROUP_OF[type] || null; }
  function isDebtType(type) { return !!DEBT_GROUP[GROUP_OF[type]]; }

  // Integer division rounded half away from zero (half up for amounts above 0).
  function divRound(n, d) {
    var a = Math.abs(n), q = Math.floor(a / d), r = a - q * d;
    if (r * 2 >= d) q += 1;
    return n < 0 ? -q : q;
  }
  // Integer division rounded up (toward +infinity), for "rounded up to the cent".
  function divUp(n, d) { return Math.ceil(n / d); }

  // ---------- Dates ----------
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  // A Date -> 'YYYY-MM-DD' in the device's local time.
  function localDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function monthOf(date) { return date.slice(0, 7); }
  function monthEnd(month) {
    var y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
    return month + '-' + pad2(new Date(Date.UTC(y, m, 0)).getUTCDate());
  }
  // The n months ending with endMonth, oldest first.
  function monthsEnding(endMonth, n) {
    var out = [];
    for (var k = n - 1; k >= 0; k--) out.push(addMonths(endMonth, -k));
    return out;
  }
  // "Wednesday 28 October 2026"
  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function dateLong(date) {
    var y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)), d = Number(date.slice(8, 10));
    return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + ' ' + d + ' ' + MONTHS_LONG[m - 1] + ' ' + y;
  }
  // "3 Oct 2026"
  function dayLong(date) { return Number(date.slice(8, 10)) + ' ' + MONTHS[Number(date.slice(5, 7)) - 1] + ' ' + date.slice(0, 4); }

  // ---------- Money text from cents ----------
  // moneyCents(-121240) -> "−$1,212.40"; moneyCents(500, {sign:true}) -> "+$5.00";
  // {dp: 0} rounds half away from zero to whole dollars.
  function moneyCents(c, opts) {
    opts = opts || {};
    var dp0 = opts.dp === 0, a = Math.abs(c);
    var whole = dp0 ? divRound(a, 100) : Math.floor(a / 100);
    var d = String(whole), out = '';
    while (d.length > 3) { out = ',' + d.slice(-3) + out; d = d.slice(0, -3); }
    var s = '$' + d + out + (dp0 ? '' : '.' + String(a % 100 + 100).slice(1));
    var zero = dp0 ? whole === 0 : a === 0;
    if (c < 0 && !zero) return MINUS + s;
    return (opts.sign && c > 0 && !zero ? '+' : '') + s;
  }

  // ---------- Balances and net worth ----------
  function byDateThenCreated(a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
  }
  // { accountId: [entries oldest first] }
  function balanceIndex(balances) {
    var by = {};
    balances.forEach(function (b) { (by[b.accountId] = by[b.accountId] || []).push(b); });
    Object.keys(by).forEach(function (k) { by[k].sort(byDateThenCreated); });
    return by;
  }
  // The latest entry dated on or before date (ties: the later createdAt), or null.
  function entryOn(list, date) {
    if (!list || !list.length) return null;
    var lo = 0, hi = list.length - 1, found = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (list[mid].date <= date) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return found >= 0 ? list[found] : null;
  }
  function asIndex(balances) { return Array.isArray(balances) ? balanceIndex(balances) : balances; }

  // totalsOn(accounts, balances, '2026-10-28') ->
  //   { date, assetsCents, debtsCents, netCents,
  //     groups: { cash: { cents, accounts: [...] }, ... },
  //     rows: [{ account, group, debt, cents, entry }] }   (cents 0 and entry null: "No balance yet")
  // balances may be the list or a balanceIndex() of it.
  function totalsOn(accounts, balances, date) {
    var idx = asIndex(balances), groups = {}, rows = [], assets = 0, debts = 0;
    GROUP_IDS.forEach(function (g) { groups[g] = { cents: 0, accounts: [] }; });
    accounts.forEach(function (a) {
      var g = typeGroup(a.type), e = entryOn(idx[a.id], date), c = e ? e.cents : 0;
      if (!g) return;
      var row = { account: a, group: g, debt: !!DEBT_GROUP[g], cents: c, entry: e };
      rows.push(row);
      groups[g].cents += c;
      groups[g].accounts.push(row);
      if (DEBT_GROUP[g]) debts += c; else assets += c;
    });
    return { date: date, assetsCents: assets, debtsCents: debts, netCents: assets - debts, groups: groups, rows: rows };
  }
  // One entry a month: the month's last day, or today for the current month.
  // Months after today are left out.
  function netWorthByMonth(accounts, balances, months, today) {
    var idx = asIndex(balances);
    return months.filter(function (m) { return !today || m <= monthOf(today); }).map(function (m) {
      var end = monthEnd(m), date = today && end > today ? today : end;
      var t = totalsOn(accounts, idx, date);
      var g = {};
      GROUP_IDS.forEach(function (k) { g[k] = t.groups[k].cents; });
      return { month: m, date: date, assetsCents: t.assetsCents, debtsCents: t.debtsCents, netCents: t.netCents, groups: g };
    });
  }
  // Does any account have a balance entry on or before date?
  function hasBalanceOn(accounts, balances, date) {
    var idx = asIndex(balances);
    return accounts.some(function (a) { return !!entryOn(idx[a.id], date); });
  }
  // The change in net worth between two dates, by account, so the lines add
  // up to the total. A debt that grew is a negative change in net worth.
  // pct is null unless the earlier net worth is above $0.
  function changeBetweenDates(accounts, balances, fromDate, toDate) {
    var idx = asIndex(balances), a = totalsOn(accounts, idx, fromDate), b = totalsOn(accounts, idx, toDate);
    var items = b.rows.map(function (r, i) {
      var before = a.rows[i].cents, after = r.cents, eff = r.debt ? before - after : after - before;
      return { accountId: r.account.id, name: r.account.name, group: r.group, debt: r.debt, fromCents: before, toCents: after, changeCents: eff };
    }).filter(function (x) { return x.changeCents !== 0; });
    items.sort(function (x, y) { return y.changeCents - x.changeCents; });
    var amount = b.netCents - a.netCents;
    return { fromDate: fromDate, toDate: toDate, fromCents: a.netCents, toCents: b.netCents, amountCents: amount, items: items,
      itemsTotalCents: items.reduce(function (s, x) { return s + x.changeCents; }, 0),
      pct: a.netCents > 0 ? amount / a.netCents * 100 : null };
  }
  // Average monthly change over n months, rounded half up to the cent (the
  // method says so), and the illustration that carries it forward.
  function averageChangeCents(nowCents, thenCents, n) { return divRound(nowCents - thenCents, n); }
  function illustrateCents(startCents, stepCents, months) {
    var out = [];
    for (var k = 1; k <= months; k++) out.push(startCents + k * stepCents);
    return out;
  }
  function sharesCents(values) { return shares(values.map(function (c) { return c / 100; })); }

  // ---------- Lines (transactions) ----------
  // A line's parts: its splits, or the whole line as one part.
  function partsOf(t) { return t.splits && t.splits.length ? t.splits : [{ categoryId: t.categoryId, cents: t.cents }]; }
  function linesInMonth(transactions, month) { return transactions.filter(function (t) { return t.date.slice(0, 7) === month; }); }
  function indexById(list) { var o = {}; list.forEach(function (x) { o[x.id] = x; }); return o; }

  // cashFlowMonth(lines, categories, '2026-10') ->
  //   { inCents, outCents, diffCents,
  //     income: [{ categoryId, name, cents, count }], expense: [{ categoryId, name, cents, count }],
  //     transfer: { cents, count }, uncategorised: { cents, count } }
  // In = parts in income categories. Out = parts in expense categories, as a
  // positive amount (a refund lowers it). Transfers and uncategorised parts
  // are in neither total and are listed apart.
  function cashFlowMonth(transactions, categories, month) {
    var cats = indexById(categories), inc = {}, exp = {};
    var r = { month: month, inCents: 0, outCents: 0, income: [], expense: [], transfer: { cents: 0, count: 0 }, uncategorised: { cents: 0, count: 0 } };
    linesInMonth(transactions, month).forEach(function (t) {
      partsOf(t).forEach(function (p) {
        var c = p.categoryId ? cats[p.categoryId] : null;
        if (!c) { r.uncategorised.cents += p.cents; r.uncategorised.count += 1; return; }
        if (c.kind === 'transfer') { r.transfer.cents += p.cents; r.transfer.count += 1; return; }
        var bag = c.kind === 'income' ? inc : exp;
        var x = bag[c.id] || (bag[c.id] = { categoryId: c.id, name: c.name, cents: 0, count: 0 });
        x.count += 1;
        if (c.kind === 'income') { x.cents += p.cents; r.inCents += p.cents; } else { x.cents -= p.cents; r.outCents -= p.cents; }
      });
    });
    categories.forEach(function (c) { if (inc[c.id]) r.income.push(inc[c.id]); if (exp[c.id]) r.expense.push(exp[c.id]); });
    r.diffCents = r.inCents - r.outCents;
    return r;
  }
  // Spending by expense category for a month: [{ categoryId, name, cents, count }]
  // (cents is the positive amount spent), in category order, only those with lines.
  function spendingByCategoryMonth(transactions, categories, month) { return cashFlowMonth(transactions, categories, month).expense; }

  // ---------- Budget ----------
  // "Not yet given a job" = planned income - the sum of the targets.
  // Negative means the targets add up to more than the income entered.
  function notYetGivenAJob(budget) {
    var planned = budget ? budget.plannedIncomeCents : 0;
    var targets = budget ? budget.lines.reduce(function (s, l) { return s + l.targetCents; }, 0) : 0;
    return { plannedIncomeCents: planned, targetsCents: targets, leftCents: planned - targets };
  }
  // budgetMonth(budget or null, lines, categories, '2026-10') ->
  //   { month, plannedIncomeCents, targetsCents, notYetGivenAJobCents, moneyInCents, moneyOutCents,
  //     lines: [{ categoryId, name, targetCents, actualCents, leftCents, direction }],
  //     unbudgeted: [{ categoryId, name, actualCents }] }
  // leftCents = target - actual; direction 'under', 'over' or 'on' (ink only).
  function budgetMonth(budget, transactions, categories, month) {
    var cf = cashFlowMonth(transactions, categories, month), spent = {}, cats = indexById(categories), inBudget = {};
    cf.expense.forEach(function (x) { spent[x.categoryId] = x.cents; });
    var nj = notYetGivenAJob(budget);
    var lines = (budget ? budget.lines : []).filter(function (l) { return cats[l.categoryId]; }).map(function (l) {
      inBudget[l.categoryId] = true;
      var actual = spent[l.categoryId] || 0, left = l.targetCents - actual;
      return { categoryId: l.categoryId, name: cats[l.categoryId].name, targetCents: l.targetCents, actualCents: actual,
        leftCents: left, direction: left > 0 ? 'under' : left < 0 ? 'over' : 'on' };
    });
    var order = {};
    categories.forEach(function (c, i) { order[c.id] = i; });
    lines.sort(function (a, b) { return order[a.categoryId] - order[b.categoryId]; });
    return { month: month, plannedIncomeCents: nj.plannedIncomeCents, targetsCents: nj.targetsCents, notYetGivenAJobCents: nj.leftCents,
      moneyInCents: cf.inCents, moneyOutCents: cf.outCents, lines: lines,
      unbudgeted: cf.expense.filter(function (x) { return !inBudget[x.categoryId]; }).map(function (x) { return { categoryId: x.categoryId, name: x.name, actualCents: x.cents }; }) };
  }

  // ---------- Per month and per pay ----------
  var PERIODS = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12, quarterly: 4, yearly: 1 };
  // Per month = amount x periods a year / 12, half up to the cent from the unrounded value.
  function perMonthCents(cents, frequency) { return divRound(cents * PERIODS[frequency], 12); }
  // A set of amounts [{cents, frequency}] per month and per pay, each rounded
  // once from the unrounded total.
  function perMonthAndPay(items, payFrequency) {
    var yearly = items.reduce(function (s, x) { return s + x.cents * PERIODS[x.frequency]; }, 0);
    return { perMonthCents: divRound(yearly, 12), perPayCents: payFrequency ? divRound(yearly, PERIODS[payFrequency]) : null, perYearCents: yearly };
  }

  // ---------- Rules and duplicates ----------
  // The first rule (by order) whose text is inside the payee, ignoring case.
  // Plain substring, never a pattern. -> categoryId or null
  function ruleCategory(rules, payee) {
    var p = String(payee || '').toLowerCase();
    var sorted = rules.slice().sort(function (a, b) { return a.order - b.order; });
    for (var i = 0; i < sorted.length; i++) if (p.indexOf(sorted[i].text.toLowerCase()) >= 0) return sorted[i].categoryId;
    return null;
  }
  // Collapse runs of spaces, trim, lower case. Written by hand (no patterns on file text).
  function payeeKey(s) {
    var out = '', space = false, str = String(s || '');
    for (var i = 0; i < str.length; i++) {
      var c = str[i], ws = c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ' ';
      if (ws) { space = out.length > 0; continue; }
      if (space) { out += ' '; space = false; }
      out += c;
    }
    return out.toLowerCase();
  }
  // Which incoming rows already exist in the account? Same fitId (OFX), or
  // the same date, cents and payee, matched occurrence by occurrence.
  // -> [true | false] per row
  function matchDuplicates(existing, rows, accountId) {
    var fit = {}, count = {};
    existing.forEach(function (t) {
      if (t.accountId !== accountId) return;
      if (t.fitId) fit[t.fitId] = true;
      var k = t.date + '|' + t.cents + '|' + payeeKey(t.payee);
      count[k] = (count[k] || 0) + 1;
    });
    return rows.map(function (r) {
      if (r.fitId && fit[r.fitId]) return true;
      if (r.fitId) return false;
      var k = r.date + '|' + r.cents + '|' + payeeKey(r.payee);
      if (count[k] > 0) { count[k] -= 1; return true; }
      return false;
    });
  }

  // ---------- Compound interest (the calculator's method) ----------
  // Monthly compounding, money added at the end of each month, yearly rate / 12
  // credited each month, each figure in closed form, only the final figure
  // rounded half up to the cent:
  //   balance after m months = S(1 + i)^m + A((1 + i)^m - 1) / i,  i = r / 12
  // compoundSavings({ start, monthly, ratePct, years }) (dollars) ->
  //   { months, final, putIn, interest, exact, points, putInPoints, yearly: [{ year, balance, putIn }] }
  // Check: 2,400 to start, 150 a month, example 5%, 10 years = 27,245.16;
  // 20 years = 68,165.39; at 0% exactly the money put in.
  function compoundSavings(inp) {
    var i = inp.ratePct / 100 / 12, lg = inp.ratePct === 0 ? 0 : Math.log1p(i), n = inp.years * 12;
    function at(m) {
      var annuity = i === 0 ? m : Math.expm1(m * lg) / i;
      return inp.start * Math.exp(m * lg) + inp.monthly * annuity;
    }
    var points = [], putIn = [];
    for (var m = 0; m <= n; m++) { points.push(at(m)); putIn.push(inp.start + inp.monthly * m); }
    var exact = at(n), put = inp.start + inp.monthly * n;
    return {
      months: n, final: round2(exact), putIn: round2(put), interest: round2(exact - put),
      exact: exact, points: points, putInPoints: putIn,
      yearly: points.filter(function (v, k) { return k % 12 === 0; }).map(function (v, y) {
        return { year: y, balance: round2(v), putIn: round2(putIn[y * 12]) };
      })
    };
  }

  var api = {
    compoundSavings: compoundSavings,
    // working app: totals from stored records (cents)
    GROUP_IDS: GROUP_IDS, PERIODS: PERIODS, typeGroup: typeGroup, isDebtType: isDebtType, divRound: divRound, divUp: divUp,
    localDate: localDate, monthOf: monthOf, monthEnd: monthEnd, monthsEnding: monthsEnding, dayLong: dayLong, dateLong: dateLong, moneyCents: moneyCents,
    balanceIndex: balanceIndex, entryOn: entryOn, totalsOn: totalsOn, netWorthByMonth: netWorthByMonth, hasBalanceOn: hasBalanceOn,
    changeBetweenDates: changeBetweenDates, averageChangeCents: averageChangeCents, illustrateCents: illustrateCents, sharesCents: sharesCents,
    partsOf: partsOf, linesInMonth: linesInMonth, indexById: indexById, cashFlowMonth: cashFlowMonth, spendingByCategoryMonth: spendingByCategoryMonth,
    notYetGivenAJob: notYetGivenAJob, budgetMonth: budgetMonth, perMonthCents: perMonthCents, perMonthAndPay: perMonthAndPay,
    ruleCategory: ruleCategory, payeeKey: payeeKey, matchDuplicates: matchDuplicates,
    // prototype (sample-shaped data, dollars)
    MINUS: MINUS, toCents: toCents, fromCents: fromCents, sum: sum, round2: round2,
    monthCount: monthCount, lastIndex: lastIndex, group: group, accountsIn: accountsIn,
    groupTotal: groupTotal, groupSeries: groupSeries, assets: assets, debts: debts,
    netWorth: netWorth, netSeries: netSeries, changeBetween: changeBetween,
    averageMonthlyChange: averageMonthlyChange, illustrate: illustrate, shares: shares,
    spendingByCategory: spendingByCategory, totalWhere: totalWhere, recent: recent, categoryName: categoryName,
    money: money, axisMoney: axisMoney, number: number, pct: pct,
    monthShort: monthShort, monthLong: monthLong, dayShort: dayShort, addMonths: addMonths,
    balancesCsv: balancesCsv, cleanMarkets: cleanMarkets, direction: direction, checkTies: checkTies
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SWCalc = api;
})(this);
