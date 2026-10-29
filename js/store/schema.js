/* Stepwell Financial: the data schema, input rules and record checks.
   PURE: no DOM, no storage, no clock (the caller passes "today"), so it can be
   tested alone and used anywhere. The store (js/store/store.js) runs every
   record through validate() before it is saved, and restore runs a whole
   backup through validateData().

   Money is whole cents, a safe integer. Dates are YYYY-MM-DD, months YYYY-MM.
   A record never holds HTML or code: text is checked for length and control
   characters, and is only ever shown through textContent. */
(function (root) {
  'use strict';

  var VERSION = 2;               // schemaVersion of the database and of backups (2 adds the profile store)
  var APP = 'stepwell-financial'; // the "app" field of a backup file
  var MAX_CENTS = 10000000000;   // plus or minus $100,000,000.00
  var MIN_DATE = '1900-01-01', MAX_DATE = '2100-12-31';

  // Text caps, also used by every input on every screen (SW.dom.cap).
  var TEXT = { name: 80, note: 500, search: 200, payee: 500, rule: 80, fileName: 80, scoreNote: 80, passphrase: 1024, money: 24, bucket: 80, displayName: 40 };

  // How many records each store may hold. balancesPerAccount is per account.
  var CAPS = { accounts: 100, balancesPerAccount: 1000, transactions: 50000, categories: 100, rules: 200,
    budgets: 200, payPlans: 20, bills: 200, goals: 50, scenarios: 20, scores: 120, imports: 50, profile: 1 };
  var CAP_WORDS = { accounts: 'accounts', balances: 'balance entries for one account', transactions: 'lines',
    categories: 'categories', rules: 'rules', budgets: 'budget months', payPlans: 'pay templates', bills: 'bills',
    goals: 'goals', scenarios: 'saved scenarios', scores: 'score entries', imports: 'imports in the log', profile: 'names' };

  var ACCOUNT_TYPES = {
    checking: { group: 'cash', debt: false, label: 'Checking' },
    savings: { group: 'cash', debt: false, label: 'Savings' },
    other_cash: { group: 'cash', debt: false, label: 'Other cash' },
    investment: { group: 'invest', debt: false, label: 'Investment' },
    retirement: { group: 'invest', debt: false, label: 'Retirement' },
    property: { group: 'property', debt: false, label: 'Property' },
    other_asset: { group: 'other', debt: false, label: 'Other asset' },
    credit_card: { group: 'card', debt: true, label: 'Credit card' },
    loan: { group: 'loan', debt: true, label: 'Loan' },
    other_debt: { group: 'loan', debt: true, label: 'Other debt' }
  };
  // Groups in display order; token is the colour token (identity A-I3).
  var GROUPS = [
    { id: 'cash', name: 'Cash', kind: 'asset', token: 'cash', abbr: 'C' },
    { id: 'invest', name: 'Investments', kind: 'asset', token: 'invest', abbr: 'I' },
    { id: 'property', name: 'Property', kind: 'asset', token: 'property', abbr: 'P' },
    { id: 'other', name: 'Other assets', kind: 'asset', token: 'other', abbr: 'O' },
    { id: 'card', name: 'Credit cards', kind: 'debt', token: 'card', abbr: 'CC' },
    { id: 'loan', name: 'Loans', kind: 'debt', token: 'loan', abbr: 'L' }
  ];
  var FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
  var PAY_FREQUENCIES = ['weekly', 'biweekly', 'semimonthly', 'monthly'];
  var SOURCES = ['user', 'import', 'sample'];

  // First run: exactly these 10 (spec 9.2).
  var STARTER_CATEGORIES = [
    { name: 'Income', kind: 'income', isFee: false },
    { name: 'Housing', kind: 'expense', isFee: false },
    { name: 'Bills and utilities', kind: 'expense', isFee: false },
    { name: 'Groceries', kind: 'expense', isFee: false },
    { name: 'Transport', kind: 'expense', isFee: false },
    { name: 'Eating out', kind: 'expense', isFee: false },
    { name: 'Fun', kind: 'expense', isFee: false },
    { name: 'Fees', kind: 'expense', isFee: true },
    { name: 'Other', kind: 'expense', isFee: false },
    { name: 'Transfer', kind: 'transfer', isFee: false }
  ];

  // ---------- Field types ----------
  // Each returns an error message, or '' when the value is good.
  // Control characters (0 to 31, 127 to 159) and the line and paragraph
  // separators (8232, 8233), checked by code so no pattern is needed.
  var CTRL = { test: function (s) {
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 32 || (c >= 127 && c <= 159) || c === 8232 || c === 8233) return true;
    }
    return false;
  } };
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isInt(v) { return typeof v === 'number' && Number.isSafeInteger(v); }
  function isDigits(s, min, max) {
    if (s.length < min || s.length > max) return false;
    for (var i = 0; i < s.length; i++) if (s[i] < '0' || s[i] > '9') return false;
    return true;
  }
  function daysIn(y, m) { return [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }
  function isDate(v) {
    if (typeof v !== 'string' || v.length !== 10 || v[4] !== '-' || v[7] !== '-') return false;
    if (!isDigits(v.slice(0, 4), 4, 4) || !isDigits(v.slice(5, 7), 2, 2) || !isDigits(v.slice(8, 10), 2, 2)) return false;
    var y = +v.slice(0, 4), m = +v.slice(5, 7), d = +v.slice(8, 10);
    if (m < 1 || m > 12 || d < 1 || d > daysIn(y, m)) return false;
    return v >= MIN_DATE && v <= MAX_DATE;
  }
  function isMonth(v) { return typeof v === 'string' && v.length === 7 && isDate(v + '-01'); }
  function isIso(v) { return typeof v === 'string' && v.length >= 20 && v.length <= 30 && isDate(v.slice(0, 10)) && v[10] === 'T' && !isNaN(Date.parse(v)); }
  function isId(v) {
    if (typeof v !== 'string' || v.length < 8 || v.length > 64) return false;
    for (var i = 0; i < v.length; i++) {
      var c = v.charCodeAt(i);
      if (!((c >= 48 && c <= 57) || (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 45)) return false;
    }
    return true;
  }

  var T = {
    text: function (o) {
      return function (v) {
        if (typeof v !== 'string') return 'Enter text.';
        if (CTRL.test(v)) return 'Remove the line breaks or special characters.';
        if (v.length < (o.min || 0)) return o.min === 1 ? 'This can’t be empty.' : 'Use at least ' + o.min + ' characters.';
        if (v.length > o.max) return 'Use ' + o.max + ' characters or fewer.';
        return '';
      };
    },
    cents: function (o) {
      o = o || {};
      return function (v) {
        if (!isInt(v)) return 'Enter a number.';
        if (v > MAX_CENTS) return 'Amount can’t be above 100,000,000.';
        if (v < -MAX_CENTS) return 'Amount can’t be below -100,000,000.';
        if (o.min !== undefined && v < o.min) return o.min === 0 ? 'Enter 0 or more.' : 'Enter more than 0.';
        return '';
      };
    },
    int: function (lo, hi, msg) { return function (v) { return isInt(v) && v >= lo && v <= hi ? '' : (msg || ('Enter a whole number from ' + lo + ' to ' + hi + '.')); }; },
    bool: function () { return function (v) { return typeof v === 'boolean' ? '' : 'Choose yes or no.'; }; },
    oneOf: function (list) { return function (v) { return list.indexOf(v) >= 0 ? '' : 'Choose one of the options.'; }; },
    date: function () { return function (v) { return isDate(v) ? '' : 'Enter a real date.'; }; },
    month: function () { return function (v) { return isMonth(v) ? '' : 'Enter a real month.'; }; },
    iso: function () { return function (v) { return isIso(v) ? '' : 'Not a valid time.'; }; },
    id: function () { return function (v) { return isId(v) ? '' : 'Not a valid id.'; }; },
    nullable: function (f) { return function (v) { return v === null ? '' : f(v); }; }
  };

  // ---------- Stores ----------
  // fields: name -> [check, default]. No default means the field is required.
  // refs: field -> store it points at (checked by the store and by restore).
  var STORES = {
    accounts: {
      fields: {
        name: [T.text({ min: 1, max: TEXT.name })],
        type: [T.oneOf(Object.keys(ACCOUNT_TYPES))],
        last4: [function (v) { return v === '' || (typeof v === 'string' && isDigits(v, 4, 4)) ? '' : 'Don’t type account numbers. Last 4 digits at most.'; }, ''],
        aprBps: [T.nullable(T.int(0, 10000, 'Enter a rate from 0% to 100%.')), null],
        fundCostBps: [T.nullable(T.int(0, 1000, 'Enter a fund cost from 0% to 10%.')), null]
      },
      check: function (r) {
        if (r.fundCostBps !== null && ACCOUNT_TYPES[r.type].group !== 'invest') return [{ field: 'fundCostBps', message: 'A fund cost is only for investment accounts.' }];
        return [];
      }
    },
    balances: {
      fields: { accountId: [T.id()], date: [T.date()], cents: [T.cents()] },
      refs: { accountId: 'accounts' },
      check: function (r, ctx) {
        var a = ctx.lookup && ctx.lookup('accounts', r.accountId);
        if (a && ACCOUNT_TYPES[a.type] && ACCOUNT_TYPES[a.type].debt && r.cents < 0) return [{ field: 'cents', message: 'Enter what you owe as 0 or more.' }];
        return [];
      }
    },
    categories: {
      fields: { name: [T.text({ min: 1, max: TEXT.name })], kind: [T.oneOf(['income', 'expense', 'transfer'])], isFee: [T.bool(), false] }
    },
    transactions: {
      fields: {
        accountId: [T.id()], date: [T.date()], cents: [T.cents()],
        payee: [T.text({ min: 1, max: TEXT.payee })], note: [T.text({ max: TEXT.note }), ''],
        categoryId: [T.nullable(T.id()), null],
        splits: [function (v) { return Array.isArray(v) ? '' : 'Not a list of parts.'; }, []],
        importId: [T.nullable(T.id()), null],
        fitId: [T.nullable(T.text({ min: 1, max: 255 })), null]
      },
      refs: { accountId: 'accounts', categoryId: 'categories', importId: 'imports' },
      check: function (r, ctx) {
        var e = [];
        if (!r.splits.length) return e;
        if (r.splits.length < 2 || r.splits.length > 10) return [{ field: 'splits', message: 'A split has 2 to 10 parts.' }];
        var sum = 0;
        r.splits.forEach(function (p, i) {
          if (!isObj(p) || Object.keys(p).some(function (k) { return k !== 'categoryId' && k !== 'cents'; })) { e.push({ field: 'splits', message: 'Part ' + (i + 1) + ' is not a valid part.' }); return; }
          var m = T.cents()(p.cents) || T.nullable(T.id())(p.categoryId === undefined ? null : p.categoryId);
          if (m) { e.push({ field: 'splits', message: 'Part ' + (i + 1) + ': ' + m }); return; }
          if (p.categoryId && ctx.lookup && !ctx.lookup('categories', p.categoryId)) e.push({ field: 'splits', message: 'Part ' + (i + 1) + ' points at a category that does not exist.' });
          sum += p.cents;
        });
        if (!e.length && sum !== r.cents) {
          // Same sign: say it in plain amounts ("$90.00, not $100.00"); else keep the signs.
          var same = (sum <= 0) === (r.cents <= 0);
          e.push({ field: 'splits', message: 'The parts add up to ' + plainMoney(same ? Math.abs(sum) : sum) + ', not ' + plainMoney(same ? Math.abs(r.cents) : r.cents) + '.' });
        }
        return e;
      },
      normalise: function (r) {
        r.splits = r.splits.map(function (p) { return { categoryId: p.categoryId !== undefined ? p.categoryId : null, cents: p.cents }; });
        return r;
      }
    },
    rules: {
      fields: { text: [T.text({ min: 2, max: TEXT.rule })], categoryId: [T.id()], order: [T.int(0, 100000), 0] },
      refs: { categoryId: 'categories' }
    },
    budgets: {
      fields: {
        month: [T.month()], plannedIncomeCents: [T.cents({ min: 0 }), 0],
        lines: [function (v) { return Array.isArray(v) && v.length <= CAPS.categories ? '' : 'Not a list of budget lines.'; }, []]
      },
      check: function (r, ctx) {
        var e = [], seen = {};
        r.lines.forEach(function (l, i) {
          if (!isObj(l) || Object.keys(l).some(function (k) { return k !== 'categoryId' && k !== 'targetCents'; })) { e.push({ field: 'lines', message: 'Line ' + (i + 1) + ' is not a valid line.' }); return; }
          var m = T.id()(l.categoryId) || T.cents({ min: 0 })(l.targetCents);
          if (m) { e.push({ field: 'lines', message: 'Line ' + (i + 1) + ': ' + m }); return; }
          if (seen[l.categoryId]) e.push({ field: 'lines', message: 'A category has two budget lines.' });
          seen[l.categoryId] = true;
          if (ctx.lookup && !ctx.lookup('categories', l.categoryId)) e.push({ field: 'lines', message: 'Line ' + (i + 1) + ' points at a category that does not exist.' });
        });
        return e;
      },
      normalise: function (r) { r.lines = r.lines.map(function (l) { return { categoryId: l.categoryId, targetCents: l.targetCents }; }); return r; }
    },
    payPlans: {
      fields: {
        name: [T.text({ min: 1, max: TEXT.name })], payCents: [T.cents({ min: 1 })], frequency: [T.oneOf(PAY_FREQUENCIES)],
        buckets: [function (v) { return Array.isArray(v) && v.length >= 1 && v.length <= 20 ? '' : 'A pay plan has 1 to 20 buckets.'; }]
      },
      check: function (r) {
        var e = [];
        r.buckets.forEach(function (b, i) {
          if (!isObj(b) || Object.keys(b).some(function (k) { return k !== 'name' && k !== 'cents'; })) { e.push({ field: 'buckets', message: 'Bucket ' + (i + 1) + ' is not valid.' }); return; }
          var m = T.text({ min: 1, max: TEXT.bucket })(typeof b.name === 'string' ? b.name.trim() : b.name) || T.cents({ min: 0 })(b.cents);
          if (m) e.push({ field: 'buckets', message: 'Bucket ' + (i + 1) + ': ' + m });
        });
        return e;
      },
      normalise: function (r) { r.buckets = r.buckets.map(function (b) { return { name: b.name.trim(), cents: b.cents }; }); return r; }
    },
    bills: {
      fields: {
        name: [T.text({ min: 1, max: TEXT.name })], cents: [T.cents({ min: 1 })], frequency: [T.oneOf(FREQUENCIES)],
        nextDue: [T.date()], accountId: [T.nullable(T.id()), null], categoryId: [T.nullable(T.id()), null], endsOn: [T.nullable(T.date()), null]
      },
      refs: { accountId: 'accounts', categoryId: 'categories' }
    },
    goals: {
      fields: {
        name: [T.text({ min: 1, max: TEXT.name })], kind: [T.oneOf(['goal', 'sinking', 'emergency'])],
        targetCents: [T.cents({ min: 1 })], savedCents: [T.cents({ min: 0 }), 0],
        savedAsOf: [T.nullable(T.date()), null], targetDate: [T.nullable(T.date()), null]
      }
    },
    scenarios: {
      fields: {
        name: [T.text({ min: 1, max: TEXT.name })], tab: [T.oneOf(['savings', 'debt'])],
        inputs: [function (v) {
          if (!isObj(v)) return 'Not a set of inputs.';
          var keys = Object.keys(v);
          if (keys.length > 20) return 'Too many inputs.';
          for (var i = 0; i < keys.length; i++) {
            var k = keys[i], x = v[k];
            if (k.length > 40 || CTRL.test(k)) return 'Not a valid input name.';
            if (!(typeof x === 'number' && isFinite(x)) && !(typeof x === 'string' && x.length <= 80 && !CTRL.test(x)) && typeof x !== 'boolean') return 'Not a valid input value.';
          }
          return '';
        }]
      },
      normalise: function (r) { var o = {}; Object.keys(r.inputs).forEach(function (k) { o[k] = r.inputs[k]; }); r.inputs = o; return r; }
    },
    scores: {
      fields: {
        score: [T.int(0, 1000, 'Enter a whole number.')], model: [T.oneOf(['FICO', 'VantageScore', 'unknown'])],
        rangeMin: [T.int(0, 1000, 'Enter a whole number.')], rangeMax: [T.int(0, 1000, 'Enter a whole number.')],
        asOf: [T.date()], note: [T.text({ max: TEXT.scoreNote }), '']
      },
      check: function (r, ctx) {
        if (r.rangeMin >= r.rangeMax) return [{ field: 'rangeMax', message: 'The top of the range must be above the bottom.' }];
        if (r.score < r.rangeMin || r.score > r.rangeMax) return [{ field: 'score', message: 'Enter a score between ' + r.rangeMin + ' and ' + r.rangeMax + '.' }];
        if (ctx.today && r.asOf > ctx.today) return [{ field: 'asOf', message: 'Enter a date that isn’t after today.' }];
        return [];
      }
    },
    imports: {
      fields: {
        at: [T.iso()], fileName: [T.text({ max: TEXT.fileName }), ''], format: [T.oneOf(['csv', 'ofx', 'qfx'])],
        accountId: [T.nullable(T.id()), null], added: [T.int(0, CAPS.transactions)]
      },
      refs: { accountId: 'accounts' }
    },
    // The reader's name, shown at the top of the app. At most one record; blank is "no record".
    // A data record (not a setting), so it is encrypted while the lock is on.
    profile: {
      fields: { displayName: [T.text({ min: 1, max: TEXT.displayName })] }
    }
  };
  var STORE_NAMES = Object.keys(STORES);
  var COMMON = ['id', 'source', 'createdAt', 'updatedAt'];

  // Settings: one record, readable while the lock is on, holds no amounts.
  var SETTINGS_DEFAULTS = {
    theme: 'dark', hideAmounts: false, lessMotion: false, moreContrast: false, onboardingDone: false,
    topics: [], payFrequency: 'monthly', lastBackupAt: null, backupPromptSnoozedUntil: null, persistGranted: null
  };
  var LOCK_TIMEOUTS = [5, 15, 30, 60];
  // The preferences part of settings (what screens may change, and what a backup carries).
  function validateSettings(patch) {
    var e = [], out = {};
    Object.keys(patch || {}).forEach(function (k) {
      var v = patch[k], m = '';
      if (!(k in SETTINGS_DEFAULTS)) { e.push({ field: k, message: 'Unknown setting.' }); return; }
      if (k === 'theme') m = T.oneOf(['dark', 'light'])(v);
      else if (k === 'payFrequency') m = T.oneOf(PAY_FREQUENCIES)(v);
      else if (k === 'topics') m = Array.isArray(v) && v.length <= 20 && v.every(function (t) { return typeof t === 'string' && t.length <= 40 && !CTRL.test(t); }) ? '' : 'Not a list of topics.';
      else if (k === 'lastBackupAt' || k === 'backupPromptSnoozedUntil') m = T.nullable(T.iso())(v);
      else if (k === 'persistGranted') m = v === null || typeof v === 'boolean' ? '' : 'Choose yes or no.';
      else m = T.bool()(v);
      if (m) e.push({ field: k, message: m }); else out[k] = Array.isArray(v) ? v.slice() : v;
    });
    return { ok: !e.length, errors: e, value: out };
  }

  // ---------- One record ----------
  // validate('accounts', record, ctx) -> { ok, value, errors: [{field, message}] }
  // ctx: { lookup(store, id) -> record or null, today: 'YYYY-MM-DD' }.
  // Strings are trimmed. Unknown fields are refused. Missing optional fields
  // get their default. The common fields (id, source, createdAt, updatedAt)
  // must already be set by the caller.
  function validate(store, rec, ctx) {
    ctx = ctx || {};
    var def = STORES[store];
    if (!def) return { ok: false, errors: [{ field: '', message: 'Unknown store.' }] };
    if (!isObj(rec)) return { ok: false, errors: [{ field: '', message: 'Not a record.' }] };
    var errors = [], out = {};
    Object.keys(rec).forEach(function (k) {
      if (COMMON.indexOf(k) < 0 && !def.fields[k]) errors.push({ field: k, message: 'Unknown field.' });
    });
    if (!isId(rec.id)) errors.push({ field: 'id', message: 'Not a valid id.' });
    if (SOURCES.indexOf(rec.source) < 0) errors.push({ field: 'source', message: 'Not a valid source.' });
    if (!isIso(rec.createdAt)) errors.push({ field: 'createdAt', message: 'Not a valid time.' });
    if (!isIso(rec.updatedAt)) errors.push({ field: 'updatedAt', message: 'Not a valid time.' });
    out.id = rec.id; out.source = rec.source; out.createdAt = rec.createdAt; out.updatedAt = rec.updatedAt;
    Object.keys(def.fields).forEach(function (k) {
      var spec = def.fields[k], v = rec[k];
      if (v === undefined) {
        if (spec.length < 2) { errors.push({ field: k, message: 'This is needed.' }); return; }
        v = Array.isArray(spec[1]) ? spec[1].slice() : spec[1];
      }
      if (typeof v === 'string') v = v.trim();
      var m = spec[0](v);
      if (m) errors.push({ field: k, message: m });
      out[k] = v;
    });
    if (errors.length) return { ok: false, errors: errors };
    if (ctx.lookup && def.refs) {
      Object.keys(def.refs).forEach(function (k) {
        if (out[k] !== null && !ctx.lookup(def.refs[k], out[k])) errors.push({ field: k, message: 'Points at a record that does not exist.' });
      });
    }
    // check() sees the parts exactly as given (so unknown keys are refused);
    // normalise() then copies only the known keys.
    if (!errors.length && def.check) errors = errors.concat(def.check(out, ctx));
    if (errors.length) return { ok: false, errors: errors };
    if (def.normalise) out = def.normalise(out);
    return { ok: true, value: out, errors: [] };
  }

  // ---------- A whole data set (restore) ----------
  // data: { accounts: [...], balances: [...], ... } with every store present.
  // Checks every record, ids unique across the file, every reference, every
  // cap, and the store-wide rules (unique category names, one budget a month).
  function validateData(data, ctx) {
    ctx = ctx || {};
    var errors = [], byId = {}, counts = {};
    function err(store, i, field, message) { if (errors.length < 50) errors.push({ store: store, index: i, field: field, message: message }); }
    if (!isObj(data)) return { ok: false, errors: [{ store: '', index: -1, field: '', message: 'The file has no data.' }] };
    // A backup made before the profile store existed has no name to restore.
    if (data.profile === undefined) data = Object.assign({}, data, { profile: [] });
    Object.keys(data).forEach(function (k) { if (STORE_NAMES.indexOf(k) < 0) err(k, -1, '', 'Unknown part of the file.'); });
    STORE_NAMES.forEach(function (s) {
      if (!Array.isArray(data[s])) { err(s, -1, '', 'Missing or not a list.'); return; }
      var cap = s === 'balances' ? CAPS.accounts * CAPS.balancesPerAccount : CAPS[s];
      if (data[s].length > cap) err(s, -1, '', 'More than ' + cap + ' ' + CAP_WORDS[s] + '.');
      counts[s] = data[s].length;
      byId[s] = {};
      data[s].forEach(function (r, i) {
        if (!isObj(r) || !isId(r.id)) { err(s, i, 'id', 'Not a valid id.'); return; }
        if (byId[s][r.id]) err(s, i, 'id', 'The same id appears twice.');
        byId[s][r.id] = r;
      });
    });
    if (errors.length) return { ok: false, errors: errors, counts: counts };
    var all = {};
    STORE_NAMES.forEach(function (s) { Object.keys(byId[s]).forEach(function (id) { if (all[id]) err(s, -1, 'id', 'The same id appears twice.'); all[id] = true; }); });
    var vctx = { today: ctx.today, lookup: function (s, id) { return byId[s] && byId[s][id] || null; } };
    var clean = {};
    STORE_NAMES.forEach(function (s) {
      clean[s] = [];
      data[s].forEach(function (r, i) {
        var v = validate(s, r, vctx);
        if (!v.ok) v.errors.forEach(function (e) { err(s, i, e.field, e.message); });
        else clean[s].push(v.value);
      });
    });
    errors = errors.concat(storeRules(clean).map(function (e) { return { store: e.store, index: -1, field: e.field, message: e.message }; }));
    return errors.length ? { ok: false, errors: errors.slice(0, 50), counts: counts } : { ok: true, data: clean, counts: counts, errors: [] };
  }
  // Rules that look across records of one store.
  function storeRules(data) {
    var e = [], names = {}, months = {}, perAcct = {};
    (data.categories || []).forEach(function (c) {
      var k = c.name.toLowerCase();
      if (names[k]) e.push({ store: 'categories', field: 'name', message: 'Two categories are both called “' + c.name + '”.' });
      names[k] = true;
    });
    (data.budgets || []).forEach(function (b) {
      if (months[b.month]) e.push({ store: 'budgets', field: 'month', message: 'Two budgets for ' + b.month + '.' });
      months[b.month] = true;
    });
    (data.balances || []).forEach(function (b) { perAcct[b.accountId] = (perAcct[b.accountId] || 0) + 1; });
    Object.keys(perAcct).forEach(function (a) { if (perAcct[a] > CAPS.balancesPerAccount) e.push({ store: 'balances', field: 'accountId', message: 'More than ' + CAPS.balancesPerAccount + ' balance entries for one account.' }); });
    return e;
  }

  // ---------- Backup file shape ----------
  // Checks the outer object of a plain backup. -> { ok, errors: [messages] }
  function checkBackupShape(obj) {
    var e = [];
    if (!isObj(obj)) return { ok: false, errors: ['This isn’t a Stepwell Financial backup file.'] };
    var allowed = ['app', 'schemaVersion', 'createdAt', 'settings', 'data'];
    Object.keys(obj).forEach(function (k) { if (allowed.indexOf(k) < 0) e.push('The file has an unknown part: “' + String(k).slice(0, 40) + '”.'); });
    if (obj.app !== APP) e.push('This isn’t a Stepwell Financial backup file.');
    if (!isInt(obj.schemaVersion) || obj.schemaVersion < 1) e.push('The file’s version is not a valid number.');
    else if (obj.schemaVersion > VERSION) e.push('This backup was made by a newer version of the app.');
    if (!isIso(obj.createdAt)) e.push('The file’s date is not valid.');
    if (obj.settings !== undefined) {
      var s = validateSettings(obj.settings);
      if (!s.ok) e.push('The file’s settings are not valid.');
    }
    if (!isObj(obj.data)) e.push('The file has no data.');
    return { ok: !e.length, errors: e };
  }
  // Encrypted backup: the outer object, before decrypting.
  function checkEncryptedShape(obj) {
    return isObj(obj) && obj.app === APP && obj.encrypted === true && isInt(obj.schemaVersion) && isIso(obj.createdAt) &&
      isObj(obj.kdf) && obj.kdf.name === 'PBKDF2' && obj.kdf.hash === 'SHA-256' && isInt(obj.kdf.iterations) &&
      obj.kdf.iterations >= 600000 && obj.kdf.iterations <= 10000000 && typeof obj.kdf.salt === 'string' && obj.kdf.salt.length <= 64 &&
      isObj(obj.cipher) && obj.cipher.name === 'AES-GCM' && typeof obj.cipher.iv === 'string' && obj.cipher.iv.length <= 64 &&
      typeof obj.ciphertext === 'string' &&
      Object.keys(obj).every(function (k) { return ['app', 'encrypted', 'schemaVersion', 'createdAt', 'kdf', 'cipher', 'ciphertext'].indexOf(k) >= 0; });
  }

  // ---------- Migrations ----------
  // MIGRATIONS[v] turns a record of version v - 1 into version v. Version 1
  // is the first, so the list is empty. When the schema changes: raise
  // VERSION, add MIGRATIONS[VERSION] = function (store, record) { ...; return
  // record; }, and the store runs it on every record when it opens (and on
  // an older backup when it is restored), then saves the result.
  var MIGRATIONS = {};
  function migrate(store, rec, from) {
    var r = rec;
    for (var v = from + 1; v <= VERSION; v++) if (MIGRATIONS[v]) r = MIGRATIONS[v](store, r);
    return r;
  }

  // ---------- Input parsing (what a person types) ----------
  // parseMoney('$1,234.50') -> { ok: true, cents: 123450 }
  // Accepts 1234.5, 1,234.50, $1,234.50, a leading minus (- or the true minus
  // sign). Refuses 3 or more decimals, text and out-of-range amounts with the
  // spec's messages. Written by hand, no patterns.
  var TRUE_MINUS = String.fromCharCode(8722);
  function parseMoney(text) {
    var s = String(text === undefined || text === null ? '' : text).trim();
    if (s.length > TEXT.money) return { ok: false, message: 'Amount can’t be above 100,000,000.' };
    var neg = false;
    if (s[0] === '-' || s[0] === TRUE_MINUS) { neg = true; s = s.slice(1).trim(); }
    if (s[0] === '$') s = s.slice(1).trim();
    if (!s) return { ok: false, message: 'Enter a number.' };
    var dot = s.indexOf('.'), whole = dot >= 0 ? s.slice(0, dot) : s, frac = dot >= 0 ? s.slice(dot + 1) : '';
    if (dot >= 0 && frac.indexOf('.') >= 0) return { ok: false, message: 'Enter a number.' };
    if (!isDigits(frac, 0, 50)) return { ok: false, message: 'Enter a number.' };
    if (whole.indexOf(',') >= 0) {
      var parts = whole.split(',');
      if (!isDigits(parts[0], 1, 3) || parts.slice(1).some(function (p) { return !isDigits(p, 3, 3); })) return { ok: false, message: 'Enter a number.' };
      whole = parts.join('');
    }
    if (!isDigits(whole, 0, 50) || (!whole && !frac)) return { ok: false, message: 'Enter a number.' };
    if (frac.length > 2) return { ok: false, message: 'Use at most 2 decimal places.' };
    var w = whole;
    while (w.length > 1 && w[0] === '0') w = w.slice(1);
    if (w.length > 9) return { ok: false, message: 'Amount can’t be above 100,000,000.' };
    var cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
    if (cents > MAX_CENTS) return { ok: false, message: 'Amount can’t be above 100,000,000.' };
    return { ok: true, cents: neg && cents ? -cents : cents };
  }
  // "$1,234.50" style text for messages; no hide-amounts here (messages are
  // shown right after the person typed the figure).
  function plainMoney(c) {
    var a = Math.abs(c), d = String(Math.floor(a / 100)), out = '';
    while (d.length > 3) { out = ',' + d.slice(-3) + out; d = d.slice(0, -3); }
    return (c < 0 ? '-' : '') + '$' + d + out + '.' + String(a % 100 + 100).slice(1);
  }
  // Cut text to a field's cap (for pasted text).
  function clip(text, kind) { var s = String(text === undefined || text === null ? '' : text); var n = TEXT[kind] || TEXT.note; return s.length > n ? s.slice(0, n) : s; }

  var api = {
    VERSION: VERSION, APP: APP, MAX_CENTS: MAX_CENTS, TEXT: TEXT, CAPS: CAPS, CAP_WORDS: CAP_WORDS,
    ACCOUNT_TYPES: ACCOUNT_TYPES, GROUPS: GROUPS, FREQUENCIES: FREQUENCIES, PAY_FREQUENCIES: PAY_FREQUENCIES,
    SOURCES: SOURCES, STARTER_CATEGORIES: STARTER_CATEGORIES, STORES: STORES, STORE_NAMES: STORE_NAMES,
    SETTINGS_DEFAULTS: SETTINGS_DEFAULTS, LOCK_TIMEOUTS: LOCK_TIMEOUTS, MIGRATIONS: MIGRATIONS,
    isDate: isDate, isMonth: isMonth, isIso: isIso, isId: isId, hasControlChars: CTRL.test,
    validate: validate, validateData: validateData, storeRules: storeRules, validateSettings: validateSettings,
    checkBackupShape: checkBackupShape, checkEncryptedShape: checkEncryptedShape, migrate: migrate,
    parseMoney: parseMoney, plainMoney: plainMoney, clip: clip,
    groupOf: function (type) { return ACCOUNT_TYPES[type] ? ACCOUNT_TYPES[type].group : null; },
    isDebt: function (type) { return !!(ACCOUNT_TYPES[type] && ACCOUNT_TYPES[type].debt); }
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SWSchema = api;
})(this);
