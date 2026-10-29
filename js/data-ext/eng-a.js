/* Stepwell Financial prototype: extra sample data and pure calculations for
   the Accounts, Transactions and Cash flow screens.
   PURE: no DOM, no globals read, no side effects, so it can be tested alone
   (open tests/eng-a.html). Money is added in whole cents.

   WHAT THIS TIES TO (checkEngA() tests every line):
   - It adds no accounts, balances or transactions. Every figure on the three
     screens is worked out from the main sample file: the same 9 accounts and
     the same 50 October lines.
   - Rules only describe categories the lines already have: every line a rule
     matches is already in that rule's category.
   - Each split's parts add up to its line and keep the line's category, so
     every category total is unchanged (Groceries stays 412.00).
   - Cash flow, 1 to 28 Oct: in 5,200.00 (2 x 2,425.00 payroll + 350.00 side
     work); out 4,022.00 = bills 1,010.00 + budget categories 3,012.00
     (Housing 1,650.00, Groceries 412.00, Eating out 310.00, Transport 290.00,
     Everything else 350.00 = Fun 140.00 + Other 210.00); not spent
     5,200.00 - 4,022.00 = 1,178.00.
   - Change since 30 Sep, account by account, adds up to +1,212.40.
   - The bank's text added for some lines is invented and generic. */
(function (root) {
  'use strict';

  var MINUS = '−';

  var ext = {
    // A rule was made on the day the reader first put a line in a category.
    // It then sets the category of matching lines dated after that day.
    rules: [
      { id: 'r-bluedoor', match: 'BLUE DOOR', cat: 'eating', made: '2026-10-12' },
      { id: 'r-corner', match: 'Corner Market', cat: 'groceries', made: '2026-10-04' },
      { id: 'r-transit', match: 'Transit card', cat: 'transport', made: '2026-10-03' },
      { id: 'r-payroll', match: 'Payroll deposit', cat: 'income', made: '2026-10-10' }
    ],

    // Parts keep the line's category; the labels are the reader's own tags.
    splits: [
      { date: '2026-10-27', text: 'Corner Market', amount: -43.58,
        parts: [{ label: 'Household', amount: -30.08 }, { label: 'Personal', amount: -13.50 }] }
    ],

    // The bank's own text, for imported lines the reader renamed.
    bankText: [
      { date: '2026-10-03', text: 'Transit card top-up', bank: 'POS TRANSIT CARD 2291' },
      { date: '2026-10-08', text: 'Car loan payment', bank: 'ACH DEBIT AUTO LN PMT 0008' },
      { date: '2026-10-10', text: 'Payroll deposit', bank: 'DIR DEP PAYROLL 5512' },
      { date: '2026-10-10', text: 'Transit card top-up', bank: 'POS TRANSIT CARD 2291' },
      { date: '2026-10-15', text: 'Student loan payment', bank: 'ACH DEBIT STDNT LN PMT 4410' },
      { date: '2026-10-17', text: 'Transit card top-up', bank: 'POS TRANSIT CARD 2291' },
      { date: '2026-10-24', text: 'Transit card top-up', bank: 'POS TRANSIT CARD 2291' },
      { date: '2026-10-25', text: 'Payroll deposit', bank: 'DIR DEP PAYROLL 5527' }
    ],

    // Pre-written explainers for common prefixes in a bank's text. No AI.
    explainers: [
      { prefix: 'SQ *', means: '“SQ *” is how some card terminals mark a payment taken through a payment service.',
        nameIs: 'the seller’s name', codeIs: 'part of the terminal’s code, not a date' },
      { prefix: 'POS ', means: '“POS” means point of sale: a card payment made in person, at a card reader.',
        nameIs: 'the seller’s name', codeIs: 'the card reader’s number' },
      { prefix: 'ACH DEBIT ', means: '“ACH” is the system US banks use to move money from one account to another. “DEBIT” means the money went out of this account.',
        nameIs: 'what the payment is for, as the receiver wrote it', codeIs: 'a reference number for this payment' },
      { prefix: 'DIR DEP ', means: '“DIR DEP” is short for direct deposit: money paid straight into an account, often by an employer.',
        nameIs: 'what the payment is for, as the payer wrote it', codeIs: 'a reference number for this payment' }
    ],
    shortWords: { LN: 'loan', PMT: 'payment', STDNT: 'student', AUTO: 'car' },

    // Cash flow groups. Fun and Other share one group, as on the approved look.
    flowGroups: [
      { id: 'housing', name: 'Housing', cats: ['housing'] },
      { id: 'groceries', name: 'Groceries', cats: ['groceries'] },
      { id: 'eating', name: 'Eating out', cats: ['eating'] },
      { id: 'transport', name: 'Transport', cats: ['transport'] },
      { id: 'else', name: 'Everything else', cats: ['fun', 'other'] }
    ],

    expected: { outOct: 4022.00, notSpentOct: 1178.00, elseOct: 350.00, rulesUsed: { 'r-bluedoor': 2, 'r-corner': 4, 'r-transit': 3, 'r-payroll': 1 } }
  };

  // ---------- Cents ----------
  function toCents(v) { return Math.round(Number(v) * 100); }
  function sumCents(values) { var c = 0; for (var i = 0; i < values.length; i++) c += toCents(values[i]); return c; }
  function sum(values) { return sumCents(values) / 100; }

  // ---------- Lookups ----------
  function find(list, test) { for (var i = 0; i < list.length; i++) if (test(list[i])) return list[i]; return null; }
  function catName(data, id) { var c = find(data.categories, function (x) { return x.id === id; }); return c ? c.name : id; }
  function account(data, id) { return find(data.accounts, function (a) { return a.id === id; }); }
  function sameLine(t, x) { return x.date === t.date && x.text === t.text && (x.amount === undefined || toCents(x.amount) === toCents(t.amount)); }
  function bankText(t) { var b = find(ext.bankText, function (x) { return sameLine(t, x); }); return b ? b.bank : null; }
  function splitOf(t) { return find(ext.splits, function (x) { return sameLine(t, x); }); }
  function inMonth(t, month) { return t.date.slice(0, 7) === month; }
  function lines(data, month) {
    return data.transactions.map(function (t, i) { return { t: t, i: i }; })
      .filter(function (x) { return !month || inMonth(x.t, month); });
  }

  // ---------- Rules ----------
  function ruleMatches(rule, t) {
    var hay = (t.text + ' ' + (bankText(t) || '')).toLowerCase();
    return hay.indexOf(String(rule.match).toLowerCase()) >= 0;
  }
  // Why a line is in its category: { kind: 'rule' | 'made-rule' | 'you', rule }
  function categorySource(t) {
    var rule = find(ext.rules, function (r) { return r.cat === t.cat && ruleMatches(r, t); });
    if (!rule || t.date < rule.made) return { kind: 'you', rule: null };
    if (t.date === rule.made) return { kind: 'made-rule', rule: rule };
    return { kind: 'rule', rule: rule };
  }
  // Lines a rule has set by itself (dated after it was made).
  function ruleUsed(data, rule) {
    return lines(data).filter(function (x) { return x.t.date > rule.made && ruleMatches(rule, x.t); });
  }
  // What a new rule would match in a month. Text under 2 characters matches nothing.
  function previewRule(data, matchText, cat, month) {
    var m = String(matchText || '').trim();
    if (m.length < 2) return { count: 0, total: 0, inCat: 0 };
    var hit = lines(data, month).filter(function (x) { return ruleMatches({ match: m }, x.t); });
    return {
      count: hit.length,
      total: sum(hit.map(function (x) { return x.t.amount; })),
      inCat: hit.filter(function (x) { return x.t.cat === cat; }).length
    };
  }

  // ---------- Explain this line ----------
  // Decodes the bank's text with the pre-written explainers. null if none fits.
  function explainLine(text) {
    var s = String(text || '');
    var ex = find(ext.explainers, function (e) { return s.toUpperCase().indexOf(e.prefix) === 0; });
    if (!ex) return null;
    var rest = s.slice(ex.prefix.length).trim();
    var m = rest.match(/^(.*?)\s+(\d{3,})$/);
    var name = m ? m[1] : rest, code = m ? m[2] : null;
    var words = name.split(/\s+/).filter(function (w) { return ext.shortWords[w.toUpperCase()]; })
      .map(function (w) { return { word: w, means: ext.shortWords[w.toUpperCase()] }; });
    return { prefix: ex.prefix.trim(), means: ex.means, name: name, nameIs: ex.nameIs, code: code, codeIs: code ? ex.codeIs : null, words: words };
  }

  // ---------- Search ----------
  // "eating out over $20" -> { words: ['eating', 'out'], over: 2000, under: null } (cents)
  function parseQuery(q) {
    var s = String(q || '').toLowerCase().replace(/[“”"]/g, ' ');
    var over = null, under = null;
    var num = '\\$?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)';
    s = s.replace(new RegExp('(?:^|\\s)(?:over|above|more than)\\s*' + num, 'g'), function (all, n) { over = toCents(n.replace(/,/g, '')); return ' '; });
    s = s.replace(new RegExp('(?:^|\\s)(?:under|below|less than)\\s*' + num, 'g'), function (all, n) { under = toCents(n.replace(/,/g, '')); return ' '; });
    var words = s.split(/\s+/).map(function (w) { return w.replace(/^\$/, ''); }).filter(Boolean);
    return { words: words, over: over, under: under };
  }
  function haystack(data, t) {
    var a = account(data, t.account);
    var sp = splitOf(t);
    return [t.text, bankText(t) || '', catName(data, t.cat), a ? a.name : '',
      (Math.abs(toCents(t.amount)) / 100).toFixed(2), sp ? sp.parts.map(function (p) { return p.label; }).join(' ') : '']
      .join(' ').toLowerCase();
  }
  // opts: { query, cat, account, month }. Returns [{t, i}] in data order.
  function filterLines(data, opts) {
    opts = opts || {};
    var q = parseQuery(opts.query);
    return lines(data, opts.month).filter(function (x) {
      var t = x.t, abs = Math.abs(toCents(t.amount));
      if (opts.cat && t.cat !== opts.cat) return false;
      if (opts.account && t.account !== opts.account) return false;
      if (q.over !== null && !(abs > q.over)) return false;
      if (q.under !== null && !(abs < q.under)) return false;
      var hay = haystack(data, t);
      return q.words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
  }
  // Newest day first; within a day, the line entered last comes first.
  function byDay(list) {
    var sorted = list.slice().sort(function (a, b) { return a.t.date < b.t.date ? 1 : a.t.date > b.t.date ? -1 : b.i - a.i; });
    var days = [];
    sorted.forEach(function (x) {
      var d = days.length ? days[days.length - 1] : null;
      if (!d || d.date !== x.t.date) { d = { date: x.t.date, lines: [] }; days.push(d); }
      d.lines.push(x);
    });
    days.forEach(function (d) { d.total = sum(d.lines.map(function (x) { return x.t.amount; })); });
    return days;
  }
  // "2026-10-27" -> "Tue 27 Oct". Works from the date text; the clock is never read.
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dayLabel(date) {
    var y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)), d = Number(date.slice(8, 10));
    return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + ' ' + d + ' ' + MONTHS[m - 1];
  }
  function totals(list) {
    var amts = list.map(function (x) { return x.t ? x.t.amount : x.amount; });
    return {
      count: amts.length,
      moneyIn: sum(amts.filter(function (v) { return v > 0; })),
      moneyOut: sum(amts.filter(function (v) { return v < 0; })),
      net: sum(amts)
    };
  }
  function byCategory(data, month) {
    return data.categories.map(function (c) {
      var ls = lines(data, month).filter(function (x) { return x.t.cat === c.id; });
      return { id: c.id, name: c.name, count: ls.length, total: sum(ls.map(function (x) { return x.t.amount; })) };
    }).filter(function (c) { return c.count > 0; });
  }

  // ---------- Splits ----------
  // "12.5", "$1,200.00" -> cents; null if not a plain positive amount.
  function parseAmount(str) {
    var s = String(str === undefined || str === null ? '' : str).replace(/[$,\s]/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
    return toCents(s);
  }
  // Parts are typed as positive amounts. left > 0: still to give a part;
  // left < 0: parts add up to more than the line.
  function splitCheck(lineAmount, partCents) {
    var line = Math.abs(toCents(lineAmount)), given = 0, bad = 0;
    partCents.forEach(function (c) { if (c === null) bad += 1; else given += c; });
    return { line: line, given: given, left: line - given, bad: bad };
  }

  // ---------- Cash flow ----------
  function cashFlow(data, month) {
    var ls = lines(data, month);
    var pick = function (test) { return ls.filter(function (x) { return test(x.t); }); };
    var inL = pick(function (t) { return t.cat === 'income'; });
    var billL = pick(function (t) { return t.cat === 'bills'; });
    var spendL = pick(function (t) { return t.cat !== 'income' && t.cat !== 'bills'; });
    var cats = data.categories.filter(function (c) { return c.budget !== null; }).map(function (c) {
      var l = spendL.filter(function (x) { return x.t.cat === c.id; });
      return { id: c.id, name: c.name, lines: l, total: -sum(l.map(function (x) { return x.t.amount; })) };
    });
    var groups = ext.flowGroups.map(function (g) {
      var parts = cats.filter(function (c) { return g.cats.indexOf(c.id) >= 0; });
      return { id: g.id, name: g.name, parts: parts, total: sum(parts.map(function (c) { return c.total; })),
        lines: [].concat.apply([], parts.map(function (c) { return c.lines; })) };
    });
    var moneyIn = sum(inL.map(function (x) { return x.t.amount; }));
    var bills = -sum(billL.map(function (x) { return x.t.amount; }));
    var spent = sum(groups.map(function (g) { return g.total; }));
    var out = sum([bills, spent]);
    return { month: month, moneyIn: moneyIn, inLines: inL, bills: bills, billLines: billL, spent: spent,
      cats: cats, groups: groups, out: out, notSpent: sum([moneyIn, -out]),
      lastDay: ls.reduce(function (d, x) { return x.t.date > d ? x.t.date : d; }, '') };
  }

  // ---------- Accounts ----------
  function accountChange(acct, from, to) { return sum([acct.history[to], -acct.history[from]]); }
  // Plain words for a change; debts are negative balances.
  function changeWords(kind, amount) {
    var c = toCents(amount);
    if (c === 0) return { word: 'No change', amount: 0 };
    if (kind === 'debt') return { word: c > 0 ? 'You owe less' : 'You owe more', amount: Math.abs(c) / 100 };
    return { word: c > 0 ? 'Up' : 'Down', amount: Math.abs(c) / 100 };
  }
  function accountLines(data, id, month) { return lines(data, month).filter(function (x) { return x.t.account === id; }); }

  // ---------- Axis for small charts ----------
  function niceAxis(lo, hi, maxTicks) {
    lo = Math.min(0, lo); hi = Math.max(0, hi);
    var span = hi - lo || 1, raw = span / Math.max(1, maxTicks || 4);
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), step = mag;
    [1, 2, 2.5, 5, 10].some(function (m) { step = m * mag; return step >= raw; });
    var top = Math.ceil(hi / step) * step, bot = Math.floor(lo / step) * step;
    if (top === bot) top = bot + step;
    return { step: step, top: top, bot: bot };
  }
  function axisLabel(v) {
    if (v === 0) return '$0';
    var a = Math.abs(v), s = a >= 1000 ? (Math.round(a / 100) / 10).toString() + 'k' : String(Math.round(a));
    return (v < 0 ? MINUS : '') + '$' + s;
  }

  // ---------- Ties ----------
  function checkEngA(data) {
    var out = [];
    function eq(name, got, want) { out.push({ name: name, ok: toCents(got) === toCents(want), got: got, want: want }); }
    var E = data.expected, X = ext.expected;
    var oct = data.months[data.months.length - 1];
    var cf = cashFlow(data, oct);
    eq('Cash flow: money in', cf.moneyIn, E.incomeOct);
    eq('Cash flow: money in = its lines', sum(cf.inLines.map(function (x) { return x.t.amount; })), cf.moneyIn);
    eq('Cash flow: bills', cf.bills, E.billsTotal);
    eq('Cash flow: budget categories', cf.spent, E.spentOct);
    eq('Cash flow: out = bills + budget categories', cf.out, X.outOct);
    eq('Cash flow: not spent = in - out', cf.notSpent, X.notSpentOct);
    eq('Cash flow: Everything else = Fun + Other', cf.groups[4].total, X.elseOct);
    eq('Cash flow: flows + not spent = money in', sum(cf.groups.map(function (g) { return g.total; }).concat([cf.bills, cf.notSpent])), cf.moneyIn);
    var lineCount = cf.inLines.length + cf.billLines.length + cf.groups.reduce(function (n, g) { return n + g.lines.length; }, 0);
    out.push({ name: 'Cash flow: every October line counted once', ok: lineCount === lines(data, oct).length, got: lineCount, want: lines(data, oct).length });
    ext.rules.forEach(function (r) {
      var bad = lines(data).filter(function (x) { return ruleMatches(r, x.t) && x.t.cat !== r.cat; }).length;
      out.push({ name: 'Rule "' + r.match + '": every match already in ' + catName(data, r.cat), ok: bad === 0, got: bad, want: 0 });
      var used = ruleUsed(data, r).length;
      out.push({ name: 'Rule "' + r.match + '": lines it set', ok: used === X.rulesUsed[r.id], got: used, want: X.rulesUsed[r.id] });
    });
    ext.splits.forEach(function (sp) {
      var t = find(data.transactions, function (x) { return sameLine(x, sp); });
      out.push({ name: 'Split ' + sp.text + ' ' + sp.date + ': line exists', ok: !!t, got: !!t, want: true });
      eq('Split ' + sp.text + ' ' + sp.date + ': parts add up', sum(sp.parts.map(function (p) { return p.amount; })), t ? t.amount : NaN);
    });
    ext.bankText.forEach(function (b) {
      var t = find(data.transactions, function (x) { return sameLine(x, b); });
      out.push({ name: 'Bank text for ' + b.text + ' ' + b.date + ': line exists', ok: !!t, got: !!t, want: true });
    });
    var last = data.months.length - 1;
    eq('Change since 30 Sep, by account, adds up', sum(data.accounts.map(function (a) { return accountChange(a, last - 1, last); })), E.change);
    var ab = lines(data, oct).filter(function (x) { return data.accounts.some(function (a) { return a.id === x.t.account; }); }).length;
    out.push({ name: 'Every line names a known account', ok: ab === lines(data, oct).length, got: ab, want: lines(data, oct).length });
    return out;
  }

  // =====================================================================
  // The working app: helpers for the Accounts, Transactions and Cash flow
  // screens on stored records. Every amount is whole cents. Totals come from
  // the calculation module, passed in as C (SWCalc), so nothing here adds
  // money a second way.
  // =====================================================================

  // An account's balance at each month end (today for this month), from its
  // first entry on. -> [{ month, date, cents, entry }]  (debts: amount owed)
  function accountSeries(C, account, balanceIdx, today, n) {
    var idx = Array.isArray(balanceIdx) ? C.balanceIndex(balanceIdx) : balanceIdx;
    var list = idx[account.id] || [], g = C.typeGroup(account.type);
    if (!list.length) return [];
    var months = C.monthsEnding(C.monthOf(today), n || 13);
    var rows = C.netWorthByMonth([account], idx, months, today);
    return rows.map(function (r) {
      return { month: r.month, date: r.date, cents: r.groups[g], entry: C.entryOn(list, r.date) };
    }).filter(function (r) { return !!r.entry; });
  }

  // The month end before today's month: the date "What changed?" compares with.
  function previousMonthEnd(C, today) { return C.monthEnd(C.addMonths(C.monthOf(today), -1)); }

  // How one account moved between two dates, in plain words.
  // debt: the amount owed went up ('more') or down ('less').
  // -> { kind: 'none' | 'new' | 'up' | 'down' | 'more' | 'less', cents, firstDate }
  function accountMove(C, account, balanceIdx, fromDate, toDate) {
    var idx = Array.isArray(balanceIdx) ? C.balanceIndex(balanceIdx) : balanceIdx;
    var list = idx[account.id] || [], debt = C.isDebtType(account.type);
    var a = C.entryOn(list, fromDate), b = C.entryOn(list, toDate);
    if (!b) return { kind: 'none', cents: 0, firstDate: null };
    if (!a) return { kind: 'new', cents: b.cents, firstDate: list[0].date };
    var d = b.cents - a.cents;
    if (d === 0) return { kind: 'none', cents: 0, firstDate: null };
    if (debt) return { kind: d > 0 ? 'more' : 'less', cents: Math.abs(d), firstDate: null };
    return { kind: d > 0 ? 'up' : 'down', cents: Math.abs(d), firstDate: null };
  }

  // Balance entries for one account, newest first (ties: the later one first).
  function entriesFor(balances, accountId) {
    return balances.filter(function (b) { return b.accountId === accountId; }).sort(function (x, y) {
      return x.date < y.date ? 1 : x.date > y.date ? -1 : (x.createdAt < y.createdAt ? 1 : x.createdAt > y.createdAt ? -1 : 0);
    });
  }

  // "22.9", "22.9%" -> { ok: true, bps: 2290 }; '' -> { ok: true, bps: null }.
  // maxBps: 10000 for an interest rate, 1000 for a fund cost.
  function parsePercentBps(text, maxBps) {
    var s = String(text === undefined || text === null ? '' : text).trim();
    if (s.charAt(s.length - 1) === '%') s = s.slice(0, -1).trim();
    if (s === '') return { ok: true, bps: null };
    if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, message: 'Enter a number, like 22.9.' };
    var parts = s.split('.');
    if (parts[1] && parts[1].length > 2) return { ok: false, message: 'Use at most 2 decimal places.' };
    var bps = Number(parts[0]) * 100 + Number(((parts[1] || '') + '00').slice(0, 2));
    if (bps > maxBps) return { ok: false, message: 'Use ' + (maxBps / 100) + '% or less.' };
    return { ok: true, bps: bps };
  }
  // 2290 -> "22.9", 20 -> "0.2", null -> ''
  function bpsText(bps) {
    if (bps === null || bps === undefined) return '';
    var whole = Math.floor(bps / 100), frac = String(bps % 100 + 100).slice(1).replace(/0+$/, '');
    return whole + (frac ? '.' + frac : '');
  }

  // The last four digits field: '' or exactly 4 digits. -> '' or a message.
  function lastFourMessage(text) {
    var s = String(text || '').trim();
    if (s === '') return '';
    var digits = s.replace(/\D/g, '');
    if (digits.length !== s.length) return 'Use digits only, like 4021.';
    if (s.length !== 4) return 'This has ' + s.length + (s.length === 1 ? ' digit' : ' digits') + '. Use 4, so the full number is never stored.';
    return '';
  }

  // A money input shown back after blur: 123450 -> "1,234.50", -1200 -> "-12.00".
  function moneyInputText(C, cents) { return (cents < 0 ? '-' : '') + C.moneyCents(Math.abs(cents)).slice(1); }

  // ---------- Transactions on stored records ----------
  // Months that have lines, newest first.
  function monthsWithLines(lines) {
    var seen = {}, out = [];
    lines.forEach(function (t) { var m = t.date.slice(0, 7); if (!seen[m]) { seen[m] = true; out.push(m); } });
    return out.sort().reverse();
  }
  // The rule that would set a payee's category: first by order whose text is
  // in the payee, case ignored (the store's own rule). -> rule or null
  function ruleFor(rules, payee) {
    var p = String(payee || '').toLowerCase();
    var sorted = rules.slice().sort(function (a, b) { return a.order - b.order; });
    for (var i = 0; i < sorted.length; i++) if (p.indexOf(sorted[i].text.toLowerCase()) >= 0) return sorted[i];
    return null;
  }
  // The text a search reads for one line: payee, note, category names
  // (split parts too), account name and the amount without its sign.
  function lineHaystack(t, look) {
    var cats = t.splits && t.splits.length ? t.splits.map(function (p) { return look.catName(p.categoryId); }) : [look.catName(t.categoryId)];
    return [t.payee, t.note || '', cats.join(' '), look.acctName(t.accountId), (Math.abs(t.cents) / 100).toFixed(2)].join(' ').toLowerCase();
  }
  // opts: { query, month, categoryId ('none' = uncategorised), accountId, importId }
  // look: { catName(id), acctName(id) }. Returns the matching lines.
  function filterStoreLines(lines, opts, look) {
    opts = opts || {};
    var q = parseQuery(opts.query);
    return lines.filter(function (t) {
      var abs = Math.abs(t.cents);
      if (opts.month && t.date.slice(0, 7) !== opts.month) return false;
      if (opts.accountId && t.accountId !== opts.accountId) return false;
      if (opts.importId && t.importId !== opts.importId) return false;
      if (opts.categoryId) {
        var ids = t.splits && t.splits.length ? t.splits.map(function (p) { return p.categoryId; }) : [t.categoryId];
        if (opts.categoryId === 'none' ? ids.indexOf(null) < 0 : ids.indexOf(opts.categoryId) < 0) return false;
      }
      if (q.over !== null && !(abs > q.over)) return false;
      if (q.under !== null && !(abs < q.under)) return false;
      var hay = lineHaystack(t, look);
      return q.words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
  }
  // Newest day first; within a day, the line added last first.
  // -> [{ date, lines, totalCents }]
  function daysOf(lines) {
    var sorted = lines.slice().sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);
    });
    var days = [];
    sorted.forEach(function (t) {
      var d = days.length ? days[days.length - 1] : null;
      if (!d || d.date !== t.date) { d = { date: t.date, lines: [], totalCents: 0 }; days.push(d); }
      d.lines.push(t);
      d.totalCents += t.cents;
    });
    return days;
  }
  // { count, inCents, outCents } for any list of lines (out is negative).
  function lineTotals(lines) {
    var r = { count: lines.length, inCents: 0, outCents: 0 };
    lines.forEach(function (t) { if (t.cents > 0) r.inCents += t.cents; else r.outCents += t.cents; });
    return r;
  }
  // Per category for one month: count of parts and their total (signed),
  // plus the uncategorised parts. Split parts count in their own category.
  // -> [{ categoryId, name, kind, count, cents }] in category order, then uncategorised.
  function categoryTotals(lines, categories, month) {
    var by = {}, none = { categoryId: null, name: 'No category', kind: null, count: 0, cents: 0 };
    lines.forEach(function (t) {
      if (month && t.date.slice(0, 7) !== month) return;
      var parts = t.splits && t.splits.length ? t.splits : [{ categoryId: t.categoryId, cents: t.cents }];
      parts.forEach(function (p) {
        var x = p.categoryId ? (by[p.categoryId] = by[p.categoryId] || { count: 0, cents: 0 }) : none;
        x.count += 1;
        x.cents += p.cents;
      });
    });
    var out = categories.map(function (c) {
      var x = by[c.id] || { count: 0, cents: 0 };
      return { categoryId: c.id, name: c.name, kind: c.kind, count: x.count, cents: x.cents };
    });
    // Order: those with lines first (money in, spending largest first,
    // transfers), then the empty ones by name; "No category" last.
    var rank = { income: 0, expense: 1, transfer: 2 };
    out.sort(function (a, b) {
      if (!a.count !== !b.count) return a.count ? -1 : 1;
      if (!a.count) return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
      if (rank[a.kind] !== rank[b.kind]) return rank[a.kind] - rank[b.kind];
      if (Math.abs(b.cents) !== Math.abs(a.cents)) return Math.abs(b.cents) - Math.abs(a.cents);
      return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
    });
    if (none.count) out.push(none);
    return out;
  }
  // What a new rule would match. Rules fill only lines added later with no
  // category chosen, so this is a preview of a month, not a change.
  function previewStoreRule(lines, text, categoryId, month) {
    var m = String(text || '').trim().toLowerCase();
    if (m.length < 2) return { count: 0, totalCents: 0, inCat: 0, none: 0 };
    var hit = lines.filter(function (t) { return (!month || t.date.slice(0, 7) === month) && String(t.payee).toLowerCase().indexOf(m) >= 0; });
    return {
      count: hit.length,
      totalCents: hit.reduce(function (s, t) { return s + t.cents; }, 0),
      inCat: hit.filter(function (t) { return t.categoryId === categoryId; }).length,
      none: hit.filter(function (t) { return t.categoryId === null && !(t.splits && t.splits.length); }).length
    };
  }
  // Split rows as typed (positive amounts) against a line in cents.
  // -> { left (cents still to place; below 0 = over), bad (unreadable rows), parts: [cents signed like the line] }
  function splitStatus(lineCents, typed) {
    var sign = lineCents < 0 ? -1 : 1, given = 0, bad = 0, parts = [];
    typed.forEach(function (c) {
      if (c === null) { bad += 1; parts.push(null); return; }
      given += Math.abs(c);
      parts.push(sign * Math.abs(c));
    });
    return { left: Math.abs(lineCents) - given, bad: bad, parts: parts };
  }
  // The store's format name for an import, from the parser's kind and the file name.
  function importFormat(kind, fileName) {
    if (kind === 'ofx') return /\.qfx$/i.test(String(fileName || '')) ? 'qfx' : 'ofx';
    return 'csv';
  }
  // Step I3 counts: rows the parser read, those the store already has, and
  // lines it couldn't read. new + already + unreadable = lines in the file.
  function importCheck(result, dupFlags) {
    var already = dupFlags.filter(Boolean).length;
    return { read: result.rows.length, already: already, fresh: result.rows.length - already, unreadable: result.stats.skipped };
  }

  // ---------- Cash flow on stored records ----------
  // Five colour slots for spending (identity A-I3, fix list M3): four cat-
  // tokens for the four largest categories (Bills is one of them if it is
  // large), and muted for one named group of all the rest. "Not spent" is
  // not a category: it is drawn as an outline only.
  // cat-other goes first, so the fourth slot (next to the muted group) is
  // iris, which looks clearly different from muted in both themes.
  var FLOW_TOKENS = ['other', 'property', 'cash', 'invest'];
  // plan(cf) from SWCalc.cashFlowMonth ->
  //   { flows: [{ id, name, cents, token, parts: [{ categoryId, name, cents, count }] }],
  //     flowsCents, notSpentCents (in - drawn flows, 0 if none), leftCents, basis: 'in' | 'out',
  //     undrawn: [parts not drawn because together they are $0.00 or less (money back)] }
  function flowPlan(cf) {
    var byName = function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; };
    var pos = cf.expense.filter(function (c) { return c.cents > 0; }).sort(function (a, b) { return b.cents - a.cents || byName(a, b); });
    var neg = cf.expense.filter(function (c) { return c.cents <= 0; }).sort(byName);
    var flows = [], undrawn = [];
    function own(c, i) { flows.push({ id: c.categoryId, name: c.name, cents: c.cents, token: i < 4 ? FLOW_TOKENS[i] : 'muted', parts: [c] }); }
    if (pos.length <= 5 && !neg.length) pos.forEach(own);
    else {
      pos.slice(0, 4).forEach(own);
      var rest = pos.slice(4).concat(neg), restCents = rest.reduce(function (s, c) { return s + c.cents; }, 0);
      if (rest.length && restCents > 0) {
        flows.push({ id: 'else', name: 'Everything else (' + rest.map(function (c) { return c.name; }).join(', ') + ')', cents: restCents, token: 'muted', parts: rest });
      } else undrawn = rest;
    }
    var flowsCents = flows.reduce(function (s, f) { return s + f.cents; }, 0);
    var basis = cf.inCents >= flowsCents ? 'in' : 'out';
    return { flows: flows, flowsCents: flowsCents, basis: basis, undrawn: undrawn,
      notSpentCents: basis === 'in' ? cf.inCents - flowsCents : 0,
      leftCents: basis === 'in' ? cf.inCents : flowsCents };
  }
  // The lines (or split parts) in one category in a month, oldest first.
  // -> [{ t, cents }]
  function partsIn(lines, categoryId, month) {
    var out = [];
    lines.forEach(function (t) {
      if (month && t.date.slice(0, 7) !== month) return;
      var parts = t.splits && t.splits.length ? t.splits : [{ categoryId: t.categoryId, cents: t.cents }];
      parts.forEach(function (p) { if (p.categoryId === categoryId) out.push({ t: t, cents: p.cents }); });
    });
    return out.sort(function (a, b) { return a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : (a.t.createdAt < b.t.createdAt ? -1 : 1); });
  }

  var api = {
    flowPlan: flowPlan, partsIn: partsIn,
    monthsWithLines: monthsWithLines, ruleFor: ruleFor, lineHaystack: lineHaystack, filterStoreLines: filterStoreLines,
    daysOf: daysOf, lineTotals: lineTotals, categoryTotals: categoryTotals, previewStoreRule: previewStoreRule,
    splitStatus: splitStatus, importFormat: importFormat, importCheck: importCheck,
    accountSeries: accountSeries, previousMonthEnd: previousMonthEnd, accountMove: accountMove, entriesFor: entriesFor,
    parsePercentBps: parsePercentBps, bpsText: bpsText, lastFourMessage: lastFourMessage, moneyInputText: moneyInputText,
    ext: ext, toCents: toCents, sum: sum, catName: catName, account: account,
    bankText: bankText, splitOf: splitOf, categorySource: categorySource, ruleMatches: ruleMatches,
    ruleUsed: ruleUsed, previewRule: previewRule, explainLine: explainLine,
    parseQuery: parseQuery, filterLines: filterLines, byDay: byDay, dayLabel: dayLabel, totals: totals, byCategory: byCategory,
    parseAmount: parseAmount, splitCheck: splitCheck, cashFlow: cashFlow,
    accountChange: accountChange, changeWords: changeWords, accountLines: accountLines,
    niceAxis: niceAxis, axisLabel: axisLabel, checkEngA: checkEngA
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SWEngA = api;
})(this);
