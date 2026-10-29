/* File import: the one source of the parsers, and the import Worker.

   One self-contained file: it loads no other script, turns no string into
   code, and makes no network request. It works two ways:
   - As the Worker (started only through SW.startImportWorker(), whose Trusted
     Types policy accepts only this file): it reads a statement off the main
     thread, so a large file never freezes the page.
   - As a plain script on a page or test page: it defines SWImportNormalize,
     SWImportCsv and SWImportOfx, and does nothing else. The message handler
     below is installed only inside a Worker.

   Four parts: normalize (caps, decoding, dates, amounts, text, the result
   and its words), CSV, OFX/QFX, and the Worker's message handler.
   PURE parsers: no DOM, no storage, no network. Every loop is a single pass
   over its input, and no regular expression runs on file content, so a
   crafted file cannot make it slow.

   Message in:  { id, name, bytes: ArrayBuffer } or { id, name, text: string },
                plus optional { mapping } for CSV column choices.
   Message out: { id, ok: true, result } or { id, ok: false, result } where
                result is always a full import result.
                Before that, a file with over 20,000 lines first sends
                { id, progress: 'large', message } so the page can say so. */

// ======================= Part 1: normalize =======================
(function (root) {
  'use strict';

  var CAPS = {
    bytes: 5 * 1024 * 1024,   // 5 MB, checked before the file is read
    rows: 50000,              // transactions per file
    field: 500,               // characters per field
    columns: 100,             // columns per CSV line
    amount: 1e8,              // largest absolute amount, in dollars: the store's own cap ($100,000,000)
    fitid: 255,               // the store's cap for a bank transaction id
    preview: 20,              // rows shown before anything is saved
    listed: 500,              // line problems kept in the result
    largeLines: 20000         // above this, the page says reading may take a minute
  };
  var MAX_CENTS = CAPS.amount * 100;

  // ---------- Plain-words messages ----------
  // Wording follows the import screens: say what happened and where, no
  // blame, no exclamation marks. Line reasons read "Line 14: the date
  // 31/02/2026 doesn't exist".
  function plural(n, one, many) { return n === 1 ? one : many; }
  function count(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function where(unit, n) { return (unit === 'transaction' ? 'Transaction ' : 'Line ') + n; }
  function quoteValue(v) {
    var s = String(v == null ? '' : v);
    if (s.length > 40) s = s.slice(0, 40) + '…';
    return s;
  }

  var FILE_MESSAGES = {
    'file-too-large': 'This file is larger than 5 MB. We can read files up to 5 MB.',
    'too-many-rows': 'This file has more than 50,000 lines. We can read up to 50,000 at a time.',
    'encoding': 'We couldn\'t read the letters in this file. We can read text saved as UTF-8, or the encoding an OFX file names.',
    'not-a-file-we-read': 'We can read CSV, OFX and QFX files. This one isn\'t a text file.',
    'empty': 'This file is empty.',
    'no-transactions': 'We couldn\'t find any transactions in this file.',
    'no-date-column': 'Choose the column with dates.',
    'no-amount-column': 'Choose the column with amounts.',
    'no-text-column': 'Choose the column with payees.',
    'bad-mapping': 'The chosen columns aren\'t in this file. Choose them again.',
    'too-many-columns': 'This file has more than 100 columns. We can read up to 100.',
    'not-ofx': 'This file is named OFX or QFX, but we couldn\'t find a statement in it.',
    'unreadable': 'We couldn\'t read this file.',
    'no-reader': 'We couldn\'t start the file reader on this page.',
    'timeout': 'We couldn\'t finish reading this file.'
  };
  var LARGE_MESSAGE = 'This file is large. It may take a minute.';
  // What a file we don't read is, for "We can read CSV, OFX and QFX files. This one is a PDF."
  var NOT_TEXT = { pdf: 'a PDF', zip: 'a ZIP or Excel file', office: 'an older Excel or Word file', word: 'a document', image: 'an image' };
  function fileError(code, what) {
    if (code === 'not-a-file-we-read' && what && NOT_TEXT[what]) {
      return { code: code, message: 'We can read CSV, OFX and QFX files. This one is ' + NOT_TEXT[what] + '.', what: what };
    }
    return { code: code, message: FILE_MESSAGES[code] || FILE_MESSAGES.unreadable };
  }

  // Line-level reasons. `v` is the value as it appeared in the file.
  function lineReason(code, v) {
    switch (code) {
      case 'date-invalid': return 'the date ' + quoteValue(v) + ' doesn\'t exist';
      case 'date': return 'we don\'t recognise the date ' + quoteValue(v);
      case 'no-date': return 'there\'s no date';
      case 'amount': return 'we don\'t recognise the amount ' + quoteValue(v);
      case 'no-amount': return 'there\'s no amount';
      case 'amount-too-large': return 'the amount ' + quoteValue(v) + ' is over $100,000,000';
      case 'no-payee': return 'there\'s no payee';
      case 'fitid-too-long': return 'the bank\'s transaction id is longer than 255 characters';
      case 'debit-and-credit': return 'there are amounts in both the money out and money in columns';
      case 'field-too-long': return 'one value is longer than 500 characters';
      case 'too-many-columns': return 'there are more than 100 columns';
      case 'short-line': return 'there are fewer columns than in the first line';
      case 'quote': return 'a quote mark is in a place we didn\'t expect';
      case 'unclosed-quote': return 'a quote mark isn\'t closed, so the rest of the file was read as one value';
      default: return 'we couldn\'t read it';
    }
  }
  function lineMessage(code, unit, n, v) { return where(unit, n) + ': ' + lineReason(code, v); }

  // Magic numbers of common files that aren't statements.
  function sniffBinary(bytes) {
    var b = bytes;
    if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
    if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4B && (b[2] === 3 || b[2] === 5 || b[2] === 7)) return 'zip';
    if (b.length >= 4 && b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) return 'office';
    if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image';
    if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image';
    if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image';
    return '';
  }
  // The same by file name, so the page can refuse without reading the file.
  function kindFromName(name) {
    var lower = String(name || '').toLowerCase(), dot = lower.lastIndexOf('.');
    var ext = dot >= 0 ? lower.slice(dot + 1) : '';
    if (ext === 'pdf') return 'pdf';
    if (ext === 'xlsx' || ext === 'zip' || ext === 'numbers') return 'zip';
    if (ext === 'xls') return 'office';
    if (ext === 'doc' || ext === 'docx' || ext === 'pages') return 'word';
    if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'heic' || ext === 'webp') return 'image';
    return '';
  }

  // ---------- Text decoding ----------
  // Known encodings only: UTF-8 (with or without a byte-order mark), UTF-16
  // with a byte-order mark, or what an OFX header declares.
  function asciiPeek(bytes, max) {
    var n = Math.min(bytes.length, max), s = '';
    for (var i = 0; i < n; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }
  function headerValue(peek, key) {
    var up = peek.toUpperCase(), at = up.indexOf(key);
    if (at < 0) return '';
    var i = at + key.length, out = '';
    while (i < up.length && (up[i] === ' ' || up[i] === '=' || up[i] === ':' || up[i] === '"' || up[i] === '\'')) i++;
    while (i < up.length && out.length < 20) {
      var c = up[i];
      if (c === '"' || c === '\'' || c === ' ' || c === '\r' || c === '\n' || c === '?' || c === '<' || c === '>') break;
      out += c; i++;
    }
    return out;
  }
  // Which decoder the file asks for, or '' if it names one we don't accept.
  function declaredEncoding(bytes) {
    var peek = asciiPeek(bytes, 1024), up = peek.toUpperCase();
    if (up.indexOf('OFXHEADER') >= 0 && up.indexOf('<?XML') < 0) {
      var enc = headerValue(peek, 'ENCODING:'), cs = headerValue(peek, 'CHARSET:');
      if (enc === 'UTF-8' || enc === 'UTF8') return 'utf-8';
      if (enc === 'USASCII' || enc === '') {
        if (cs === '1252' || cs === 'WINDOWS-1252') return 'windows-1252';
        if (cs === 'ISO-8859-1' || cs === '8859-1' || cs === 'LATIN1') return 'windows-1252';
        if (cs === 'NONE' || cs === '') return 'utf-8';
      }
      return '';
    }
    if (up.indexOf('<?XML') >= 0) {
      var x = headerValue(peek, 'ENCODING=');
      if (x === '' || x === 'UTF-8' || x === 'UTF8' || x === 'US-ASCII') return 'utf-8';
      if (x === 'WINDOWS-1252' || x === 'ISO-8859-1' || x === 'LATIN1') return 'windows-1252';
      return '';
    }
    return 'utf-8';
  }
  // bytes: Uint8Array. Returns {ok, text, encoding} or {ok: false, error}.
  function decodeBytes(bytes) {
    if (bytes.length > CAPS.bytes) return { ok: false, error: fileError('file-too-large') };
    if (typeof TextDecoder !== 'function') return { ok: false, error: fileError('encoding') };
    var binary = sniffBinary(bytes);
    if (binary) return { ok: false, error: fileError('not-a-file-we-read', binary) };
    var label, start = 0;
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) { label = 'utf-8'; start = 3; }
    else if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) { label = 'utf-16le'; start = 2; }
    else if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) { label = 'utf-16be'; start = 2; }
    else label = declaredEncoding(bytes);
    if (!label) return { ok: false, error: fileError('encoding') };
    var text;
    try { text = new TextDecoder(label, { fatal: true }).decode(bytes.subarray(start)); }
    catch (e) { return { ok: false, error: fileError('encoding') }; }
    return checkText(text, label);
  }
  // For callers that already hold the text.
  function fromText(text) {
    if (typeof text !== 'string') return { ok: false, error: fileError('unreadable') };
    if (utf8Length(text) > CAPS.bytes) return { ok: false, error: fileError('file-too-large') };
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return checkText(text, 'text');
  }
  function utf8Length(s) {
    if (s.length > CAPS.bytes) return s.length;   // already over, no need to count
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }
  // A text file has no NUL characters; a binary file almost always does.
  function checkText(text, label) {
    var n = Math.min(text.length, 4096);
    for (var i = 0; i < n; i++) if (text.charCodeAt(i) === 0) return { ok: false, error: fileError('not-a-file-we-read') };
    return { ok: true, text: text, encoding: label };
  }

  // Which parser: OFX/QFX by its header, else CSV.
  function detectKind(text, name) {
    var head = text.slice(0, 4096).toUpperCase();
    if (head.indexOf('OFXHEADER') >= 0 || head.indexOf('<?OFX') >= 0 || head.indexOf('<OFX>') >= 0) return 'ofx';
    var lower = String(name || '').toLowerCase();
    var dot = lower.lastIndexOf('.'), ext = dot >= 0 ? lower.slice(dot + 1) : '';
    if (ext === 'ofx' || ext === 'qfx') return 'ofx';
    return 'csv';
  }

  // ---------- Small character tests (no regular expressions on input) ----------
  function isDigit(c) { return c >= 48 && c <= 57; }
  function isSpace(c) { return c === 32 || c === 9 || c === 10 || c === 13 || c === 0xA0 || c === 0x202F || c === 0x2009; }
  function trim(s) {
    var a = 0, b = s.length;
    while (a < b && isSpace(s.charCodeAt(a))) a++;
    while (b > a && isSpace(s.charCodeAt(b - 1))) b--;
    return s.slice(a, b);
  }
  function digitsAt(s, i) { var j = i; while (j < s.length && isDigit(s.charCodeAt(j))) j++; return j - i; }
  function toInt(s) { var n = 0; for (var i = 0; i < s.length; i++) n = n * 10 + (s.charCodeAt(i) - 48); return n; }

  // ---------- Dates ----------
  function daysIn(y, m) {
    if (m === 2) return (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28;
    return (m === 4 || m === 6 || m === 9 || m === 11) ? 30 : 31;
  }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function ymd(y, m, d) {
    if (y < 1900 || y > 2099 || m < 1 || m > 12 || d < 1 || d > daysIn(y, m)) return null;
    return y + '-' + pad2(m) + '-' + pad2(d);
  }
  // Splits "a?b?c" on one separator (/ - .), allowing an ignored time after a
  // space or "T". Returns [a, b, c, sep] as strings of digits, or null.
  function dateParts(s) {
    s = trim(s);
    if (!s || s.length > 40) return null;
    var parts = [], cur = '', sep = '', i = 0;
    for (; i < s.length; i++) {
      var c = s.charCodeAt(i), ch = s[i];
      if (isDigit(c)) { cur += ch; if (cur.length > 4) return null; continue; }
      if (ch === '/' || ch === '-' || ch === '.') {
        if (parts.length >= 2 || !cur) return null;
        if (sep && sep !== ch) return null;
        sep = ch; parts.push(cur); cur = ''; continue;
      }
      if ((ch === ' ' || ch === 'T') && parts.length === 2 && cur) break;
      return null;
    }
    if (!cur || parts.length !== 2) return null;
    parts.push(cur);
    // Whatever follows must be a time: digits, colons, a dot, AM/PM, a zone.
    for (i = i + 1; i < s.length; i++) {
      var t = s[i];
      if (!(isDigit(s.charCodeAt(i)) || t === ':' || t === '.' || t === ' ' || t === 'A' || t === 'P' || t === 'M' ||
        t === 'a' || t === 'p' || t === 'm' || t === 'Z' || t === '+' || t === '-')) return null;
    }
    parts.push(sep);
    return parts;
  }
  // format: 'ymd', 'mdy' or 'dmy'. Returns 'YYYY-MM-DD' or null.
  function parseDate(s, format) { return parseDateDetail(s, format).value; }
  // {value: 'YYYY-MM-DD'} or {value: null, code}: 'date-invalid' when it is
  // written as a date but no such day exists (31/02/2026), else 'date'.
  function parseDateDetail(s, format) {
    var p = dateParts(String(s == null ? '' : s)), v;
    if (!p) return { value: null, code: 'date' };
    if (p[0].length === 4) {               // YYYY-MM-DD whatever the format setting
      if (p[1].length > 2 || p[2].length > 2) return { value: null, code: 'date' };
      v = ymd(toInt(p[0]), toInt(p[1]), toInt(p[2]));
    } else {
      if (p[2].length !== 4 || p[0].length > 2 || p[1].length > 2 || (format !== 'dmy' && format !== 'mdy')) return { value: null, code: 'date' };
      var a = toInt(p[0]), b = toInt(p[1]), y = toInt(p[2]);
      v = format === 'dmy' ? ymd(y, b, a) : ymd(y, a, b);
    }
    return v ? { value: v } : { value: null, code: 'date-invalid' };
  }
  // Reads a sample of date strings and picks the format.
  // Returns {format, ambiguous, mixed, matches}: matches = how many parse.
  function detectDateFormat(values) {
    var firstBig = 0, secondBig = 0, slashLike = 0;
    for (var i = 0; i < values.length; i++) {
      var p = dateParts(String(values[i] == null ? '' : values[i]));
      if (!p) continue;
      if (p[0].length === 4) continue;
      if (p[2].length !== 4) continue;
      slashLike++;
      var a = toInt(p[0]), b = toInt(p[1]);
      if (a > 12 && b <= 12) firstBig++;
      if (b > 12 && a <= 12) secondBig++;
    }
    var format = 'mdy', ambiguous = false, mixed = false;
    if (slashLike === 0) format = 'ymd';
    else if (firstBig && !secondBig) format = 'dmy';
    else if (secondBig && !firstBig) format = 'mdy';
    else if (firstBig && secondBig) { mixed = true; format = firstBig > secondBig ? 'dmy' : 'mdy'; }
    else ambiguous = true;
    var matches = 0;
    for (var j = 0; j < values.length; j++) if (parseDate(values[j], format === 'ymd' ? 'mdy' : format)) matches++;
    return { format: format, ambiguous: ambiguous, mixed: mixed, matches: matches };
  }
  // OFX: YYYYMMDD, then an optional time and zone that we ignore.
  function parseOfxDate(s) {
    s = trim(String(s == null ? '' : s));
    if (s.length < 8 || s.length > 40 || digitsAt(s, 0) < 8) return null;
    for (var i = 8; i < s.length; i++) {
      var c = s.charCodeAt(i), ch = s[i];
      if (!(isDigit(c) || ch === '.' || ch === '[' || ch === ']' || ch === ':' || ch === '-' || ch === '+' ||
        (c >= 65 && c <= 90) || (c >= 97 && c <= 122))) return null;
    }
    return ymd(toInt(s.slice(0, 4)), toInt(s.slice(4, 6)), toInt(s.slice(6, 8)));
  }

  // ---------- Amounts ----------
  // decimal: '.' (default) or ','. Returns {ok: true, cents} or
  // {ok: false, code: 'amount' | 'amount-too-large' | 'no-amount'}.
  // Accepts $, a leading + or -, a true minus sign, parentheses for money out,
  // a trailing minus, and thousands separators in groups of three. Extra
  // decimal places are accepted only when they are zeros: nothing is rounded.
  function parseAmount(raw, decimal) {
    var s = trim(String(raw == null ? '' : raw));
    if (!s) return { ok: false, code: 'no-amount' };
    if (s.length > 40) return { ok: false, code: 'amount' };
    var dec = decimal === ',' ? ',' : '.', group = dec === ',' ? '.' : ',';
    var neg = false, signs = 0, i = 0, n = s.length;
    if (s[0] === '(' && s[n - 1] === ')') { neg = true; signs++; s = trim(s.slice(1, n - 1)); n = s.length; }
    // Leading sign and currency in either order: -$1, $-1, - $ 1.
    var sawDollar = false;
    for (; i < n; i++) {
      var ch = s[i];
      if (ch === '$' && !sawDollar) { sawDollar = true; continue; }
      if ((ch === '-' || ch === '−' || ch === '+') && signs === 0) { signs++; if (ch !== '+') neg = true; continue; }
      if (ch === ' ') continue;
      break;
    }
    var end = n;
    while (end > i && s[end - 1] === ' ') end--;
    if (end > i && (s[end - 1] === '-' || s[end - 1] === '−')) {
      if (signs) return { ok: false, code: 'amount' };
      neg = true; signs++; end--;
      while (end > i && s[end - 1] === ' ') end--;
    }
    if (end > i && s[end - 1] === '$' && !sawDollar) { end--; while (end > i && s[end - 1] === ' ') end--; }
    var body = s.slice(i, end);
    if (!body) return { ok: false, code: 'amount' };
    // Digits, grouping, one decimal mark.
    var intPart = '', frac = '', seenDec = false, groupRun = -1, firstGroup = 0;
    for (var k = 0; k < body.length; k++) {
      var c = body.charCodeAt(k), b = body[k];
      if (isDigit(c)) {
        if (seenDec) frac += b;
        else { intPart += b; if (groupRun >= 0) groupRun++; else firstGroup++; }
        continue;
      }
      if (b === dec && !seenDec) {
        if (groupRun >= 0 && groupRun !== 3) return { ok: false, code: 'amount' };
        seenDec = true; continue;
      }
      if ((b === group || (dec === ',' && b === ' ')) && !seenDec) {
        if (!intPart || (groupRun >= 0 && groupRun !== 3) || (groupRun < 0 && firstGroup > 3)) return { ok: false, code: 'amount' };
        groupRun = 0; continue;
      }
      return { ok: false, code: 'amount' };
    }
    if (groupRun >= 0 && !seenDec && groupRun !== 3) return { ok: false, code: 'amount' };
    if (!intPart && !frac) return { ok: false, code: 'amount' };
    if (seenDec && !frac) return { ok: false, code: 'amount' };
    for (var z = 2; z < frac.length; z++) if (frac[z] !== '0') return { ok: false, code: 'amount' };
    frac = (frac + '00').slice(0, 2);
    var lead = 0;
    while (lead < intPart.length - 1 && intPart[lead] === '0') lead++;
    intPart = intPart.slice(lead) || '0';
    if (intPart.length > 10) return { ok: false, code: 'amount-too-large' };
    var cents = toInt(intPart) * 100 + toInt(frac);
    if (cents > MAX_CENTS) return { ok: false, code: 'amount-too-large' };
    if (neg && cents !== 0) cents = -cents;
    return { ok: true, cents: cents };
  }
  // Which decimal mark a sample of amounts uses: ',' only when some values
  // clearly end in ",dd" and none clearly end in ".dd".
  function detectDecimalMark(values) {
    var comma = 0, dot = 0;
    for (var i = 0; i < values.length; i++) {
      var s = trim(String(values[i] == null ? '' : values[i]));
      var last = -1;
      for (var j = s.length - 1; j >= 0; j--) if (s[j] === ',' || s[j] === '.') { last = j; break; }
      if (last < 0) continue;
      var after = digitsAt(s, last + 1);
      if (after >= 1 && after <= 2) { if (s[last] === ',') comma++; else dot++; }
    }
    return comma > 0 && dot === 0 ? ',' : '.';
  }
  function centsToAmount(c) { var v = c / 100; return v === 0 ? 0 : v; }

  // ---------- Text ----------
  // Collapses white space (embedded newlines included), drops control,
  // zero-width and direction-override characters, trims.
  function cleanText(raw) {
    var s = String(raw == null ? '' : raw), out = '', space = false;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (isSpace(c) || c === 0x0B || c === 0x0C || c === 0x85 || c === 0x2028 || c === 0x2029) { space = out.length > 0; continue; }
      if (c < 32 || c === 127 || (c >= 0x80 && c <= 0x9F)) continue;
      if (c === 0x200B || c === 0x200C || c === 0x200D || c === 0x200E || c === 0x200F || c === 0xFEFF || c === 0x061C) continue;
      if ((c >= 0x202A && c <= 0x202E) || (c >= 0x2066 && c <= 0x2069)) continue;
      if (space) { out += ' '; space = false; }
      out += s[i];
    }
    return out;
  }

  // ---------- Building the result ----------
  // A collector the parsers fill in; finish() returns the result object.
  function collector(kind, unit) {
    var rows = [], problems = [], warnings = [], fileErrors = [], skipped = 0;
    return {
      kind: kind,
      unit: unit,
      rowCount: function () { return rows.length; },
      addRow: function (date, text, cents, sourceLine, fitid) {
        var row = { date: date, text: text, amount: centsToAmount(cents), sourceLine: sourceLine };
        if (fitid) row.fitid = fitid;
        rows.push(row);
        return row;
      },
      skip: function (code, n, sourceLine, value) {
        skipped++;
        if (problems.length < CAPS.listed) {
          problems.push({ code: code, sourceLine: sourceLine, message: lineMessage(code, unit, n, value), reason: lineReason(code, value) });
        }
      },
      warn: function (code, message) { warnings.push({ code: code, message: message }); },
      fail: function (code, what) { fileErrors.push(fileError(code, what)); },
      failed: function () { return fileErrors.length > 0; },
      finish: function (extra) {
        if (fileErrors.length) { rows = []; skipped = 0; problems = []; }
        var dupes = markDuplicates(rows);
        if (dupes) {
          warnings.push({ code: 'possible-duplicates', message: count(dupes) + ' ' +
            plural(dupes, unit + ' has', unit + 's have') + ' the same date, payee and amount as an earlier ' + unit +
            ' in this file. ' + plural(dupes, 'It is', 'They are') + ' marked, not removed.' });
        }
        var from = '', to = '';
        for (var r = 0; r < rows.length; r++) {
          if (!from || rows[r].date < from) from = rows[r].date;
          if (!to || rows[r].date > to) to = rows[r].date;
        }
        var result = {
          kind: kind,
          rows: rows,
          warnings: warnings,
          errors: fileErrors.concat(problems),
          stats: { rows: rows.length, skipped: skipped, duplicatesInFile: dupes, dateFrom: from || null, dateTo: to || null },
          preview: {
            rows: rows.slice(0, CAPS.preview),
            skipped: problems.slice(0, CAPS.preview).map(function (p) { return { sourceLine: p.sourceLine, reason: p.message }; })
          }
        };
        result.summary = summarize(result, unit);
        if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) result[k] = extra[k];
        return result;
      }
    };
  }
  // A possible duplicate has the same FITID, or (without one) the same date,
  // amount and text as an earlier row. It is marked, never dropped: two
  // identical coffees on one day are real.
  function markDuplicates(rows) {
    var seen = new Map(), n = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var key = r.fitid ? 'f\u0000' + r.fitid : 'd\u0000' + r.date + '\u0000' + Math.round(r.amount * 100) + '\u0000' + r.text.toLowerCase();
      if (seen.has(key)) { r.possibleDuplicate = true; r.duplicateOf = seen.get(key); n++; }
      else seen.set(key, r.sourceLine);
    }
    return n;
  }
  // Fixed wording the import screens show around a result.
  var MESSAGES = {
    nothingSaved: 'Nothing is saved until you choose Save.',
    alreadyHint: 'Same date, payee and amount. We\'ll skip these.',
    large: LARGE_MESSAGE
  };
  // The error-card wording (A3, and step I3 of the import screens): what went
  // wrong, where, and what was kept.
  function summarize(result, unit) {
    unit = unit || 'line';
    var ready = result.stats.rows, skipped = result.stats.skipped, fileErr = null;
    for (var i = 0; i < result.errors.length; i++) if (result.errors[i].sourceLine == null) { fileErr = result.errors[i]; break; }
    if (fileErr) return { title: 'We couldn\'t read your file', detail: fileErr.message, ready: 0, note: MESSAGES.nothingSaved };
    var readyText = count(ready) + ' ' + plural(ready, unit + ' is', unit + 's are') + ' ready.';
    if (!skipped) return { title: readyText, detail: '', ready: ready, note: MESSAGES.nothingSaved };
    var first = '';
    for (var j = 0; j < result.errors.length; j++) if (result.errors[j].sourceLine != null) { first = result.errors[j].message; break; }
    var others = skipped - 1;
    var detail = first + '.' + (others ? ' ' + count(others) + ' other ' + plural(others, unit, unit + 's') + ' couldn\'t be read either.' : '') +
      (ready ? ' The other ' + count(ready) + ' ' + plural(ready, unit + ' is', unit + 's are') + ' ready.' : '');
    return {
      title: 'We couldn\'t read ' + count(skipped) + ' ' + plural(skipped, unit, unit + 's') + ' of your file',
      detail: detail, ready: ready, note: MESSAGES.nothingSaved
    };
  }
  // A result for a file that was refused before parsing.
  function refused(code, kind, what) {
    var c = collector(kind || 'unknown', 'line');
    c.fail(code, what);
    return c.finish();
  }
  // Step I3 when every line is already in the app (the store decides which
  // are, by its own duplicate rule): "All 213 are already in the app. Nothing to add."
  function alreadyMessage(total, already) {
    return total > 0 && already >= total ? 'All ' + count(total) + ' are already in the app. Nothing to add.' : '';
  }
  // The rows in the shape the store's import batch takes:
  // {date, cents, payee, fitId?}. Display-only fields (sourceLine, the
  // duplicate marks) are left out, because the store refuses unknown fields.
  function toStoreRows(rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], s = { date: r.date, cents: Math.round(r.amount * 100), payee: r.text };
      if (r.fitid) s.fitId = r.fitid;
      out.push(s);
    }
    return out;
  }

  root.SWImportNormalize = {
    CAPS: CAPS, MESSAGES: MESSAGES, fileError: fileError, lineMessage: lineMessage, lineReason: lineReason,
    decodeBytes: decodeBytes, fromText: fromText, detectKind: detectKind, kindFromName: kindFromName,
    parseDate: parseDate, parseDateDetail: parseDateDetail, detectDateFormat: detectDateFormat, parseOfxDate: parseOfxDate,
    parseAmount: parseAmount, detectDecimalMark: detectDecimalMark, centsToAmount: centsToAmount,
    cleanText: cleanText, trim: trim, collector: collector, markDuplicates: markDuplicates,
    summarize: summarize, refused: refused, alreadyMessage: alreadyMessage, toStoreRows: toStoreRows
  };
})(typeof self !== 'undefined' ? self : this);

// ======================= Part 2: CSV =======================
// Comma, semicolon, tab or pipe. A hand-written state machine reads the text
// once, left to right: quoted fields, doubled quotes, newlines inside quotes,
// CRLF, CR or LF line ends. Then a column mapping (found automatically, or
// chosen by the reader) turns each line into a normalised row.
(function (root) {
  'use strict';
  var N = root.SWImportNormalize;
  var CAPS = N.CAPS;
  var DELIMS = [',', ';', '\t', '|'];

  // ---------- Delimiter ----------
  // Counts each candidate per line (outside quotes) in the first 64 KB, and
  // picks the one that appears the same number of times on the most lines.
  function sniffDelimiter(text, from) {
    var end = Math.min(text.length, from + 65536), lines = [], cur = [0, 0, 0, 0], inQ = false, any = false;
    for (var i = from; i < end && lines.length < 50; i++) {
      var ch = text[i];
      if (ch === '"') { inQ = !inQ; any = true; continue; }
      if (inQ) continue;
      if (ch === '\n' || ch === '\r') { if (any) lines.push(cur); cur = [0, 0, 0, 0]; any = false; continue; }
      any = true;
      var k = DELIMS.indexOf(ch);
      if (k >= 0) cur[k]++;
    }
    if (any) lines.push(cur);
    var best = 0, bestScore = 0;
    for (var d = 0; d < DELIMS.length; d++) {
      var freq = {}, mode = 0, modeN = 0;
      for (var l = 0; l < lines.length; l++) {
        var c = lines[l][d];
        if (!c) continue;
        freq[c] = (freq[c] || 0) + 1;
        if (freq[c] > modeN) { modeN = freq[c]; mode = c; }
      }
      if (mode && modeN > bestScore) { bestScore = modeN; best = d; }
    }
    return DELIMS[best];
  }

  // ---------- Tokenizer ----------
  // Returns {records: [{line, fields, flag}], tooMany}. `line` is the file
  // line where the record starts (1-based). `flag` names the first problem.
  var FLAG_RANK = { 'unclosed-quote': 4, 'field-too-long': 3, 'too-many-columns': 2, 'quote': 1 };
  function tokenize(text, delimiter, from, firstLine, maxRecords) {
    var D = delimiter.charCodeAt(0), n = text.length;
    var records = [], fields = [], field = '', flen = 0, over = false, flag = '', quoted = false;
    var state = 0, seg = 0, line = firstLine, recLine = firstLine, nfields = 0, tooMany = false;

    function setFlag(f) { if (!flag || FLAG_RANK[f] > FLAG_RANK[flag]) flag = f; }
    function add(a, b) {
      if (over || b <= a) return;
      flen += b - a;
      if (flen > CAPS.field) { over = true; field = ''; return; }
      field += text.slice(a, b);
    }
    function addQuote() {
      if (over) return;
      flen += 1;
      if (flen > CAPS.field) { over = true; field = ''; return; }
      field += '"';
    }
    function endField() {
      if (over) setFlag('field-too-long');
      if (nfields < CAPS.columns) fields.push(field);
      else setFlag('too-many-columns');
      nfields++; field = ''; flen = 0; over = false;
    }
    function endRecord() {
      var blank = nfields === 1 && fields[0] === '' && !quoted && !flag;
      if (!blank) {
        if (records.length >= maxRecords) { tooMany = true; return false; }
        records.push({ line: recLine, fields: fields, flag: flag });
      }
      fields = []; nfields = 0; flag = ''; quoted = false;
      return true;
    }

    for (var i = from; i < n; i++) {
      var c = text.charCodeAt(i);
      if (state === 2) {                         // inside quotes
        if (c === 34) { add(seg, i); state = 3; }
        else if (c === 10 || (c === 13 && text.charCodeAt(i + 1) !== 10)) line++;
        continue;
      }
      if (state === 3) {                         // just after a quote inside quotes
        if (c === 34) { addQuote(); seg = i + 1; state = 2; continue; }
        if (c !== D && c !== 10 && c !== 13) { setFlag('quote'); state = 1; seg = i; continue; }
        seg = i;                                 // falls through to end the field
      } else if (state === 0) {
        if (c === 34) { state = 2; seg = i + 1; quoted = true; continue; }
        seg = i; state = 1;
      }
      // state 1: an unquoted field (or a closed quoted one) ending here?
      if (c === D) { if (state === 1) add(seg, i); endField(); state = 0; continue; }
      if (c === 10 || c === 13) {
        if (state === 1) add(seg, i);
        endField();
        if (c === 13 && text.charCodeAt(i + 1) === 10) i++;
        line++;
        if (!endRecord()) break;
        recLine = line; state = 0;
        continue;
      }
      // A quote inside an unquoted field is kept as it is.
    }
    if (!tooMany) {
      if (state === 2) { setFlag('unclosed-quote'); add(seg, n); }
      if (state === 1) add(seg, n);
      if (state !== 0 || nfields > 0) { endField(); endRecord(); }
    }
    return { records: records, tooMany: tooMany };
  }

  // ---------- Column mapping ----------
  function words(name) {
    var s = String(name || '').toLowerCase(), out = '', sp = true;
    for (var i = 0; i < s.length && i < 80; i++) {
      var c = s.charCodeAt(i);
      if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) { out += s[i]; sp = false; }
      else if (!sp) { out += ' '; sp = true; }
    }
    return ' ' + out.trim() + ' ';
  }
  function has(w, phrases) {
    for (var i = 0; i < phrases.length; i++) if (w.indexOf(' ' + phrases[i] + ' ') >= 0) return true;
    return false;
  }
  var NAMES = {
    date: ['date', 'posted', 'posting', 'booked', 'when'],
    debit: ['debit', 'debits', 'withdrawal', 'withdrawals', 'money out', 'paid out', 'out', 'payments', 'spent', 'charges'],
    credit: ['credit', 'credits', 'deposit', 'deposits', 'money in', 'paid in', 'in', 'received'],
    amount: ['amount', 'amt', 'value', 'sum', 'total'],
    text: [['description', 'desc', 'transaction description'], ['payee', 'merchant', 'name', 'details', 'narrative', 'particulars'],
      ['memo', 'reference', 'ref', 'notes', 'note', 'type']]
  };
  function byName(header) {
    var m = { date: -1, debit: -1, credit: -1, amount: -1, text: [] };
    var w = header.map(words);
    for (var i = 0; i < w.length; i++) {
      var bal = has(w[i], ['balance', 'running', 'bal']);
      if (m.date < 0 && has(w[i], NAMES.date)) { m.date = i; continue; }
      if (bal) continue;
      if (m.debit < 0 && has(w[i], NAMES.debit)) { m.debit = i; continue; }
      if (m.credit < 0 && has(w[i], NAMES.credit)) { m.credit = i; continue; }
      if (m.amount < 0 && has(w[i], NAMES.amount)) { m.amount = i; continue; }
    }
    for (var tier = 0; tier < NAMES.text.length && !m.text.length; tier++) {
      for (var j = 0; j < w.length; j++) {
        if (j === m.date || j === m.amount || j === m.debit || j === m.credit) continue;
        if (has(w[j], NAMES.text[tier])) { m.text.push(j); break; }
      }
    }
    return m;
  }
  function cell(rec, i) { return i >= 0 && i < rec.fields.length ? rec.fields[i] : ''; }
  // Content fallback for columns the header didn't name.
  function byContent(sample, width, m) {
    var dateRate = [], amtRate = [], textScore = [];
    for (var c = 0; c < width; c++) {
      var vals = [], filled = 0, amt = 0, txt = 0, len = 0;
      for (var r = 0; r < sample.length; r++) {
        var v = N.trim(cell(sample[r], c));
        if (!v) continue;
        filled++; vals.push(v);
        var isAmt = N.parseAmount(v, '.').ok || N.parseAmount(v, ',').ok;
        if (isAmt) amt++;
        else { txt++; len += v.length; }
      }
      var df = N.detectDateFormat(vals);
      dateRate[c] = filled ? df.matches / filled : 0;
      amtRate[c] = filled ? amt / filled : 0;
      textScore[c] = filled && dateRate[c] < 0.5 ? txt * 1000 + Math.min(len, 999) : -1;
    }
    var used = function (i) { return i === m.date || i === m.amount || i === m.debit || i === m.credit || m.text.indexOf(i) >= 0; };
    if (m.date < 0) {
      var bd = -1;
      for (var a = 0; a < width; a++) if (!used(a) && dateRate[a] >= 0.6 && (bd < 0 || dateRate[a] > dateRate[bd])) bd = a;
      m.date = bd;
    }
    if (m.amount < 0 && m.debit < 0 && m.credit < 0) {
      var ba = -1;
      for (var b = 0; b < width; b++) if (!used(b) && dateRate[b] < 0.5 && amtRate[b] >= 0.6 && (ba < 0 || amtRate[b] > amtRate[ba])) ba = b;
      m.amount = ba;
    }
    if (!m.text.length) {
      var bt = -1;
      for (var t = 0; t < width; t++) if (!used(t) && textScore[t] > 0 && (bt < 0 || textScore[t] > textScore[bt])) bt = t;
      if (bt >= 0) m.text.push(bt);
    }
    return m;
  }
  function rowLooksLikeData(rec) {
    for (var i = 0; i < rec.fields.length; i++) {
      var v = rec.fields[i];
      if (N.parseDate(v, 'mdy') || N.parseDate(v, 'dmy')) return true;
    }
    return false;
  }
  function columnLetter(i) {
    var s = '';
    i += 1;
    while (i > 0) { var r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }
  var DATE_NOTES = { dmy: 'Dates are day first (31/10)', mdy: 'Dates are month first (10/31)', ymd: 'Dates are year first (2026-10-31)' };
  function isIndex(v, width) { return typeof v === 'number' && v >= 0 && v < width && Math.floor(v) === v; }

  // ---------- Parse ----------
  // options.mapping (all optional, anything left out is found automatically):
  //   delimiter: ',' ';' '\t' '|'
  //   hasHeader: boolean
  //   date: column index; text: index or array of indexes (joined by a space)
  //   amount: index, or debit and/or credit: index (debit is money out)
  //   dateFormat: 'ymd' | 'mdy' | 'dmy'; decimal: '.' | ','
  //   negate: true flips every sign (for files that show spending as positive)
  function parse(text, options) {
    var given = (options && options.mapping) || {};
    var out = N.collector('csv', 'line');
    if (typeof text !== 'string') { out.fail('unreadable'); return out.finish(); }
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    // An Excel "sep=;" first line names the delimiter.
    var from = 0, firstLine = 1, sepLine = '';
    if (text.slice(0, 4).toLowerCase() === 'sep=' && DELIMS.indexOf(text[4]) >= 0 &&
      (text[5] === '\n' || text[5] === '\r' || text.length === 5)) {
      sepLine = text[4]; from = text[5] === '\r' && text[6] === '\n' ? 7 : 6; firstLine = 2;
    }
    var delimiter = DELIMS.indexOf(given.delimiter) >= 0 ? given.delimiter : (sepLine || sniffDelimiter(text, from));
    var tok = tokenize(text, delimiter, from, firstLine, CAPS.rows + 1);
    var recs = tok.records;
    if (!recs.length) { out.fail('empty'); return out.finish(); }

    var hasHeader = typeof given.hasHeader === 'boolean' ? given.hasHeader : !rowLooksLikeData(recs[0]);
    var header = hasHeader ? recs[0].fields : [];
    var data = hasHeader ? recs.slice(1) : recs;
    if (tok.tooMany || data.length > CAPS.rows) { out.fail('too-many-rows'); return out.finish(); }
    if (hasHeader && recs[0].flag === 'too-many-columns') { out.fail('too-many-columns'); return out.finish(); }

    var width = header.length;
    var sample = data.slice(0, 50);
    for (var s = 0; s < sample.length; s++) if (sample[s].fields.length > width) width = sample[s].fields.length;
    width = Math.min(width, CAPS.columns);
    // Column choices, as the "Which column is which?" step shows them:
    // Column A: "Posted".
    var columns = [];
    for (var c = 0; c < width; c++) {
      var samples = [];
      for (var r = 0; r < sample.length && samples.length < 3; r++) {
        var v = N.cleanText(cell(sample[r], c));
        if (v) samples.push(v.length > 60 ? v.slice(0, 60) + '…' : v);
      }
      var hname = hasHeader ? N.cleanText(header[c]).slice(0, 60) : '';
      var letter = columnLetter(c);
      columns.push({ index: c, letter: letter, name: hname, label: 'Column ' + letter + (hname ? ': "' + hname + '"' : ''), samples: samples });
    }

    // Mapping: what the reader chose wins; the rest is found.
    var found = hasHeader ? byName(header) : { date: -1, debit: -1, credit: -1, amount: -1, text: [] };
    if (found.amount >= 0) { found.debit = -1; found.credit = -1; }
    found = byContent(sample, width, found);
    var m = {
      delimiter: delimiter, hasHeader: hasHeader,
      date: 'date' in given ? given.date : found.date,
      text: 'text' in given ? (Array.isArray(given.text) ? given.text.slice(0, 5) : (given.text == null || given.text < 0 ? [] : [given.text])) : found.text,
      amount: 'amount' in given ? given.amount : ('debit' in given || 'credit' in given ? -1 : found.amount),
      debit: 'debit' in given ? given.debit : ('amount' in given ? -1 : found.debit),
      credit: 'credit' in given ? given.credit : ('amount' in given ? -1 : found.credit),
      negate: given.negate === true
    };
    if (m.amount == null) m.amount = -1;
    if (m.debit == null) m.debit = -1;
    if (m.credit == null) m.credit = -1;
    var csvInfo = {
      delimiter: delimiter, hasHeader: hasHeader, columns: columns, mapping: m,
      moneyOut: m.amount >= 0 || (m.debit < 0 && m.credit < 0) ? 'minus' : 'column',
      firstLine: null, dateNote: ''
    };
    // "First line: 01/10/2026 · BLUE DOOR 0442 · -34.30", as written in the file.
    if (data.length) {
      var f0 = data[0], tparts = [];
      for (var tp = 0; tp < m.text.length; tp++) { var tv0 = N.cleanText(cell(f0, m.text[tp])); if (tv0) tparts.push(tv0); }
      var amt0 = m.amount >= 0 ? cell(f0, m.amount) : (N.trim(cell(f0, m.debit)) ? '-' + N.trim(cell(f0, m.debit)) : cell(f0, m.credit));
      csvInfo.firstLine = {
        sourceLine: f0.line,
        date: N.cleanText(cell(f0, m.date)).slice(0, 40),
        text: tparts.join(' ').slice(0, 80),
        amount: N.cleanText(amt0).slice(0, 40)
      };
    }
    function stop(code) { out.fail(code); return out.finish({ csv: csvInfo }); }

    var picked = [m.date, m.amount, m.debit, m.credit].concat(m.text);
    for (var p = 0; p < picked.length; p++) if (picked[p] !== -1 && !isIndex(picked[p], Math.max(width, 1))) return stop('bad-mapping');
    if (m.date < 0) return stop('no-date-column');
    if (m.amount < 0 && m.debit < 0 && m.credit < 0) return stop('no-amount-column');
    if (!m.text.length || m.text.every(function (x) { return x < 0; })) return stop('no-text-column');

    // Date format and decimal mark, from every value in the chosen columns.
    var dateVals = [], amtVals = [];
    for (var d = 0; d < data.length; d++) {
      dateVals.push(cell(data[d], m.date));
      if (m.amount >= 0) amtVals.push(cell(data[d], m.amount));
      if (m.debit >= 0) amtVals.push(cell(data[d], m.debit));
      if (m.credit >= 0) amtVals.push(cell(data[d], m.credit));
    }
    var df = N.detectDateFormat(dateVals);
    m.dateFormat = given.dateFormat === 'ymd' || given.dateFormat === 'mdy' || given.dateFormat === 'dmy' ? given.dateFormat : df.format;
    m.decimal = given.decimal === ',' || given.decimal === '.' ? given.decimal : N.detectDecimalMark(amtVals);
    var parseFmt = m.dateFormat;   // 'ymd' reads only YYYY-MM-DD; slash dates then fail, never guessed
    csvInfo.dateNote = DATE_NOTES[m.dateFormat];

    if (!given.dateFormat && df.ambiguous) {
      var ex = '';
      for (var e = 0; e < dateVals.length && !ex; e++) if (N.parseDate(dateVals[e], 'mdy') && N.parseDate(dateVals[e], 'dmy') && N.trim(dateVals[e]).length >= 8) ex = N.trim(dateVals[e]);
      out.warn('date-ambiguous', 'Each date in this file could be month first or day first' + (ex ? ', such as ' + N.cleanText(ex).slice(0, 20) : '') +
        '. We read them as month first (10/31). Choose day first if that\'s how your bank writes them.');
    }
    if (!given.dateFormat && df.mixed) {
      out.warn('date-mixed', 'Some dates in this file are month first and some are day first. We read them as ' +
        (m.dateFormat === 'dmy' ? 'day first (31/10)' : 'month first (10/31)') + ', and list the dates that don\'t fit.');
    }
    if (!given.decimal && m.decimal === ',') out.warn('decimal-comma', 'Amounts in this file use a comma before the cents, for example 12,50.');
    if (!hasHeader) out.warn('no-header', 'This file has no header line, so its columns are numbered.');
    if (m.negate) out.warn('negated', 'Every amount\'s sign is flipped, as chosen.');

    // Rows.
    var need = Math.max(m.date, m.amount);
    for (var k = 0; k < data.length; k++) {
      var rec = data[k], line = rec.line;
      if (rec.flag) { out.skip(rec.flag, line, line); continue; }
      if (rec.fields.length <= need) { out.skip('short-line', line, line); continue; }
      var rawDate = N.trim(cell(rec, m.date));
      if (!rawDate) { out.skip('no-date', line, line); continue; }
      var dd = N.parseDateDetail(rawDate, parseFmt), date = dd.value;
      if (!date) { out.skip(dd.code, line, line, N.cleanText(rawDate)); continue; }
      var cents;
      if (m.amount >= 0) {
        var a = N.parseAmount(cell(rec, m.amount), m.decimal);
        if (!a.ok) { out.skip(a.code, line, line, N.cleanText(cell(rec, m.amount))); continue; }
        cents = a.cents;
      } else {
        var dv = N.trim(cell(rec, m.debit)), cv = N.trim(cell(rec, m.credit));
        var da = dv ? N.parseAmount(dv, m.decimal) : null, ca = cv ? N.parseAmount(cv, m.decimal) : null;
        if (da && !da.ok) { out.skip(da.code, line, line, N.cleanText(dv)); continue; }
        if (ca && !ca.ok) { out.skip(ca.code, line, line, N.cleanText(cv)); continue; }
        if (!da && !ca) { out.skip('no-amount', line, line); continue; }
        var dc = da ? Math.abs(da.cents) : 0, cc = ca ? Math.abs(ca.cents) : 0;
        if (dc && cc) { out.skip('debit-and-credit', line, line); continue; }
        cents = dc ? -dc : cc;
      }
      if (m.negate && cents) cents = -cents;
      var parts = [];
      for (var t = 0; t < m.text.length; t++) { var tv = N.cleanText(cell(rec, m.text[t])); if (tv) parts.push(tv); }
      var txt = parts.join(' ');
      if (!txt) { out.skip('no-payee', line, line); continue; }
      if (txt.length > CAPS.field) txt = txt.slice(0, CAPS.field);
      out.addRow(date, txt, cents, line);
    }
    if (!out.rowCount() && !data.length) out.fail('no-transactions');
    return out.finish({ csv: csvInfo });
  }

  root.SWImportCsv = { parse: parse, tokenize: tokenize, sniffDelimiter: sniffDelimiter };
})(typeof self !== 'undefined' ? self : this);

// ======================= Part 3: OFX / QFX =======================
// OFX 1.x (SGML), OFX 2.x (XML) and QFX. A hand-written scanner walks the
// text once. It reads only the STMTTRN blocks (DTPOSTED, TRNAMT, NAME, MEMO,
// FITID) and the account id, which it keeps only as its last four digits.
// Everything else is skipped. There is no XML parser here: declarations,
// DOCTYPEs and entity definitions are skipped, never expanded. Only the five
// standard character names and numeric character references are decoded, by hand.
(function (root) {
  'use strict';
  var N = root.SWImportNormalize;
  var CAPS = N.CAPS;
  var WANTED = { DTPOSTED: 1, TRNAMT: 1, NAME: 1, MEMO: 1, FITID: 1 };
  var ENDS_TXN = { BANKTRANLIST: 1, STMTRS: 1, CCSTMTRS: 1, STMTTRNRS: 1, CCSTMTTRNRS: 1, BANKMSGSRSV1: 1, CREDITCARDMSGSRSV1: 1, OFX: 1 };
  var NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' };

  function isNameChar(c) {
    return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 46 || c === 95 || c === 45 || c === 58;
  }
  function isWs(c) { return c === 32 || c === 9 || c === 10 || c === 13; }

  // &amp; &lt; &gt; &quot; &apos; &nbsp; &#65; &#x41; only. Anything else
  // stays as it is written. Each "&" looks ahead at most 10 characters.
  function decodeEntities(s) {
    if (s.indexOf('&') < 0) return s;
    var out = '', i = 0;
    while (i < s.length) {
      var ch = s[i];
      if (ch !== '&') { out += ch; i++; continue; }
      var semi = -1;
      for (var j = i + 1; j < s.length && j <= i + 10; j++) if (s[j] === ';') { semi = j; break; }
      if (semi < 0) { out += ch; i++; continue; }
      var body = s.slice(i + 1, semi), rep = null;
      if (Object.prototype.hasOwnProperty.call(NAMED, body)) rep = NAMED[body];
      else if (body[0] === '#' && body.length > 1) {
        var hex = body[1] === 'x' || body[1] === 'X', digits = body.slice(hex ? 2 : 1), cp = 0, ok = digits.length > 0;
        for (var k = 0; k < digits.length && ok; k++) {
          var d = digits.charCodeAt(k), v = d >= 48 && d <= 57 ? d - 48 : hex && d >= 65 && d <= 70 ? d - 55 : hex && d >= 97 && d <= 102 ? d - 87 : -1;
          if (v < 0) ok = false; else cp = cp * (hex ? 16 : 10) + v;
        }
        if (ok && cp >= 32 && cp <= 0x10FFFF && !(cp >= 0xD800 && cp <= 0xDFFF) && !(cp >= 0x7F && cp <= 0x9F)) rep = String.fromCodePoint(cp);
      }
      if (rep === null) { out += ch; i++; continue; }
      out += rep; i = semi + 1;
    }
    return out;
  }

  function parse(text) {
    var out = N.collector('ofx', 'transaction');
    if (typeof text !== 'string') { out.fail('unreadable'); return out.finish(); }
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var n = text.length, i = 0;

    // Line numbers, counted forward only, so the whole file is walked once.
    var lineCur = 0, lineNo = 1;
    function lineAt(pos) {
      while (lineCur < pos) {
        var c = text.charCodeAt(lineCur);
        if (c === 10 || (c === 13 && text.charCodeAt(lineCur + 1) !== 10)) lineNo++;
        lineCur++;
      }
      return lineNo;
    }

    var sawOfx = false, txn = null, leaf = null, txnCount = 0, stopped = false;
    var accounts = [], accountSeen = {};

    function finishTxn() {
      var t = txn; txn = null;
      if (!t) return;
      var f = t.f;
      if (t.over) { out.skip('field-too-long', t.n, t.line); return; }
      if (!f.DTPOSTED) { out.skip('no-date', t.n, t.line); return; }
      var date = N.parseOfxDate(f.DTPOSTED);
      if (!date) {
        var dv = N.cleanText(f.DTPOSTED), eight = dv.length >= 8;
        for (var q = 0; q < 8 && eight; q++) { var dc = dv.charCodeAt(q); if (dc < 48 || dc > 57) eight = false; }
        out.skip(eight ? 'date-invalid' : 'date', t.n, t.line, dv);
        return;
      }
      if (!f.TRNAMT) { out.skip('no-amount', t.n, t.line); return; }
      var raw = f.TRNAMT, dec = raw.indexOf(',') >= 0 && raw.indexOf('.') < 0 ? ',' : '.';
      var a = N.parseAmount(raw, dec);
      if (!a.ok) { out.skip(a.code, t.n, t.line, N.cleanText(raw)); return; }
      var name = N.cleanText(f.NAME || ''), memo = N.cleanText(f.MEMO || '');
      var txt = name && memo && memo !== name && name.length + memo.length + 3 <= CAPS.field ? name + ' - ' + memo : (name || memo);
      if (!txt) { out.skip('no-payee', t.n, t.line); return; }
      var fitid = N.cleanText(f.FITID || '');
      if (fitid.length > CAPS.fitid) { out.skip('fitid-too-long', t.n, t.line); return; }
      out.addRow(date, txt, a.cents, t.line, fitid || undefined);
    }
    function addAccount(value) {
      var digits = '';
      for (var k = 0; k < value.length; k++) { var c = value.charCodeAt(k); if (c >= 48 && c <= 57) digits += value[k]; }
      var last4 = digits.slice(-4);
      if (!last4 || accountSeen[last4]) return;
      accountSeen[last4] = true;
      accounts.push({ last4: last4 });
    }
    function onText(a, b) {
      var want = leaf;
      leaf = null;
      if (!want) return;
      while (a < b && isWs(text.charCodeAt(a))) a++;
      while (b > a && isWs(text.charCodeAt(b - 1))) b--;
      if (a === b) return;
      if (want === 'ACCTID') { if (b - a <= CAPS.field) addAccount(text.slice(a, b)); return; }
      if (!txn || !WANTED[want]) return;
      if (b - a > CAPS.field) { txn.over = true; return; }
      if (!Object.prototype.hasOwnProperty.call(txn.f, want)) txn.f[want] = decodeEntities(text.slice(a, b));
    }
    function onTag(name, close, at) {
      if (!close) {
        if (name === 'OFX') sawOfx = true;
        if (name === 'STMTTRN') {
          finishTxn();
          if (txnCount >= CAPS.rows) { stopped = true; out.fail('too-many-rows'); return; }
          txnCount++;
          txn = { n: txnCount, line: lineAt(at), f: {}, over: false };
        }
        leaf = name;
        return;
      }
      leaf = null;
      if (name === 'STMTTRN' || ENDS_TXN[name]) finishTxn();
    }

    while (i < n && !stopped) {
      var lt = text.indexOf('<', i);
      if (lt < 0) lt = n;
      if (lt > i) onText(i, lt);
      if (lt >= n) break;
      var next = text.charCodeAt(lt + 1);
      if (next === 33) {                                        // <!-- --> or <!DOCTYPE ...>: skipped
        leaf = null;
        var comment = text.slice(lt, lt + 4) === '<!--';
        var e = comment ? text.indexOf('-->', lt + 4) : text.indexOf('>', lt + 2);
        i = e < 0 ? n : e + (comment ? 3 : 1);
        continue;
      }
      if (next === 63) {                                        // <? ... ?>: skipped
        leaf = null;
        var q = text.indexOf('?>', lt + 2);
        i = q < 0 ? n : q + 2;
        continue;
      }
      var k = lt + 1, close = false, name = '', nameDone = false, bad = false;
      if (text.charCodeAt(k) === 47) { close = true; k++; }
      for (; k < n; k++) {
        var c = text.charCodeAt(k);
        if (c === 62) break;
        if (c === 60) { bad = true; break; }
        if (!nameDone && isNameChar(c)) { name += text[k]; if (name.length > 64) { bad = true; nameDone = true; } }
        else nameDone = true;
      }
      if (k >= n) bad = true;
      if (bad || !name) { leaf = null; i = k > lt ? k : lt + 1; if (i < n && text.charCodeAt(i) === 62) i++; continue; }
      i = k + 1;
      onTag(name.toUpperCase(), close, lt);
    }
    if (!stopped) finishTxn();

    if (!stopped && !txnCount) out.fail(sawOfx ? 'no-transactions' : 'not-ofx');
    if (!stopped && accounts.length > 1) {
      out.warn('several-accounts', 'This file holds transactions from ' + accounts.length + ' accounts, ending ' +
        accounts.map(function (x) { return x.last4; }).join(', ') + '. They are read together.');
    }
    return out.finish({ ofx: { accounts: stopped ? [] : accounts } });
  }

  root.SWImportOfx = { parse: parse, decodeEntities: decodeEntities };
})(typeof self !== 'undefined' ? self : this);

// ======================= Part 4: the Worker's message handler =======================
// Installed only when this file runs as a Worker. Loaded as a plain script on
// a page, it stops here and the page keeps only the three parts above.
(function (root) {
  'use strict';
  var inWorker = typeof WorkerGlobalScope !== 'undefined' && root instanceof WorkerGlobalScope && typeof window === 'undefined';
  if (!inWorker) return;
  var N = root.SWImportNormalize, CSV = root.SWImportCsv, OFX = root.SWImportOfx;

  // Backstop: the parser has no use for the network or for loading more code,
  // so these names are removed before any message is handled. (The page's CSP
  // already says connect-src 'none'; this is a second lock, Worker only.)
  ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts'].forEach(function (name) {
    try { root[name] = undefined; } catch (e) { /* the test below would show it */ }
  });

  function isLarge(text) {
    var lines = 0, at = text.indexOf('\n');
    while (at >= 0) { if (++lines > N.CAPS.largeLines) return true; at = text.indexOf('\n', at + 1); }
    return false;
  }
  function run(msg) {
    var decoded;
    if (msg && msg.bytes instanceof ArrayBuffer) decoded = N.decodeBytes(new Uint8Array(msg.bytes));
    else if (msg && typeof msg.text === 'string') decoded = N.fromText(msg.text);
    else return N.refused('unreadable');
    if (!decoded.ok) return N.refused(decoded.error.code, 'unknown', decoded.error.what);
    if (isLarge(decoded.text)) root.postMessage({ id: msg.id, progress: 'large', message: N.MESSAGES.large });
    var kind = N.detectKind(decoded.text, msg.name);
    var result = kind === 'ofx' ? OFX.parse(decoded.text) : CSV.parse(decoded.text, { mapping: msg.mapping || null });
    result.encoding = decoded.encoding;
    return result;
  }

  root.onmessage = function (ev) {
    var msg = ev.data || {}, id = msg.id, result;
    // 'probe' reports what the Worker can reach. It reads nothing from the message.
    if (msg.probe === true) {
      root.postMessage({ id: id, probe: {
        fetch: typeof fetch, xhr: typeof XMLHttpRequest, webSocket: typeof WebSocket, eventSource: typeof EventSource, importScripts: typeof importScripts
      } });
      return;
    }
    try { result = run(msg); }
    catch (e) { result = N.refused('unreadable'); }
    var ok = !result.errors.some(function (x) { return x.sourceLine == null; });
    root.postMessage({ id: id, ok: ok, result: result });
  };
})(typeof self !== 'undefined' ? self : this);
