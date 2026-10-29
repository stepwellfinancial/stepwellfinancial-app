/* CSV export: saves a spreadsheet-safe CSV as a download.
   The cell rules (formula guard, quoting, plain-number amounts) are the
   app's one shared CSV writer, SWCsv, loaded before this file: any text cell
   starting with = + - @ tab or carriage return gets a leading ', and amounts
   made with amount(cents) are written as plain numbers, never guarded.
   This file adds only the download: a Blob and an object URL that is revoked
   after the click. No data: URLs, nothing stored, nothing sent. */
(function (root) {
  'use strict';

  function shared() {
    var W = root.SWCsv;
    if (!W || typeof W.toCsv !== 'function' || typeof W.csvGuard !== 'function') throw new Error('The shared CSV writer is not loaded.');
    return W;
  }
  // rows: arrays of cells (text, or amount(cents) for money). BOM on by default for Excel.
  function toCsv(rows, opts) { return shared().toCsv(rows, { bom: !(opts && opts.bom === false) }); }
  function amount(cents) { return shared().amount(cents); }
  function guard(s) { return shared().csvGuard(s); }

  function safeName(name) {
    var s = String(name || 'export'), out = '';
    for (var i = 0; i < s.length && out.length < 80; i++) {
      var c = s.charCodeAt(i);
      out += (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45 || c === 95 || c === 46 ? s[i] : '-';
    }
    while (out[0] === '.' || out[0] === '-') out = out.slice(1);
    if (!out) out = 'export';
    if (out.slice(-4).toLowerCase() !== '.csv') out += '.csv';
    return out;
  }
  // Saves text as a file. env (for tests) may supply { document, URL, Blob, later }.
  function download(filename, csvText, env) {
    env = env || {};
    var doc = env.document || root.document, U = env.URL || root.URL, B = env.Blob || root.Blob;
    var later = env.later || function (fn) { setTimeout(fn, 1000); };
    var blob = new B([csvText], { type: 'text/csv;charset=utf-8' });
    var url = U.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url;
    a.download = safeName(filename);
    a.rel = 'noopener';
    a.hidden = true;
    doc.body.appendChild(a);
    try { a.click(); }
    finally {
      doc.body.removeChild(a);
      later(function () { U.revokeObjectURL(url); });
    }
    return a.download;
  }

  var api = { toCsv: toCsv, amount: amount, guard: guard, safeName: safeName, download: download };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SWCsvExport = api;
})(typeof self !== 'undefined' ? self : this);
