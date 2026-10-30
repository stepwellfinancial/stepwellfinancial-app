/* Stepwell Financial prototype: tiny DOM helpers.
   Everything is built with createElement and textContent: no HTML strings and
   no style attributes, so the page works under a strict Content Security Policy. */
(function () {
  'use strict';
  var SW = window.SW = window.SW || {};
  var NS = 'http://www.w3.org/2000/svg';

  function apply(el, props) {
    if (!props) return el;
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'on') Object.keys(v).forEach(function (ev) { el.addEventListener(ev, v[ev]); });
      else if (k === 'style') throw new Error('Use classes or el.style, not a style attribute');
      else el.setAttribute(k, v === true ? '' : String(v));
    });
    return el;
  }
  function append(el, kids) {
    (Array.isArray(kids) ? kids : [kids]).forEach(function (c) {
      if (c === undefined || c === null || c === false) return;
      if (Array.isArray(c)) append(el, c);
      else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return el;
  }
  // h('p', {class: 'x'}, ['text', child])
  function h(tag, props, kids) { return append(apply(document.createElement(tag), props), kids === undefined ? [] : kids); }
  function s(tag, props, kids) { return append(apply(document.createElementNS(NS, tag), props), kids === undefined ? [] : kids); }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function icon(name, cls) {
    return s('svg', { class: 'ico-svg' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true', focusable: 'false' },
      [s('use', { href: '#i-' + name })]);
  }
  var uid = 0;
  function id(prefix) { uid += 1; return (prefix || 'sw') + '-' + uid; }

  // ---------- Money text and Hide amounts ----------
  // While "Hide amounts" is on (SW.fmt.hidden), every money text is the four
  // dots, in the page, in chart labels and in aria text: never the figure
  // with a blur. When the setting changes, the shell repaints every money
  // element in place (SW.fmt.repaint), whatever the screen does, and renders
  // the screen again if any figure would still show (SW.fmt.leaks).
  var HIDDEN = '••••';
  // element -> a function giving its text with amounts shown. Kept here, not
  // in the page, so a hidden figure is not in the DOM at all.
  var painters = new WeakMap();
  // A money input of the form kit -> { hide(), show() }
  var masks = new WeakMap();
  SW.fmt = {
    hidden: false,
    HIDDEN: HIDDEN,
    // SW.fmt.money(-121240) -> "−$1,212.40", or "••••" while hidden. Takes cents.
    money: function (cents, opts) { return SW.fmt.hidden ? HIDDEN : window.SWCalc.moneyCents(cents, opts); },
    // Any text that is a money figure already formatted (for older screens).
    text: function (formatted) { return SW.fmt.hidden ? HIDDEN : formatted; },
    // Register an element whose whole text is a money figure: track(el, () => '$1.00').
    track: function (el, shownText) { painters.set(el, shownText); el.textContent = SW.fmt.hidden ? HIDDEN : shownText(); return el; },
    // Repaint every tracked figure and form-kit money field under rootEl.
    repaint: function (rootEl) {
      Array.prototype.forEach.call(rootEl.querySelectorAll('.money, input'), function (el) {
        var p = painters.get(el);
        if (p) el.textContent = SW.fmt.hidden ? HIDDEN : p();
        var mk = masks.get(el);
        if (mk) { if (SW.fmt.hidden) mk.hide(); else mk.show(); }
      });
    },
    // While hidden: is any money still readable under rootEl (text, aria-label,
    // title, aria-valuetext, a money field's value)? -> the first one found, or null.
    leaks: function (rootEl) {
      if (!SW.fmt.hidden) return null;
      var hit = null;
      function money(s) { return typeof s === 'string' && /[$]\s?[0-9]/.test(s); }
      var w = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
      while (!hit && w.nextNode()) if (money(w.currentNode.nodeValue)) hit = w.currentNode.nodeValue;
      if (hit) return hit;
      Array.prototype.some.call(rootEl.querySelectorAll('[aria-label], [title], [aria-valuetext], input'), function (el) {
        ['aria-label', 'title', 'aria-valuetext'].forEach(function (a) { if (!hit && money(el.getAttribute(a))) hit = el.getAttribute(a); });
        if (!hit && el.tagName === 'INPUT' && el.getAttribute('inputmode') === 'decimal' && el !== document.activeElement && /[0-9]/.test(el.value)) hit = 'a filled money field';
        return !!hit;
      });
      return hit;
    }
  };
  // A span for a formatted money figure (older screens pass text from SWCalc.money).
  function money(text, cls) { return SW.fmt.track(h('span', { class: 'money' + (cls ? ' ' + cls : '') }), function () { return text; }); }
  // A span for a figure in cents: moneyCents(121240, { sign: true }).
  function moneyCents(cents, opts, cls) { return SW.fmt.track(h('span', { class: 'money' + (cls ? ' ' + cls : '') }), function () { return window.SWCalc.moneyCents(cents, opts); }); }

  // ---------- Input caps ----------
  // cap(input, 'name' | 'note' | 'search' | 'payee' | 'rule' | 'money' | 'passphrase' ...)
  // sets maxlength from SWSchema.TEXT, so a field can't take more than the store accepts.
  function cap(el, kind) {
    var n = window.SWSchema.TEXT[kind];
    if (!n) throw new Error('Unknown cap: ' + kind);
    el.maxLength = n;
    return el;
  }

  // ---------- Downloads ----------
  // download('text', 'name.csv', 'text/csv') : a Blob made on this device,
  // saved through a temporary link; the object URL is revoked afterwards.
  function download(content, fileName, type) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: type || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: fileName, class: 'sr-only' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // A disclosure: a button that shows and hides a panel.
  function disclosure(btn, panel, onOpen) {
    var pid = panel.id || (panel.id = id('panel'));
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', pid);
    panel.hidden = true;
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      panel.hidden = !open;
      if (open && onOpen) onOpen();
    });
  }

  // A segmented control: [{value, label, aria}] -> calls onChange(value).
  function seg(label, options, value, onChange) {
    var wrap = h('div', { class: 'seg', role: 'group', 'aria-label': label });
    options.forEach(function (o) {
      var b = h('button', { type: 'button', 'aria-pressed': o.value === value ? 'true' : 'false', 'aria-label': o.aria, text: o.label });
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(wrap.children, function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        onChange(o.value);
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  SW.dom = { h: h, s: s, clear: clear, icon: icon, id: id, money: money, moneyCents: moneyCents, cap: cap, download: download, disclosure: disclosure, seg: seg, NS: NS };

  // ---------- Form kit ----------
  // Shared by every data-entry screen (styles in css/app.css, .fk-*): labels
  // above fields, money inputs, errors in ink under the field, a confirm
  // box, and a saved note with Undo.

  // cents -> "1,234.50" for an input (no $, a plain minus)
  function inputText(c) {
    if (c === null || c === undefined) return '';
    return window.SWCalc.moneyCents(c).replace('$', '').replace(window.SWCalc.MINUS, '-');
  }
  // field({ label, hint, kind: 'money'|'text'|'date'|'select', value, options: [[value, label]], cap, optional, cls, mask, prefix })
  // prefix: text put before a money field's figure, such as '$' (the field then shows $25,000.00).
  // mask: true hides a filled text field under Hide amounts, like a money field (the reader's name).
  // -> { el, input, error(msg), clear(), money() -> {ok, cents} | {ok: false, message}, text() }
  function field(o) {
    var fid = id('fk'), errId = fid + '-e', hintId = fid + '-h', input;
    if (o.kind === 'select') {
      input = h('select', { id: fid });
      o.options.forEach(function (opt) { input.appendChild(h('option', { value: opt[0], text: opt[1] })); });
      input.value = o.value;
    } else {
      input = h('input', { id: fid, type: o.kind === 'date' ? 'date' : 'text', autocomplete: 'off', spellcheck: o.kind === 'text' ? 'true' : 'false',
        inputmode: o.kind === 'money' ? 'decimal' : null });
      input.value = o.kind === 'money' ? (o.prefix && o.value !== null && o.value !== undefined ? o.prefix : '') + inputText(o.value) : (o.value || '');
      if (o.kind !== 'date') cap(input, o.kind === 'money' ? 'money' : (o.cap || 'name'));
    }
    // Hide amounts: a filled money field shows dots, and its value is not in
    // the field (so not read out) until it gets focus. The typed text is kept here.
    var DOTS = HIDDEN, real = null;
    function masked() { return (o.kind === 'money' || o.mask) && SW.fmt.hidden && document.activeElement !== input; }
    function mask() {
      if (real !== null && input.value === DOTS) return; // already masked
      if (masked() && input.value.trim()) { real = input.value; input.value = DOTS; } else real = null;
    }
    function unmask() { if (real !== null && input.value === DOTS) input.value = real; real = null; }
    function value() { return real !== null && input.value === DOTS ? real : input.value; }
    if (o.kind === 'money') {
      masks.set(input, { hide: mask, show: unmask }); // the shell calls these when Hide amounts changes
      input.addEventListener('focus', unmask);
      input.addEventListener('blur', function () {
        var r = window.SWSchema.parseMoney(input.value);
        if (input.value.trim() && r.ok) input.value = (r.cents < 0 ? '' : o.prefix || '') + inputText(r.cents);
        mask();
      });
      mask();
    } else if (o.mask) {
      masks.set(input, { hide: mask, show: unmask });
      input.addEventListener('focus', unmask);
      input.addEventListener('blur', mask);
      mask();
    }
    var err = h('p', { class: 'fk-err', id: errId });
    err.hidden = true;
    var hint = o.hint ? h('p', { class: 'fk-hint', id: hintId, text: o.hint }) : null;
    if (hint) input.setAttribute('aria-describedby', hintId);
    var el = h('div', { class: 'fk-field' + (o.cls ? ' ' + o.cls : '') }, [
      h('label', { for: fid, text: o.label + (o.optional ? ' (optional)' : '') }), hint, input, err
    ]);
    return {
      el: el, input: input,
      error: function (msg) {
        el.classList.add('fk-bad'); err.hidden = false; err.textContent = msg;
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', (hint ? hintId + ' ' : '') + errId);
      },
      clear: function () {
        el.classList.remove('fk-bad'); err.hidden = true; err.textContent = '';
        input.removeAttribute('aria-invalid');
        if (hint) input.setAttribute('aria-describedby', hintId); else input.removeAttribute('aria-describedby');
      },
      // -> { ok, cents } (empty and optional: cents null) or { ok: false, message }
      money: function () {
        var v = value().trim();
        if (!v) return o.optional ? { ok: true, cents: null } : { ok: false, message: 'Enter an amount.' };
        var r = window.SWSchema.parseMoney(v);
        return r.ok ? { ok: true, cents: r.cents } : { ok: false, message: r.message };
      },
      text: function () { return value().trim(); }
    };
  }
  // Puts a store refusal under the right fields; returns true if any matched.
  function showErrors(err, map, formErr) {
    var hit = false;
    (err && err.errors || []).forEach(function (e) { if (map[e.field]) { map[e.field].error(e.message); hit = true; } });
    if (!hit && formErr) { formErr.hidden = false; formErr.textContent = (err && err.message) || 'That could not be saved. Nothing has changed.'; }
    return hit;
  }
  function focusFirstError(rootEl) {
    var bad = rootEl.querySelector('.fk-bad input, .fk-bad select') || rootEl.querySelector('.fk-formerr:not([hidden])');
    if (bad) { if (!bad.hasAttribute('tabindex') && bad.tagName === 'P') bad.setAttribute('tabindex', '-1'); bad.focus(); }
  }
  // confirmBox({ title, text, yes, no, onYes, onNo }) -> { el, focus }. The safe choice gets focus.
  function confirmBox(o) {
    var tid = id('fk-c'), did = tid + '-d';
    var yes = h('button', { type: 'button', class: 'btn small fk-danger', text: o.yes });
    var no = h('button', { type: 'button', class: 'btn small', text: o.no });
    var el = h('div', { class: 'fk-confirm', role: 'alertdialog', 'aria-labelledby': tid, 'aria-describedby': did }, [
      h('h3', { id: tid, text: o.title }), h('p', { id: did, text: o.text }), h('div', { class: 'fk-actions' }, [yes, no])
    ]);
    yes.addEventListener('click', o.onYes);
    no.addEventListener('click', o.onNo);
    el.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); o.onNo(); } });
    return { el: el, focus: function () { no.focus(); } };
  }
  // savedNote(text, onUndo) -> element; Undo is offered for 8 seconds, with no timer shown.
  function savedNote(text, onUndo) {
    var undo = onUndo ? h('button', { type: 'button', class: 'linkbtn', text: 'Undo' }) : null;
    var el = h('p', { class: 'fk-saved', role: 'status' }, [h('span', { text: text }), undo]);
    if (undo) {
      undo.addEventListener('click', function () { undo.disabled = true; onUndo(); });
      setTimeout(function () { if (undo.parentNode) undo.parentNode.removeChild(undo); }, 8000);
    }
    return el;
  }
  SW.formKit = { field: field, showErrors: showErrors, focusFirstError: focusFirstError, confirmBox: confirmBox, savedNote: savedNote, inputText: inputText };
})();
