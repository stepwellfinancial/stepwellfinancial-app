/* Stepwell Financial: where records are kept. Two backends with one shape:
   - indexedDB(): the database "stepwell" on this device.
   - memory(): a fallback when the browser won't let the page save. Records
     last until the page is closed or reloaded.
   The store (js/store/store.js) is the only caller. Screens never use this.

   Layout: one object store per record type (settings, accounts, balances,
   ...), keyed by "id", with NO indexes, so nothing about a record is readable
   from its key or an index. IDs are random. Every change the store makes is
   one transaction, so it either all happens or none of it does.

   backend = {
     kind: 'indexeddb' | 'memory',
     open() -> Promise                       rejects if storage can't be used
     loadAll() -> Promise<{ store: [raw records] }>
     commit(ops) -> Promise                  ops: [{ store, put: [raw] } | { store, del: [ids] } | { store, clear: true }]
     close()
     destroy() -> Promise                    deletes the whole database
     onClosedElsewhere(fn)                   another tab deleted or upgraded it
   } */
(function (root) {
  'use strict';

  function names() { return ['settings'].concat(root.SWSchema.STORE_NAMES); }

  function err(code, cause) { var e = new Error(code); e.code = code; e.cause = cause; return e; }

  function indexedDB(opts) {
    var factory = opts.factory, dbName = opts.dbName, version = opts.version, timeoutMs = opts.timeoutMs || 4000;
    var db = null, closedFn = null;

    function open() {
      return new Promise(function (resolve, reject) {
        var done = false, req;
        function finish(ok, val) { if (done) return; done = true; clearTimeout(timer); if (ok) resolve(val); else reject(val); }
        var timer = setTimeout(function () { finish(false, err('timeout')); }, timeoutMs);
        try {
          if (!factory || typeof factory.open !== 'function') { finish(false, err('unavailable')); return; }
          req = factory.open(dbName, version);
        } catch (e) { finish(false, err('refused', e)); return; }
        req.onupgradeneeded = function () {
          var d = req.result;
          // Version 1 creates every store. A later version adds its stores here
          // (and SWSchema.MIGRATIONS changes the records themselves).
          names().forEach(function (n) { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: 'id' }); });
        };
        req.onsuccess = function () {
          var d = req.result;
          if (done) { d.close(); return; }
          d.onversionchange = function () { d.close(); db = null; if (closedFn) closedFn(); };
          db = d;
          finish(true);
        };
        req.onerror = function () { finish(false, err('refused', req.error)); };
        req.onblocked = function () { /* wait for the timeout; another tab holds an older version */ };
      });
    }

    function tx(storeNames, mode) {
      if (!db) throw err('closed');
      return db.transaction(storeNames, mode, { durability: 'strict' });
    }

    function loadAll() {
      return new Promise(function (resolve, reject) {
        var out = {}, t;
        try { t = tx(names(), 'readonly'); } catch (e) { reject(e); return; }
        names().forEach(function (n) {
          var r = t.objectStore(n).getAll();
          r.onsuccess = function () { out[n] = r.result; };
        });
        t.oncomplete = function () { resolve(out); };
        t.onerror = function () { reject(err('read', t.error)); };
        t.onabort = function () { reject(err('read', t.error)); };
      });
    }

    var abortAfter = null; // tests: abort the next transaction after this many puts
    function commit(ops) {
      return new Promise(function (resolve, reject) {
        var used = {}, t, puts = 0, stop = abortAfter;
        abortAfter = null;
        ops.forEach(function (o) { used[o.store] = true; });
        var list = Object.keys(used);
        if (!list.length) { resolve(); return; }
        try { t = tx(list, 'readwrite'); } catch (e) { reject(e); return; }
        try {
          ops.forEach(function (o) {
            var s = t.objectStore(o.store);
            if (o.clear) s.clear();
            if (o.put) o.put.forEach(function (r) {
              if (stop !== null && puts === stop) throw err('test-abort');
              s.put(r); puts += 1;
            });
            if (o.del) o.del.forEach(function (id) { s.delete(id); });
          });
        } catch (e) { try { t.abort(); } catch (x) { /* already ended */ } reject(err(e && e.name === 'QuotaExceededError' ? 'full' : 'write', e)); return; }
        t.oncomplete = function () { resolve(); };
        t.onabort = function () { var e = t.error; reject(err(e && e.name === 'QuotaExceededError' ? 'full' : 'write', e)); };
        t.onerror = function (ev) { ev.preventDefault(); };
      });
    }

    function close() { if (db) { db.close(); db = null; } }

    function destroy() {
      close();
      return new Promise(function (resolve, reject) {
        var req, timer = setTimeout(function () { reject(err('blocked')); }, timeoutMs * 2);
        try { req = factory.deleteDatabase(dbName); } catch (e) { clearTimeout(timer); reject(err('refused', e)); return; }
        req.onsuccess = function () { clearTimeout(timer); resolve(); };
        req.onerror = function () { clearTimeout(timer); reject(err('refused', req.error)); };
        req.onblocked = function () { /* other tabs are asked to close (onversionchange); wait */ };
      });
    }

    return { kind: 'indexeddb', open: open, loadAll: loadAll, commit: commit, close: close, destroy: destroy,
      onClosedElsewhere: function (fn) { closedFn = fn; },
      failNext: function (n) { abortAfter = n; } };
  }

  function memory() {
    var data = {};
    function copy(v) { return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)); }
    function reset() { data = {}; names().forEach(function (n) { data[n] = new Map(); }); }
    reset();
    return {
      kind: 'memory',
      open: function () { return Promise.resolve(); },
      loadAll: function () {
        var out = {};
        names().forEach(function (n) { out[n] = Array.from(data[n].values()).map(copy); });
        return Promise.resolve(out);
      },
      commit: function (ops) {
        // Apply to a copy first, so a bad op changes nothing (like a transaction).
        var next = {};
        names().forEach(function (n) { next[n] = new Map(data[n]); });
        try {
          ops.forEach(function (o) {
            var m = next[o.store];
            if (!m) throw err('write');
            if (o.clear) m.clear();
            if (o.put) o.put.forEach(function (r) { m.set(r.id, copy(r)); });
            if (o.del) o.del.forEach(function (id) { m.delete(id); });
          });
        } catch (e) { return Promise.reject(e.code ? e : err('write', e)); }
        data = next;
        return Promise.resolve();
      },
      close: function () {},
      destroy: function () { reset(); return Promise.resolve(); },
      onClosedElsewhere: function () {}
    };
  }

  root.SWBackends = { indexedDB: indexedDB, memory: memory };
})(this);
