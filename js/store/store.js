/* Stepwell Financial: the data store every screen uses. See docs/STORE.md.

   - Reads are synchronous, from memory, after open() has finished.
   - Writes return Promises. Each write is checked (js/store/schema.js),
     saved in one transaction, then the memory copy changes and every
     subscriber hears about it. A write that fails changes nothing.
   - Writes run one at a time, in the order they were asked for.
   - With the passphrase lock on, every record is encrypted before it is
     saved (js/store/crypto.js) and the key is held only here, in memory.
   - Records are frozen: change them through update(), never in place. */
(function (root) {
  'use strict';

  var S = root.SWSchema, C = root.SWCalc, K = root.SWCrypto, CSV = root.SWCsv;
  var DATA = S.STORE_NAMES;
  var NOTICE_NO_STORAGE = 'Your browser isn’t letting this page save. What you enter stays only until you close or reload it. Download a backup to keep it.';
  var MSG = {
    locked: 'Unlock the app first.',
    wrong: 'That passphrase doesn’t open the app. Check capitals and spaces.',
    wrongBackup: 'That passphrase doesn’t open this file. Check capitals and spaces. Nothing on this device has changed.',
    unreadable: 'We couldn’t read this file. It may not be a Stepwell Financial backup, or it may be damaged. Nothing on this device has changed.',
    newer: 'This backup is from a newer version of the app. Update the app, then try again. Nothing on this device has changed.',
    full: 'This device is almost out of space for the app. Save a backup, then you can remove older transactions.',
    failed: 'That couldn’t be saved. Nothing was changed. Try again.',
    noStorage: 'The lock needs this browser to save data, and it isn’t letting this page save.',
    deleted: 'Everything was deleted. Reload the page to start again.',
    closed: 'The app was changed in another tab. Reload this page to carry on.',
    mismatch: 'The two passphrases are different.',
    confirm: 'Type DELETE to confirm.'
  };

  // ---------- Errors ----------
  // err.code: 'invalid' | 'cap' | 'locked' | 'not-found' | 'wrong-passphrase' | 'weak-passphrase'
  //   | 'mismatch' | 'no-storage' | 'full' | 'failed' | 'confirm' | 'deleted' | 'closed'
  //   | 'sample-account' | 'not-allowed' | 'unreadable' | 'newer' | 'too-big' | 'needs-passphrase'
  // err.message: a plain sentence a screen may show. err.errors: [{field, message, index?}]
  function StoreError(code, message, errors) {
    var e = new Error(message);
    e.name = 'StoreError'; e.code = code; e.errors = errors || [];
    return e;
  }

  function safeFactory() { try { return root.indexedDB || null; } catch (e) { return null; } }
  function newId() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    var b = K.randomBytes(16), h = '';
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    for (var i = 0; i < 16; i++) h += (b[i] + 256).toString(16).slice(1);
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.keys(o).forEach(function (k) { deepFreeze(o[k]); }); }
    return o;
  }
  function plainCopy(o) { return JSON.parse(JSON.stringify(o)); }

  function create(opts) {
    opts = opts || {};
    var dbName = opts.dbName || 'stepwell';
    var now = opts.now || function () { return new Date(); };
    var factory = Object.prototype.hasOwnProperty.call(opts, 'indexedDB') ? opts.indexedDB : safeFactory();
    var attach = opts.attach !== false && typeof root.addEventListener === 'function';
    var sampleData = opts.sampleData || null; // { data, ext }; defaults to the page's SWData and SWEngA.ext
    var sampleMode = opts.sampleMode !== false; // false: the sample can't be added (status().canLoadSample is false, loadSample refuses); removeSample still works

    var backend = null, openPromise = null, queue = Promise.resolve();
    var state = { ready: false, locked: false, deleted: false, closed: false, notice: null };
    var settings = null;        // the raw settings record, including the lock's parameters
    var key = null;             // CryptoKey while unlocked; never stored, never on window
    var cache = {}, lists = {}; // store -> Map(id -> frozen record); store -> cached array
    var listeners = [];
    var lastActive = now().getTime();
    var pending = null;         // a checked backup waiting for "Replace my data"
    var channel = null;
    var persistAsked = false;

    DATA.forEach(function (s) { cache[s] = new Map(); });

    // ---------- Small helpers ----------
    function iso() { return now().toISOString(); }
    // A time strictly after prev, so an edit always shows as an edit
    // (updatedAt !== createdAt) even within the same millisecond.
    function later(prev) {
      var t = now().getTime(), p = Date.parse(prev);
      return new Date(isNaN(p) || t > p ? t : p + 1).toISOString();
    }
    function today() { return C.localDate(now()); }
    function emit(ev) {
      listeners.slice().forEach(function (fn) { try { fn(ev); } catch (e) { if (root.console) root.console.error(e); } });
    }
    function changed(stores, reason) {
      stores.forEach(function (s) { lists[s] = null; });
      emit({ type: 'change', stores: stores, reason: reason || 'write' });
      if (channel) { try { channel.postMessage({ t: 'changed' }); } catch (e) { /* channel closed */ } }
    }
    function serial(fn) {
      var p = queue.then(fn, fn);
      queue = p.then(function () {}, function () {});
      return p;
    }
    function assertUsable() {
      if (state.deleted) throw StoreError('deleted', MSG.deleted);
      if (state.closed) throw StoreError('closed', MSG.closed);
      if (!state.ready) throw StoreError('not-allowed', 'The store is still opening.');
      if (state.locked) throw StoreError('locked', MSG.locked);
    }
    function lookup(store, id) { return cache[store] && cache[store].get(id) || null; }
    function vctx() { return { lookup: lookup, today: today() }; }
    function lockOn() { return !!(settings && settings.lock && settings.lock.enabled); }

    // ---------- Raw records (what is written) ----------
    function toRaw(store, rec) {
      if (!key) return Promise.resolve(plainCopy(rec));
      var payload = plainCopy(rec);
      delete payload.id;
      return K.encryptJson(key, payload, store + '/' + rec.id).then(function (x) { return { id: rec.id, iv: x.iv, ct: x.ct }; });
    }
    function fromRaw(store, raw, k) {
      if (!raw || typeof raw !== 'object') return Promise.resolve(null);
      if (raw.ct) {
        if (!k) return Promise.resolve(null);
        return K.decryptJson(k, raw.iv, raw.ct, store + '/' + raw.id).then(function (p) { p.id = raw.id; return p; });
      }
      return Promise.resolve(raw);
    }
    function settingsRaw() { return plainCopyKeepBytes(settings); }
    function plainCopyKeepBytes(s) {
      var o = {};
      Object.keys(s).forEach(function (k) { o[k] = k === 'lock' ? Object.assign({}, s.lock) : Array.isArray(s[k]) ? s[k].slice() : s[k]; });
      return o;
    }

    // changes: { put: { store: [records] }, del: { store: [ids] }, clear: [stores], settings: true }
    // Encrypts first (so nothing async runs inside the transaction), then one commit.
    function commit(changes) {
      var ops = [], jobs = [];
      (changes.clear || []).forEach(function (s) { ops.push({ store: s, clear: true }); });
      Object.keys(changes.put || {}).forEach(function (s) {
        var list = changes.put[s];
        if (!list.length) return;
        jobs.push(Promise.all(list.map(function (r) { return toRaw(s, r); })).then(function (raws) { ops.push({ store: s, put: raws }); }));
      });
      return Promise.all(jobs).then(function () {
        Object.keys(changes.del || {}).forEach(function (s) { if (changes.del[s].length) ops.push({ store: s, del: changes.del[s] }); });
        if (changes.settings) ops.push({ store: 'settings', put: [settingsRaw()] });
        return backend.commit(ops);
      }).catch(function (e) {
        if (e && e.code === 'full') throw StoreError('full', MSG.full);
        if (e && e.name === 'StoreError') throw e;
        throw StoreError('failed', MSG.failed);
      });
    }
    // Put the committed changes into memory.
    function apply(changes) {
      var touched = {};
      (changes.clear || []).forEach(function (s) { cache[s] = new Map(); touched[s] = true; });
      Object.keys(changes.put || {}).forEach(function (s) { changes.put[s].forEach(function (r) { cache[s].set(r.id, deepFreeze(r)); }); touched[s] = true; });
      Object.keys(changes.del || {}).forEach(function (s) { changes.del[s].forEach(function (id) { cache[s].delete(id); }); touched[s] = true; });
      return Object.keys(touched);
    }
    function write(changes, reason) {
      return commit(changes).then(function () {
        var stores = apply(changes);
        if (stores.length || changes.settings) changed(stores.length ? stores : ['settings'], reason);
        askPersist();
      });
    }

    // ---------- Opening ----------
    function defaultSettings() {
      var s = plainCopy(S.SETTINGS_DEFAULTS);
      s.id = 'settings';
      s.schemaVersion = S.VERSION;
      s.lock = { enabled: false, salt: null, iterations: K.ITERATIONS, timeoutMin: 15, verifier: null };
      return s;
    }
    function cleanSettings(raw) {
      var s = defaultSettings();
      if (!raw || typeof raw !== 'object') return s;
      var prefs = {};
      Object.keys(S.SETTINGS_DEFAULTS).forEach(function (k) { if (k in raw) prefs[k] = raw[k]; });
      var v = S.validateSettings(prefs);
      Object.keys(v.value).forEach(function (k) { s[k] = v.value[k]; });
      if (typeof raw.schemaVersion === 'number') s.schemaVersion = raw.schemaVersion;
      if (raw.lock && typeof raw.lock === 'object') {
        var l = raw.lock;
        s.lock.enabled = l.enabled === true && !!l.salt && !!l.verifier;
        s.lock.salt = l.salt || null;
        s.lock.iterations = typeof l.iterations === 'number' ? l.iterations : K.ITERATIONS;
        s.lock.timeoutMin = S.LOCK_TIMEOUTS.indexOf(l.timeoutMin) >= 0 ? l.timeoutMin : 15;
        s.lock.verifier = l.verifier || null;
      }
      return s;
    }
    function starterCategories() {
      var at = iso();
      return S.STARTER_CATEGORIES.map(function (c) { return { id: newId(), source: 'user', createdAt: at, updatedAt: at, name: c.name, kind: c.kind, isFee: c.isFee }; });
    }
    function firstRun() {
      settings = defaultSettings();
      return commit({ put: { categories: starterCategories() }, settings: true });
    }
    function useBackend(b) {
      backend = b;
      return b.open().then(function () { return b.loadAll(); }).then(function (raw) {
        if (!raw.settings || !raw.settings.length) {
          return firstRun().then(function () { return b.loadAll(); });
        }
        return raw;
      });
    }
    // Fill memory from raw records, decrypting with k when the lock is on.
    function fill(raw, k) {
      var jobs = [], next = {}, bad = 0;
      DATA.forEach(function (s) {
        next[s] = new Map();
        (raw[s] || []).forEach(function (r) {
          jobs.push(fromRaw(s, r, k).then(function (rec) {
            if (!rec) { bad += 1; return; }
            next[s].set(rec.id, rec);
          }));
        });
      });
      return Promise.all(jobs).then(function () {
        var from = settings.schemaVersion || S.VERSION;
        var migrated = from < S.VERSION;
        DATA.forEach(function (s) {
          var m = new Map();
          next[s].forEach(function (rec, id) { m.set(id, deepFreeze(migrated ? S.migrate(s, rec, from) : rec)); });
          cache[s] = m; lists[s] = null;
        });
        if (migrated) {
          settings.schemaVersion = S.VERSION;
          var put = {};
          DATA.forEach(function (s) { put[s] = Array.from(cache[s].values()).map(plainCopy); });
          return commit({ put: put, settings: true });
        }
        return bad;
      });
    }

    function open() {
      if (openPromise) return openPromise;
      var b = backendFor();
      openPromise = useBackend(b).catch(function () {
        // The browser refused, threw or never answered: keep working in memory.
        if (b.kind === 'indexeddb') b.close();
        state.notice = NOTICE_NO_STORAGE;
        return useBackend(root.SWBackends.memory());
      }).then(function (raw) {
        settings = cleanSettings(raw.settings[0]);
        if (backend.kind === 'memory' && lockOn()) settings.lock.enabled = false;
        if (lockOn()) { state.locked = true; return null; }
        return fill(raw, null);
      }).then(function () {
        state.ready = true;
        backend.onClosedElsewhere(function () { state.closed = true; key = null; emit({ type: 'status' }); });
        if (attach) hookPage();
        emit({ type: 'status' });
        return status();
      });
      return openPromise;
    }
    function backendFor() {
      if (opts.backend === 'memory') return root.SWBackends.memory();
      return root.SWBackends.indexedDB({ factory: factory, dbName: dbName, version: S.VERSION, timeoutMs: opts.openTimeoutMs || 4000 });
    }

    // ---------- Status ----------
    function anyWhere(test, skipCategories) {
      for (var i = 0; i < DATA.length; i++) {
        if (skipCategories && (DATA[i] === 'categories' || DATA[i] === 'profile')) continue; // neither is "the reader's own data" for the sample rule
        var found = false;
        cache[DATA[i]].forEach(function (r) { if (!found && test(r)) found = true; });
        if (found) return true;
      }
      return false;
    }
    function hasSample() { return anyWhere(function (r) { return r.source === 'sample'; }); }
    function hasOwnData() { return anyWhere(function (r) { return r.source === 'user' || r.source === 'import'; }, true); }
    function status() {
      var unlocked = state.ready && !state.locked;
      return {
        ready: state.ready, backend: backend ? backend.kind : null, saves: !!backend && backend.kind === 'indexeddb',
        notice: state.notice, locked: state.locked, lockEnabled: lockOn(), deleted: state.deleted, closed: state.closed,
        hasSample: unlocked ? hasSample() : false, hasOwnData: unlocked ? hasOwnData() : false,
        canLoadSample: sampleMode && unlocked && !hasSample() && !hasOwnData(),
        persistGranted: settings ? settings.persistGranted : null, schemaVersion: S.VERSION
      };
    }

    // ---------- Reads ----------
    function list(store) {
      if (!cache[store]) throw StoreError('not-found', 'Unknown store: ' + store);
      if (!lists[store]) lists[store] = Array.from(cache[store].values());
      return lists[store].slice();
    }
    function get(store, id) { if (!cache[store]) throw StoreError('not-found', 'Unknown store: ' + store); return cache[store].get(id) || null; }
    function count(store) { return cache[store] ? cache[store].size : 0; }
    // query('transactions', { month, from, to, accountId, categoryId, source, importId })
    function query(store, q) {
      q = q || {};
      var dateField = store === 'budgets' ? null : store === 'imports' ? 'at' : store === 'scores' ? 'asOf' : store === 'bills' ? 'nextDue' : 'date';
      return list(store).filter(function (r) {
        var d = dateField && typeof r[dateField] === 'string' ? r[dateField].slice(0, 10) : null;
        if (q.month) { if (store === 'budgets') { if (r.month !== q.month) return false; } else if (!d || d.slice(0, 7) !== q.month) return false; }
        if (q.from && (!d || d < q.from)) return false;
        if (q.to && (!d || d > q.to)) return false;
        if (q.accountId !== undefined && r.accountId !== q.accountId) return false;
        if (q.source !== undefined && r.source !== q.source) return false;
        if (q.importId !== undefined && r.importId !== q.importId) return false;
        if (q.categoryId !== undefined) {
          if (store === 'transactions') return C.partsOf(r).some(function (p) { return p.categoryId === q.categoryId; });
          if (store === 'budgets') return r.lines.some(function (l) { return l.categoryId === q.categoryId; });
          return r.categoryId === q.categoryId;
        }
        return true;
      });
    }
    function byMonth(store, month) { return query(store, { month: month }); }
    function byCategory(categoryId, month) { return query('transactions', month ? { categoryId: categoryId, month: month } : { categoryId: categoryId }); }
    function budgetFor(month) { return byMonth('budgets', month)[0] || null; }
    function publicSettings() {
      if (!settings) return null;
      var o = {};
      Object.keys(S.SETTINGS_DEFAULTS).forEach(function (k) { o[k] = Array.isArray(settings[k]) ? settings[k].slice() : settings[k]; });
      o.lock = { enabled: lockOn(), timeoutMin: settings.lock.timeoutMin, iterations: settings.lock.iterations };
      return deepFreeze(o);
    }

    // ---------- Checks shared by add and update ----------
    function capCheck(store, rec, isNew) {
      if (!isNew) return;
      if (store === 'balances') {
        var n = 0;
        cache.balances.forEach(function (b) { if (b.accountId === rec.accountId) n += 1; });
        if (n >= S.CAPS.balancesPerAccount) throw StoreError('cap', 'This account has ' + S.CAPS.balancesPerAccount + ' balance entries, the most it can hold. Remove an older one to add another.');
        return;
      }
      if (count(store) >= S.CAPS[store]) throw StoreError('cap', 'You have ' + S.CAPS[store] + ' ' + S.CAP_WORDS[store] + ', the most the app can hold. Remove one to add another.');
    }
    function storeWide(store, rec) {
      var others = list(store).filter(function (r) { return r.id !== rec.id; }).concat([rec]);
      var data = {}; data[store] = others;
      if (store === 'balances') data.balances = list('balances').filter(function (r) { return r.id !== rec.id && r.accountId === rec.accountId; }).concat([rec]);
      var e = S.storeRules(data);
      if (e.length) throw StoreError('invalid', e[0].message, e);
    }
    function checked(store, rec) {
      var v = S.validate(store, rec, vctx());
      if (!v.ok) throw StoreError('invalid', v.errors[0].message, v.errors);
      storeWide(store, v.value);
      return v.value;
    }
    function draftOnly(draft) {
      if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw StoreError('invalid', 'Not a record.');
      ['id', 'source', 'createdAt', 'updatedAt'].forEach(function (k) { if (k in draft) throw StoreError('invalid', 'The store sets ' + k + ' itself.', [{ field: k, message: 'Set by the store.' }]); });
    }
    function rulesFor(rec) {
      if (rec.categoryId === undefined) rec.categoryId = C.ruleCategory(list('rules'), rec.payee);
      return rec;
    }

    // ---------- Writes ----------
    function add(store, draft) {
      return serial(function () {
        assertUsable(); draftOnly(draft);
        if (!S.STORES[store]) throw StoreError('not-found', 'Unknown store: ' + store);
        var at = iso(), rec = Object.assign({}, draft, { id: newId(), source: 'user', createdAt: at, updatedAt: at });
        if (store === 'transactions') rulesFor(rec);
        capCheck(store, rec, true);
        var value = checked(store, rec);
        var put = {}; put[store] = [value];
        return write({ put: put }).then(function () { return get(store, value.id); });
      });
    }
    function addMany(store, drafts) {
      return serial(function () {
        assertUsable();
        if (!S.STORES[store] || !Array.isArray(drafts)) throw StoreError('invalid', 'Not a list of records.');
        var at = iso(), out = [];
        if (store !== 'balances' && count(store) + drafts.length > S.CAPS[store]) throw StoreError('cap', 'That would be more than ' + S.CAPS[store] + ' ' + S.CAP_WORDS[store] + ', the most the app can hold.');
        var staged = new Map(cache[store]);
        var ctx = { today: today(), lookup: function (s, id) { return s === store ? staged.get(id) || null : lookup(s, id); } };
        var errors = [];
        drafts.forEach(function (d, i) {
          try { draftOnly(d); } catch (e) { errors.push({ index: i, field: e.errors[0] ? e.errors[0].field : '', message: e.message }); return; }
          var rec = Object.assign({}, d, { id: newId(), source: 'user', createdAt: at, updatedAt: at });
          if (store === 'transactions') rulesFor(rec);
          var v = S.validate(store, rec, ctx);
          if (!v.ok) { v.errors.forEach(function (e) { errors.push({ index: i, field: e.field, message: e.message }); }); return; }
          staged.set(v.value.id, v.value); out.push(v.value);
        });
        var data = {}; data[store] = Array.from(staged.values());
        S.storeRules(data).forEach(function (e) { errors.push({ index: -1, field: e.field, message: e.message }); });
        if (errors.length) throw StoreError('invalid', errors.length + ' of these can’t be saved. Nothing was added.', errors);
        var put = {}; put[store] = out;
        return write({ put: put }).then(function () { return out.map(function (r) { return get(store, r.id); }); });
      });
    }
    function update(store, id, patch) {
      return serial(function () {
        assertUsable();
        var cur = get(store, id);
        if (!cur) throw StoreError('not-found', 'That record no longer exists.');
        if (!patch || typeof patch !== 'object') throw StoreError('invalid', 'Not a change.');
        ['id', 'source', 'createdAt', 'updatedAt'].forEach(function (k) { if (k in patch) throw StoreError('invalid', 'The store sets ' + k + ' itself.'); });
        var rec = Object.assign(plainCopy(cur), patch, { updatedAt: later(cur.updatedAt) });
        var value = checked(store, rec);
        if (store === 'accounts' && S.isDebt(value.type) !== S.isDebt(cur.type) && query('balances', { accountId: id }).length) {
          // An asset with balances can't silently become a debt (the signs mean different things).
          throw StoreError('invalid', 'This account has balances. To change it between an asset and a debt, add it again as a new account.');
        }
        var put = {}; put[store] = [value];
        return write({ put: put }).then(function () { return get(store, id); });
      });
    }

    // What deleting these records would also remove or change (cascade).
    // del: { store: [ids] } -> { del: { store: Set }, upd: [record] }
    function plan(del) {
      var D = {};
      DATA.forEach(function (s) { D[s] = new Set(del[s] || []); });
      if (D.accounts.size) {
        cache.balances.forEach(function (b) { if (D.accounts.has(b.accountId)) D.balances.add(b.id); });
        cache.transactions.forEach(function (t) { if (D.accounts.has(t.accountId)) D.transactions.add(t.id); });
      }
      if (D.categories.size) cache.rules.forEach(function (r) { if (D.categories.has(r.categoryId)) D.rules.add(r.id); });
      var upd = new Map();
      function patch(s, r, fn) {
        if (D[s].has(r.id)) return;
        var k = s + '/' + r.id, cur = upd.has(k) ? upd.get(k).rec : plainCopy(r);
        if (fn(cur)) { cur.updatedAt = later(r.updatedAt); upd.set(k, { store: s, rec: cur }); }
      }
      if (D.accounts.size) {
        cache.bills.forEach(function (b) { if (b.accountId && D.accounts.has(b.accountId)) patch('bills', b, function (x) { x.accountId = null; return true; }); });
        cache.imports.forEach(function (m) { if (m.accountId && D.accounts.has(m.accountId)) patch('imports', m, function (x) { x.accountId = null; return true; }); });
      }
      if (D.categories.size) {
        cache.transactions.forEach(function (t) {
          patch('transactions', t, function (x) {
            var hit = false;
            if (x.categoryId && D.categories.has(x.categoryId)) { x.categoryId = null; hit = true; }
            x.splits.forEach(function (p) { if (p.categoryId && D.categories.has(p.categoryId)) { p.categoryId = null; hit = true; } });
            return hit;
          });
        });
        cache.budgets.forEach(function (b) { patch('budgets', b, function (x) { var n = x.lines.length; x.lines = x.lines.filter(function (l) { return !D.categories.has(l.categoryId); }); return x.lines.length !== n; }); });
        cache.bills.forEach(function (b) { if (b.categoryId && D.categories.has(b.categoryId)) patch('bills', b, function (x) { x.categoryId = null; return true; }); });
      }
      if (D.imports.size) cache.transactions.forEach(function (t) { if (t.importId && D.imports.has(t.importId)) patch('transactions', t, function (x) { x.importId = null; return true; }); });
      return { del: D, upd: Array.from(upd.values()) };
    }
    function summary(p) {
      var removed = {}, changed = {};
      DATA.forEach(function (s) { if (p.del[s].size) removed[s] = p.del[s].size; });
      p.upd.forEach(function (u) { changed[u.store] = (changed[u.store] || 0) + 1; });
      return { removed: removed, changed: changed };
    }
    function runPlan(p, reason) {
      var del = {}, put = {};
      DATA.forEach(function (s) { del[s] = Array.from(p.del[s]); });
      p.upd.forEach(function (u) { (put[u.store] = put[u.store] || []).push(u.rec); });
      return write({ del: del, put: put }, reason).then(function () { return summary(p); });
    }
    // dependents('accounts', id) -> { removed: { accounts: 1, balances: 13, transactions: 22 }, changed: { bills: 1 } }
    function dependents(store, id) { var d = {}; d[store] = [id]; return summary(plan(d)); }
    function remove(store, id) {
      return serial(function () {
        assertUsable();
        if (!get(store, id)) throw StoreError('not-found', 'That record no longer exists.');
        var d = {}; d[store] = [id];
        return runPlan(plan(d));
      });
    }

    // ---------- Budgets ----------
    // setBudget('2026-11', { plannedIncomeCents, lines: [{ categoryId, targetCents }] })
    function setBudget(month, fields) {
      var cur = budgetFor(month);
      if (cur) return update('budgets', cur.id, fields);
      return add('budgets', Object.assign({ month: month }, fields));
    }
    // Copies the lines (not the planned income) from one month to another.
    function copyBudget(fromMonth, toMonth) {
      var src = budgetFor(fromMonth);
      if (!src) return Promise.reject(StoreError('not-found', 'There is no budget for that month to copy.'));
      return setBudget(toMonth, { lines: plainCopy(src.lines) });
    }

    // ---------- The reader's name ----------
    // displayName() -> the name, or '' (also '' while locked: reads return nothing then).
    // setDisplayName(text) -> Promise<the saved name, or ''>. Trimmed; blank removes the record;
    // more than 40 characters or a control character is refused with a plain message.
    // It is a data record in the 'profile' store, so it is encrypted while the lock is on.
    function displayName() {
      var r = list('profile')[0];
      return r ? r.displayName : '';
    }
    function setDisplayName(text) {
      var t = String(text === undefined || text === null ? '' : text).trim();
      var cur = list('profile')[0] || null;
      if (!t) return cur ? remove('profile', cur.id).then(function () { return ''; }) : Promise.resolve('');
      return (cur ? update('profile', cur.id, { displayName: t }) : add('profile', { displayName: t })).then(function (r) { return r.displayName; });
    }

    // ---------- Settings ----------
    function setSettings(patch) {
      return serial(function () {
        if (state.deleted) throw StoreError('deleted', MSG.deleted);
        if (!settings) throw StoreError('not-allowed', 'The store is still opening.');
        var v = S.validateSettings(patch);
        if (!v.ok) throw StoreError('invalid', v.errors[0].message, v.errors);
        var before = plainCopyKeepBytes(settings);
        Object.keys(v.value).forEach(function (k) { settings[k] = v.value[k]; });
        return commit({ settings: true }).then(function () { changed(['settings'], 'settings'); return publicSettings(); },
          function (e) { settings = before; throw e; });
      });
    }
    function setLockTimeout(min) {
      return serial(function () {
        if (S.LOCK_TIMEOUTS.indexOf(min) < 0) throw StoreError('invalid', 'Choose 5, 15, 30 or 60 minutes.');
        var before = settings.lock.timeoutMin;
        settings.lock.timeoutMin = min;
        return commit({ settings: true }).then(function () { emit({ type: 'change', stores: ['settings'], reason: 'settings' }); }, function (e) { settings.lock.timeoutMin = before; throw e; });
      });
    }
    // Ask the browser to keep the data (once, after the first save).
    function askPersist() {
      if (persistAsked || !backend || backend.kind !== 'indexeddb' || settings.persistGranted !== null) return;
      var st = root.navigator && root.navigator.storage;
      if (!st || typeof st.persist !== 'function') return;
      persistAsked = true;
      st.persist().then(function (granted) {
        return serial(function () {
          settings.persistGranted = !!granted;
          return commit({ settings: true }).then(function () { emit({ type: 'change', stores: ['settings'], reason: 'persist' }); });
        });
      }).catch(function () { /* the browser said nothing; Settings shows "not asked yet" */ });
    }
    function checkPersisted() {
      var st = root.navigator && root.navigator.storage;
      if (!st || typeof st.persisted !== 'function') return Promise.resolve(null);
      return st.persisted().catch(function () { return null; });
    }
    function estimate() {
      var st = root.navigator && root.navigator.storage;
      if (!st || typeof st.estimate !== 'function') return Promise.resolve(null);
      return st.estimate().then(function (e) { return { usage: e.usage, quota: e.quota, almostFull: e.quota ? e.usage / e.quota > 0.9 : false }; }, function () { return null; });
    }

    // ---------- Sample data ----------
    function loadSample() {
      return serial(function () {
        assertUsable();
        if (!sampleMode) throw StoreError('not-allowed', 'Sample data is not available.');
        if (hasOwnData()) throw StoreError('not-allowed', 'Sample data can only be added before you add your own.');
        if (hasSample()) throw StoreError('not-allowed', 'The sample data is already here.');
        var src = sampleData || { data: root.SWData, ext: root.SWEngA && root.SWEngA.ext };
        if (!src.data) throw StoreError('failed', 'The sample data could not be read.');
        var built = root.SWSample.build(src.data, src.ext, { newId: newId, nowIso: iso(), categories: list('categories') });
        var staged = {};
        DATA.forEach(function (s) { staged[s] = new Map(cache[s]); (built[s] || []).forEach(function (r) { staged[s].set(r.id, r); }); });
        var ctx = { today: '2100-12-31', lookup: function (s, id) { return staged[s] && staged[s].get(id) || null; } };
        var put = {}, errors = [];
        DATA.forEach(function (s) {
          put[s] = [];
          (built[s] || []).forEach(function (r) {
            var v = S.validate(s, r, ctx);
            if (v.ok) put[s].push(v.value); else errors.push({ store: s, message: v.errors[0].field + ': ' + v.errors[0].message });
          });
        });
        if (errors.length) throw StoreError('failed', 'The sample data could not be added.', errors);
        return write({ put: put }, 'sample').then(function () {
          var n = {};
          DATA.forEach(function (s) { if (put[s].length) n[s] = put[s].length; });
          return { added: n };
        });
      });
    }
    // Removes every sample record in one step. User records that belong to a
    // sample account (a balance or line added to it) go with it; other user
    // records that pointed at a sample record keep everything else.
    function removeSample() {
      return serial(function () {
        assertUsable();
        var d = {};
        DATA.forEach(function (s) { d[s] = []; cache[s].forEach(function (r) { if (r.source === 'sample') d[s].push(r.id); }); });
        return runPlan(plan(d), 'sample');
      });
    }

    // ---------- Import (contract with the import screens) ----------
    // addImportBatch(rows, { accountId, format: 'csv'|'ofx'|'qfx', fileName })
    // rows: [{ date, cents, payee, note?, fitId?, categoryId? }]  (categoryId left out: rules decide)
    // All or nothing. -> { importId, added }
    function addImportBatch(rows, meta) {
      return serial(function () {
        assertUsable();
        meta = meta || {};
        var acct = get('accounts', meta.accountId);
        if (!acct) throw StoreError('invalid', 'Choose the account these lines belong to.');
        if (acct.source === 'sample') throw StoreError('sample-account', 'Choose one of your own accounts. Sample accounts are removed with the sample data.');
        if (!Array.isArray(rows) || !rows.length) throw StoreError('invalid', 'There are no lines to add.');
        if (count('imports') >= S.CAPS.imports) throw StoreError('cap', 'The import log holds ' + S.CAPS.imports + ' imports, the most it can. Undo or clear an older one first.');
        if (count('transactions') + rows.length > S.CAPS.transactions) throw StoreError('cap', 'That would be more than ' + S.CAPS.transactions + ' lines, the most the app can hold. Nothing was added.');
        var at = iso(), importId = newId(), rules = list('rules');
        var log = { id: importId, source: 'import', createdAt: at, updatedAt: at, at: at, fileName: S.clip(meta.fileName || '', 'fileName'), format: meta.format, accountId: acct.id, added: rows.length };
        var lv = S.validate('imports', log, vctx());
        if (!lv.ok) throw StoreError('invalid', lv.errors[0].message, lv.errors);
        var errors = [], out = [];
        var ctx = { today: today(), lookup: function (s, id) { return s === 'imports' && id === importId ? lv.value : lookup(s, id); } };
        rows.forEach(function (r, i) {
          if (!r || typeof r !== 'object') { errors.push({ index: i, field: '', message: 'Not a line.' }); return; }
          var keys = Object.keys(r).filter(function (k) { return ['date', 'cents', 'payee', 'note', 'fitId', 'categoryId', 'accountId'].indexOf(k) < 0; });
          if (keys.length) { errors.push({ index: i, field: keys[0], message: 'Unknown field.' }); return; }
          if (r.accountId !== undefined && r.accountId !== acct.id) { errors.push({ index: i, field: 'accountId', message: 'A different account.' }); return; }
          var rec = { id: newId(), source: 'import', createdAt: at, updatedAt: at, accountId: acct.id, date: r.date, cents: r.cents, payee: r.payee,
            note: r.note === undefined ? '' : r.note, categoryId: r.categoryId, splits: [], importId: importId, fitId: r.fitId === undefined ? null : r.fitId };
          if (rec.categoryId === undefined) rec.categoryId = C.ruleCategory(rules, typeof rec.payee === 'string' ? rec.payee : '');
          var v = S.validate('transactions', rec, ctx);
          if (!v.ok) v.errors.forEach(function (e) { errors.push({ index: i, field: e.field, message: e.message }); });
          else out.push(v.value);
        });
        if (errors.length) throw StoreError('invalid', errors.length === 1 ? '1 line can’t be saved. Nothing was added.' : errors.length + ' lines can’t be saved. Nothing was added.', errors.slice(0, 200));
        return write({ put: { imports: [lv.value], transactions: out } }, 'import').then(function () { return { importId: importId, added: out.length }; });
      });
    }
    // -> { lines, editedSince }
    function importInfo(importId) {
      var ls = query('transactions', { importId: importId });
      return { lines: ls.length, editedSince: ls.filter(function (t) { return t.updatedAt !== t.createdAt; }).length };
    }
    // Removes every line of that import (edited or not) and its log entry.
    // -> { removed, editedSince }
    function undoImportBatch(importId) {
      return serial(function () {
        assertUsable();
        if (!get('imports', importId)) throw StoreError('not-found', 'That import is no longer in the log.');
        var info = importInfo(importId);
        var ids = query('transactions', { importId: importId }).map(function (t) { return t.id; });
        return write({ del: { transactions: ids, imports: [importId] } }, 'import').then(function () { return { removed: info.lines, editedSince: info.editedSince }; });
      });
    }
    // findDuplicates(accountId, rows) -> [true|false] per row (spec 9.7 rule).
    function findDuplicates(accountId, rows) { return C.matchDuplicates(list('transactions'), rows, accountId); }

    // ---------- Export ----------
    function stamp() { return today(); }
    function exportTransactionsCsv() {
      assertUsable();
      var text = CSV.transactionsCsv(list('transactions'), list('accounts'), list('categories'));
      return { text: text, fileName: 'stepwell-transactions-' + stamp() + '.csv', type: 'text/csv;charset=utf-8' };
    }

    // ---------- Backup and restore ----------
    function backupObject() {
      var data = {};
      DATA.forEach(function (s) { data[s] = list(s).map(plainCopy); });
      var prefs = {};
      Object.keys(S.SETTINGS_DEFAULTS).forEach(function (k) { if (k !== 'persistGranted' && k !== 'lastBackupAt') prefs[k] = settings[k]; });
      return { app: S.APP, schemaVersion: S.VERSION, createdAt: iso(), settings: plainCopy(prefs), data: data };
    }
    // makeBackup({ passphrase }) -> Promise<{ text, fileName, encrypted, counts }>
    // With a passphrase the file is encrypted (the one offered first); without, plain.
    function makeBackup(o) {
      o = o || {};
      return serial(function () {
        assertUsable();
        var obj = backupObject(), counts = {};
        DATA.forEach(function (s) { counts[s] = obj.data[s].length; });
        var text = JSON.stringify(obj);
        var name = 'stepwell-backup-' + stamp() + '.json';
        var p;
        if (o.passphrase !== undefined && o.passphrase !== null && o.passphrase !== '') {
          var st = K.strength(o.passphrase);
          if (!st.ok) throw StoreError('weak-passphrase', st.message);
          if (o.confirm !== undefined && o.confirm !== o.passphrase) throw StoreError('mismatch', MSG.mismatch);
          p = K.encryptBackup(text, o.passphrase, obj).then(function (enc) { return { text: JSON.stringify(enc), fileName: name, encrypted: true, counts: counts }; });
        } else p = Promise.resolve({ text: text, fileName: name, encrypted: false, counts: counts });
        return p.then(function (res) {
          settings.lastBackupAt = obj.createdAt;
          return commit({ settings: true }).then(function () { emit({ type: 'change', stores: ['settings'], reason: 'backup' }); return res; }, function () { return res; });
        });
      });
    }
    var MAX_BACKUP_BYTES = 25 * 1024 * 1024;
    // readBackupFile(file, passphrase?) -> same as readBackup
    function readBackupFile(file, passphrase) {
      if (!file || typeof file.size !== 'number') return Promise.reject(StoreError('unreadable', MSG.unreadable));
      if (file.size > MAX_BACKUP_BYTES) return Promise.reject(StoreError('too-big', 'This file is larger than 25 MB, so it isn’t a backup this app made. Nothing on this device has changed.'));
      return file.text().then(function (t) { return readBackup(t, passphrase); });
    }
    // readBackup(text, passphrase?) -> Promise<{ token, createdAt, encrypted, file: counts, now: counts }>
    // Checks everything and changes nothing. Rejects with code 'needs-passphrase',
    // 'wrong-passphrase', 'unreadable', 'newer', 'too-big' or 'invalid' (with errors).
    function readBackup(text, passphrase) {
      return Promise.resolve().then(function () {
        assertUsable();
        if (typeof text !== 'string' || text.length > MAX_BACKUP_BYTES) throw StoreError('too-big', 'This file is larger than 25 MB, so it isn’t a backup this app made. Nothing on this device has changed.');
        var obj;
        try { obj = JSON.parse(text); } catch (e) { throw StoreError('unreadable', MSG.unreadable); }
        if (obj && obj.encrypted === true) {
          if (!S.checkEncryptedShape(obj)) throw StoreError('unreadable', MSG.unreadable);
          if (obj.schemaVersion > S.VERSION) throw StoreError('newer', MSG.newer);
          if (!passphrase) throw StoreError('needs-passphrase', 'This backup is locked with a passphrase. Enter it to open the file.');
          return K.decryptBackup(obj, passphrase).then(function (inner) {
            try { return { obj: JSON.parse(inner), encrypted: true }; } catch (e) { throw StoreError('unreadable', MSG.unreadable); }
          }, function () { throw StoreError('wrong-passphrase', MSG.wrongBackup); });
        }
        return { obj: obj, encrypted: false };
      }).then(function (r) {
        var obj = r.obj, shape = S.checkBackupShape(obj);
        if (!shape.ok) {
          if (obj && obj.app === S.APP && typeof obj.schemaVersion === 'number' && obj.schemaVersion > S.VERSION) throw StoreError('newer', MSG.newer);
          throw StoreError(obj && obj.app === S.APP ? 'invalid' : 'unreadable', obj && obj.app === S.APP ? 'This backup has a problem, so it can’t be restored. Nothing on this device has changed.' : MSG.unreadable, shape.errors.map(function (m) { return { field: '', message: m }; }));
        }
        var data = obj.data;
        if (obj.schemaVersion < S.VERSION) {
          data = {};
          DATA.forEach(function (s) { data[s] = Array.isArray(obj.data[s]) ? obj.data[s].map(function (x) { return S.migrate(s, x, obj.schemaVersion); }) : obj.data[s]; });
        }
        var v = S.validateData(data, { today: '2100-12-31' });
        if (!v.ok) throw StoreError('invalid', 'This backup has a problem, so it can’t be restored. Nothing on this device has changed.', v.errors);
        var nowCounts = {};
        DATA.forEach(function (s) { nowCounts[s] = count(s); });
        pending = { token: newId(), data: v.data, settings: obj.settings ? S.validateSettings(obj.settings).value : null };
        return { token: pending.token, createdAt: obj.createdAt, encrypted: r.encrypted, file: v.counts, now: nowCounts };
      });
    }
    // Replaces everything with the checked backup, in one transaction. The lock
    // setting stays as it is; with the lock on, the records are encrypted with
    // the current key.
    function restoreBackup(token) {
      return serial(function () {
        assertUsable();
        if (!pending || pending.token !== token) throw StoreError('not-found', 'Choose the backup file again.');
        var p = pending, put = {}, before = plainCopyKeepBytes(settings);
        DATA.forEach(function (s) { put[s] = p.data[s]; });
        if (p.settings) Object.keys(p.settings).forEach(function (k) { if (k !== 'persistGranted' && k !== 'lastBackupAt') settings[k] = p.settings[k]; });
        return write({ clear: DATA.slice(), put: put, settings: true }, 'restore').then(function () {
          pending = null;
          var n = {};
          DATA.forEach(function (s) { n[s] = count(s); });
          return { restored: n };
        }, function (e) { settings = before; throw e; });
      });
    }

    // ---------- Delete all ----------
    // deleteAll('DELETE') -> { nothingLeft, left: { databases, caches, serviceWorkers } }
    // Works while locked. Afterwards the store holds nothing and refuses writes
    // until the page is reloaded.
    function deleteAll(word) {
      if (word !== 'DELETE') return Promise.reject(StoreError('confirm', MSG.confirm));
      return serial(function () {
        var b = backend || backendFor();
        key = null; pending = null;
        return b.destroy().then(function () {
          var jobs = [];
          if (root.caches && typeof root.caches.keys === 'function') jobs.push(root.caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return root.caches['delete'](k); })); }));
          var sw = root.navigator && root.navigator.serviceWorker;
          if (sw && typeof sw.getRegistrations === 'function') jobs.push(sw.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); }));
          return Promise.all(jobs);
        }).then(function () {
          state.deleted = true; state.locked = false; state.ready = true;
          DATA.forEach(function (s) { cache[s] = new Map(); lists[s] = null; });
          settings = defaultSettings();
          if (channel) { try { channel.postMessage({ t: 'deleted' }); } catch (e) { /* closed */ } }
          return whatIsLeft(b.kind);
        }).then(function (left) {
          emit({ type: 'change', stores: DATA.concat(['settings']), reason: 'deleted' });
          return left;
        });
      });
    }
    function whatIsLeft(kind) {
      var left = { databases: [], caches: 0, serviceWorkers: 0 }, jobs = [];
      if (kind === 'indexeddb' && factory && typeof factory.databases === 'function') {
        jobs.push(factory.databases().then(function (list) { left.databases = list.map(function (d) { return d.name; }).filter(function (n) { return n === dbName; }); }, function () {}));
      }
      if (root.caches && typeof root.caches.keys === 'function') jobs.push(root.caches.keys().then(function (k) { left.caches = k.length; }, function () {}));
      var sw = root.navigator && root.navigator.serviceWorker;
      if (sw && typeof sw.getRegistrations === 'function') jobs.push(sw.getRegistrations().then(function (r) { left.serviceWorkers = r.length; }, function () {}));
      return Promise.all(jobs).then(function () {
        return { nothingLeft: !left.databases.length && !left.caches && !left.serviceWorkers, left: left };
      });
    }

    // ---------- The passphrase lock ----------
    function allPlain() {
      var put = {};
      DATA.forEach(function (s) { put[s] = Array.from(cache[s].values()).map(plainCopy); });
      return put;
    }
    // Re-writes every record under newKey (or plain when newKey is null) and
    // the new lock settings, in ONE transaction: if it fails, nothing changes.
    function rewriteAll(newKey, newLock) {
      var oldKey = key, oldLock = Object.assign({}, settings.lock);
      key = newKey;
      settings.lock = newLock;
      return commit({ put: allPlain(), settings: true }).then(function () {
        emit({ type: 'status' });
      }, function (e) { key = oldKey; settings.lock = oldLock; throw e; });
    }
    function needSaving() { if (!backend || backend.kind !== 'indexeddb') throw StoreError('no-storage', MSG.noStorage); }
    function checkNew(pass, confirm) {
      var st = K.strength(pass);
      if (!st.ok) throw StoreError('weak-passphrase', st.message);
      if (confirm !== undefined && confirm !== pass) throw StoreError('mismatch', MSG.mismatch);
    }
    function verify(pass) {
      var l = settings.lock;
      return K.deriveKey(pass, l.salt, l.iterations).then(function (k) {
        return K.checkVerifier(k, l.verifier).then(function (ok) { if (!ok) throw StoreError('wrong-passphrase', MSG.wrong); return k; });
      }, function () { throw StoreError('wrong-passphrase', MSG.wrong); });
    }
    function newLock(pass) {
      var salt = K.randomBytes(16);
      return K.deriveKey(pass, salt, K.ITERATIONS).then(function (k) {
        return K.makeVerifier(k).then(function (v) {
          return { key: k, lock: { enabled: true, salt: salt, iterations: K.ITERATIONS, timeoutMin: settings.lock.timeoutMin, verifier: v } };
        });
      });
    }
    // enableLock(passphrase, typedAgain)
    function enableLock(pass, confirm) {
      return serial(function () {
        assertUsable(); needSaving();
        if (lockOn()) throw StoreError('not-allowed', 'The lock is already on.');
        checkNew(pass, confirm);
        return newLock(pass).then(function (n) { return rewriteAll(n.key, n.lock); }).then(function () { lastActive = now().getTime(); });
      });
    }
    function changePassphrase(oldPass, pass, confirm) {
      return serial(function () {
        assertUsable(); needSaving();
        if (!lockOn()) throw StoreError('not-allowed', 'The lock is off.');
        checkNew(pass, confirm);
        return verify(oldPass).then(function () { return newLock(pass); }).then(function (n) { return rewriteAll(n.key, n.lock); });
      });
    }
    function disableLock(pass) {
      return serial(function () {
        assertUsable(); needSaving();
        if (!lockOn()) throw StoreError('not-allowed', 'The lock is off.');
        return verify(pass).then(function () {
          return rewriteAll(null, { enabled: false, salt: null, iterations: K.ITERATIONS, timeoutMin: settings.lock.timeoutMin, verifier: null });
        });
      });
    }
    function unlock(pass) {
      return serial(function () {
        if (state.deleted) throw StoreError('deleted', MSG.deleted);
        if (!state.locked) return status();
        return verify(pass).then(function (k) {
          // The key is set before fill(), so a migration that saves records
          // while unlocking encrypts them.
          key = k;
          return backend.loadAll().then(function (raw) { return fill(raw, k); }).then(function () {
            state.locked = false; lastActive = now().getTime();
            emit({ type: 'status' });
            emit({ type: 'change', stores: DATA.slice(), reason: 'unlock' });
            return status();
          }, function (e) {
            key = null;
            DATA.forEach(function (s) { cache[s] = new Map(); lists[s] = null; });
            throw e && e.name === 'StoreError' ? e : StoreError('failed', 'The app couldn’t open your data. Nothing was changed.');
          });
        });
      });
    }
    function lock() {
      if (!lockOn() || state.locked) return;
      key = null; pending = null; state.locked = true;
      DATA.forEach(function (s) { cache[s] = new Map(); lists[s] = null; });
      emit({ type: 'status' });
      emit({ type: 'change', stores: DATA.slice(), reason: 'lock' });
    }
    function touch() { lastActive = now().getTime(); }
    // Locks if the reader has been away for the chosen time. The page calls it
    // on a timer and when the tab comes back; tests call it with a fake clock.
    function checkIdle() {
      if (lockOn() && !state.locked && now().getTime() - lastActive >= settings.lock.timeoutMin * 60000) { lock(); return true; }
      return false;
    }

    // ---------- Page hooks ----------
    function hookPage() {
      ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (t) { root.addEventListener(t, touch, { passive: true, capture: true }); });
      root.addEventListener('pagehide', function () { lock(); });
      if (root.document) root.document.addEventListener('visibilitychange', function () { if (root.document.visibilityState === 'visible') checkIdle(); });
      setInterval(checkIdle, 15000);
      if (typeof root.BroadcastChannel === 'function') {
        channel = new root.BroadcastChannel('stepwell-' + dbName);
        channel.onmessage = function (ev) {
          var m = ev.data || {};
          if (m.t === 'deleted') { state.deleted = true; key = null; DATA.forEach(function (s) { cache[s] = new Map(); lists[s] = null; }); emit({ type: 'status' }); emit({ type: 'change', stores: DATA.slice(), reason: 'deleted' }); }
          if (m.t === 'changed') reloadFromDisk();
        };
      }
    }
    // Another tab saved something: read it again (with our key, if unlocked).
    function reloadFromDisk() {
      return serial(function () {
        if (!backend || state.deleted || state.closed) return null;
        return backend.loadAll().then(function (raw) {
          var s = cleanSettings(raw.settings && raw.settings[0]);
          var lockChanged = s.lock.enabled !== lockOn() || (s.lock.enabled && settings.lock.salt && K.toB64(s.lock.salt) !== K.toB64(settings.lock.salt));
          settings = s;
          if (lockChanged) {
            key = null; state.locked = s.lock.enabled;
            DATA.forEach(function (x) { cache[x] = new Map(); lists[x] = null; });
            if (!s.lock.enabled) return fill(raw, null).then(function () { emit({ type: 'status' }); emit({ type: 'change', stores: DATA.slice(), reason: 'other-tab' }); });
            emit({ type: 'status' }); emit({ type: 'change', stores: DATA.slice(), reason: 'lock' });
            return null;
          }
          if (state.locked) return null;
          return fill(raw, key).then(function () { DATA.forEach(function (x) { lists[x] = null; }); emit({ type: 'change', stores: DATA.slice(), reason: 'other-tab' }); });
        });
      }).catch(function () { /* keep what we have */ });
    }

    return {
      open: open, status: status, today: today, notice: NOTICE_NO_STORAGE,
      subscribe: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
      get: get, list: list, count: count, query: query, byMonth: byMonth, byCategory: byCategory, budgetFor: budgetFor,
      settings: publicSettings, setSettings: setSettings, setLockTimeout: setLockTimeout, checkPersisted: checkPersisted, estimate: estimate,
      add: add, addMany: addMany, update: update, 'delete': remove, remove: remove, dependents: dependents,
      setBudget: setBudget, copyBudget: copyBudget, displayName: displayName, setDisplayName: setDisplayName,
      loadSample: loadSample, removeSample: removeSample,
      addImportBatch: addImportBatch, undoImportBatch: undoImportBatch, importInfo: importInfo, findDuplicates: findDuplicates,
      exportTransactionsCsv: exportTransactionsCsv, makeBackup: makeBackup, readBackup: readBackup, readBackupFile: readBackupFile, restoreBackup: restoreBackup,
      deleteAll: deleteAll,
      enableLock: enableLock, changePassphrase: changePassphrase, disableLock: disableLock, unlock: unlock, lock: lock, touch: touch, checkIdle: checkIdle,
      passphraseHint: K.strength,
      // For tests only: what is written on disk (raw, possibly encrypted).
      _raw: function () { return backend.loadAll(); },
      // For tests only: abort the next save after n records, mid-transaction.
      _failNextCommit: function (n) { if (backend && backend.failNext) backend.failNext(n); },
      _whenIdle: function () { return queue; }
    };
  }

  root.SWStore = { create: create, StoreError: StoreError, NOTICE_NO_STORAGE: NOTICE_NO_STORAGE };
})(this);
