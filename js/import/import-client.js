/* File import, page side: checks the size before reading, reads the file on
   the device, hands the bytes to the import Worker, and returns its result.
   It never creates a Worker or a script URL itself: the app's foundation
   provides SW.startImportWorker() (it holds the page's Trusted Types policy),
   and stand-alone test pages pass their own `startWorker`. Nothing is stored
   and nothing leaves the device. Load js/workers/import-worker.js on the page
   first, as a plain script: it is the one source of the parsers and of
   SWImportNormalize, which this file uses for its plain-words refusals.

   SWImportClient.readFile(file, { mapping, startWorker, timeoutMs, onProgress }) -> Promise<result>
   SWImportClient.readText(text, { name, mapping, startWorker, timeoutMs, onProgress }) -> Promise<result>
   onProgress({ stage: 'large', message }) fires for files over 20,000 lines,
   so the page can show "This file is large. It may take a minute." with a
   skeleton. There is no percentage. To change the CSV column choices, call
   readFile again with the same file and a new `mapping`.
   The promise always resolves with a full result; problems are in result.errors. */
(function (root) {
  'use strict';
  var N = root.SWImportNormalize;
  var DEFAULT_TIMEOUT = 20000;
  var nextId = 1;

  function factory(opts) {
    if (opts && typeof opts.startWorker === 'function') return opts.startWorker;
    var SW = root.SW;
    if (SW && typeof SW.startImportWorker === 'function') return SW.startImportWorker;
    return null;
  }

  function post(message, transfer, opts) {
    return new Promise(function (resolve) {
      var start = factory(opts), worker = null, timer = null, done = false;
      function finish(result) {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        if (worker) { worker.onmessage = null; worker.onerror = null; worker.terminate(); }
        resolve(result);
      }
      if (!start) { finish(N.refused('no-reader')); return; }
      try { worker = start(); } catch (e) { worker = null; }
      if (!worker || typeof worker.postMessage !== 'function') { worker = null; finish(N.refused('no-reader')); return; }
      var id = nextId++;
      worker.onmessage = function (ev) {
        var d = ev.data;
        if (d && d.id === id && d.progress === 'large') {
          if (opts && typeof opts.onProgress === 'function') opts.onProgress({ stage: 'large', message: String(d.message || '') });
          return;
        }
        if (!d || d.id !== id || !d.result || !Array.isArray(d.result.rows)) { finish(N.refused('unreadable')); return; }
        finish(d.result);
      };
      worker.onerror = function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); finish(N.refused('unreadable')); };
      timer = setTimeout(function () { finish(N.refused('timeout')); }, (opts && opts.timeoutMs) || DEFAULT_TIMEOUT);
      message.id = id;
      try { worker.postMessage(message, transfer || []); }
      catch (e) { finish(N.refused('unreadable')); }
    });
  }

  function readBytes(file) {
    if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsArrayBuffer(file);
    });
  }

  function readFile(file, opts) {
    opts = opts || {};
    if (!file || typeof file.size !== 'number') return Promise.resolve(N.refused('unreadable'));
    // The size cap is checked before a single byte is read.
    if (file.size > N.CAPS.bytes) return Promise.resolve(N.refused('file-too-large'));
    var notText = N.kindFromName(file.name);
    if (notText) return Promise.resolve(N.refused('not-a-file-we-read', 'unknown', notText));
    if (file.size === 0) return Promise.resolve(N.refused('empty'));
    return readBytes(file).then(function (buf) {
      if (!(buf instanceof ArrayBuffer) || buf.byteLength > N.CAPS.bytes) return N.refused(buf ? 'file-too-large' : 'unreadable');
      return post({ name: String(file.name || ''), bytes: buf, mapping: opts.mapping || null }, [buf], opts);
    }, function () { return N.refused('unreadable'); });
  }

  function readText(text, opts) {
    opts = opts || {};
    if (typeof text !== 'string') return Promise.resolve(N.refused('unreadable'));
    if (text.length > N.CAPS.bytes) return Promise.resolve(N.refused('file-too-large'));
    return post({ name: String(opts.name || ''), text: text, mapping: opts.mapping || null }, null, opts);
  }

  var api = { readFile: readFile, readText: readText };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SWImportClient = api;
})(typeof self !== 'undefined' ? self : this);
