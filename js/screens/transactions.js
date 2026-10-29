/* Transactions: every line the reader added or imported, from the on-device
   store. Add, edit and delete lines (with splits), search on this device,
   categories, rules, explain-this-line for the bank's text (pre-written
   explainers, no AI), and import a CSV, OFX or QFX file in four steps:
   choose, match the columns, check, done, with "Undo this import". Every
   money figure goes through the shared money helper; every total comes from
   js/data-ext/eng-a.js or js/calc.js. */
(function () {
  'use strict';
  var SW = window.SW;

  // Kept between renders (the shell renders again when Hide amounts changes).
  var keep = { query: '', month: null, categoryId: '', accountId: '', importId: '', limit: 200, open: {}, flash: null };
  var UNDO_MS = 8000, PAGE = 200;

  SW.screens.register('transactions', {
    render: function (wrap, ctx) {
      var store = ctx.store, dom = ctx.dom, h = dom.h, C = ctx.calc, S = window.SWSchema, A = window.SWEngA;
      var K = SW.formKit;
      var ui = { form: null, saving: false };
      var timers = [], dead = false;
      function m(cents, opts, cls) { return dom.moneyCents(cents, opts, cls); }
      function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

      // A link from Accounts: #/transactions?account=<id>
      var hashAcct = (location.hash.match(/[?&]account=([^&]+)/) || [])[1];
      if (hashAcct) { hashAcct = decodeURIComponent(hashAcct); if (store.get('accounts', hashAcct)) { keep.accountId = hashAcct; keep.importId = ''; } }

      paint();
      return {
        // Every change repaints every figure (Hide amounts included), and the
        // list under an open form or import step. The form is the same element
        // put back, so what the reader typed stays.
        onStoreChange: function () { repaintKeepingForm(); return true; },
        destroy: function () { dead = true; timers.forEach(clearTimeout); }
      };

      // ---------- Lookups ----------
      function lookups() {
        var cats = {}, accts = {};
        store.list('categories').forEach(function (c) { cats[c.id] = c; });
        store.list('accounts').forEach(function (a) { accts[a.id] = a; });
        return {
          cats: cats, accts: accts,
          catName: function (id) { return id && cats[id] ? cats[id].name : 'No category'; },
          acctName: function (id) { return id && accts[id] ? accts[id].name : 'No account'; }
        };
      }

      // ---------- Paint ----------
      function paint(focusKey) {
        if (dead) return;
        ui.stale = false;
        var st = store.status();
        dom.clear(wrap);
        wrap.appendChild(ctx.app.screenHeader(ctx.route, { eyebrow: st.hasSample ? 'Sample data' : '' }));
        if (st.locked) return;
        var note = flashNote();
        if (note) wrap.appendChild(note);
        if (ui.form) wrap.appendChild(ui.form.el);
        var accounts = store.list('accounts');
        if (!accounts.length) {
          if (!ui.form) wrap.appendChild(noAccounts(st));
        } else {
          var look = lookups(), lines = store.list('transactions');
          var months = A.monthsWithLines(lines);
          // The month shown: decided once there are lines (this month, or the
          // latest with lines). '' is the reader's own "All months" choice.
          if (keep.month === null && months.length) keep.month = months.indexOf(store.today().slice(0, 7)) >= 0 ? store.today().slice(0, 7) : months[0];
          if (keep.month && months.indexOf(keep.month) < 0) keep.month = months.length ? months[0] : null;
          var main = h('div', { class: 'trx-col' }), side = h('div', { class: 'trx-col' });
          wrap.appendChild(h('div', { class: 'trx-grid' }, [main, side]));
          main.appendChild(listCard(st, look, lines, months));
          side.appendChild(categoriesCard(look, lines));
          side.appendChild(rulesCard(look, lines));
          side.appendChild(importsCard(look));
        }
        if (focusKey) {
          var t = wrap.querySelector('[data-focus="' + focusKey + '"]');
          if (t) t.focus();
        }
      }

      // Repaint after a store change: the open form or import step goes back in
      // as it was, focus returns to where it was, and filled money fields
      // follow Hide amounts (dots while it is on, the typed figure when off).
      function repaintKeepingForm() {
        var active = document.activeElement, y = window.scrollY;
        var inForm = !!(ui.form && active && ui.form.el.contains(active));
        var key = !inForm && active && wrap.contains(active) ? active.getAttribute('data-focus') : null;
        paint(key);
        if (ui.form) {
          remask(ui.form.el);
          if (inForm && document.contains(active)) active.focus({ preventScroll: true });
        }
        window.scrollTo(0, y);
      }
      // The shared kit masks a money field on blur and unmasks it on focus,
      // so a focus and blur pair re-reads the setting without touching the value.
      function remask(rootEl) {
        Array.prototype.forEach.call(rootEl.querySelectorAll('.fk-field input[inputmode="decimal"]'), function (i) {
          if (document.activeElement === i) return;
          i.dispatchEvent(new Event('focus'));
          i.dispatchEvent(new Event('blur'));
        });
      }

      // ---------- The saved note, with Undo for 8 seconds (no timer shown) ----------
      function setFlash(text, undo) {
        keep.flash = { text: text, undo: undo || null, until: Date.now() + UNDO_MS };
        timers.push(setTimeout(function () {
          if (keep.flash && Date.now() >= keep.flash.until) { keep.flash = null; var n = wrap.querySelector('.trx-flash'); if (n) n.remove(); }
        }, UNDO_MS + 50));
      }
      // The shared saved note (it has its own solid surface).
      function flashNote() {
        var f = keep.flash;
        if (!f || Date.now() >= f.until) { keep.flash = null; return null; }
        var note = K.savedNote(f.text, f.undo ? function () { var fn = f.undo; keep.flash = null; run(fn(), 'Undone.'); } : null);
        note.setAttribute('tabindex', '-1');
        note.setAttribute('data-focus', 'flash');
        note.classList.add('trx-flash');
        return note;
      }
      // Run a write; then a note, a repaint and focus on the note.
      function run(promise, text, undo) {
        ui.saving = true;
        return promise.then(function () {
          ui.saving = false;
          setFlash(text, undo);
          ui.form = null;
          paint('flash');
        }, function (e) {
          ui.saving = false;
          setFlash((e && e.message) || 'That couldn’t be saved. Nothing changed.');
          paint('flash');
        });
      }

      function noAccounts(st) {
        var kids = [
          h('h2', { id: 'trx-empty-h', text: 'No transactions yet' }),
          h('p', { class: 'trx-body', text: 'Lines belong to an account, so add an account first. Then add lines one at a time, or import a file from your bank.' }),
          h('div', { class: 'trx-actions' }, [h('a', { class: 'btn', href: '#/accounts', text: 'Go to Accounts' })])
        ];
        if (st.canLoadSample) {
          var sample = h('button', { type: 'button', class: 'btn quiet', text: 'Look around with sample data' });
          sample.addEventListener('click', function () {
            sample.disabled = true;
            store.loadSample().then(function () { keep.month = null; paint(); }, function (e) { sample.disabled = false; ctx.app.announce(e.message); });
          });
          kids[2].appendChild(sample);
        }
        return h('section', { class: 'card trx-empty', 'aria-labelledby': 'trx-empty-h' }, kids);
      }

      function sampleChip(st) { return st.hasSample ? h('span', { class: 'chip sample', text: 'Sample data' }) : null; }
      function monthText(mo) { return mo ? C.monthLong(mo) : 'All months'; }

      // ---------- Search and the list ----------
      function listCard(st, look, lines, months) {
        var card = h('section', { class: 'card trx-list', 'aria-labelledby': 'trx-h' });
        var addBtn = h('button', { type: 'button', class: 'btn small', text: 'Add a transaction', 'data-focus': 'add' });
        var impBtn = h('button', { type: 'button', class: 'btn small quiet', text: 'Import a file', 'data-focus': 'import' });
        addBtn.addEventListener('click', function () { openLineForm(null); });
        impBtn.addEventListener('click', function () { openImport(); });
        card.appendChild(h('div', { class: 'card-h' }, [
          h('div', { class: 'trx-title' }, [h('h2', { id: 'trx-h', tabindex: '-1', text: 'Transactions' }), sampleChip(st)]),
          h('div', { class: 'trx-actions trx-head-acts' }, [addBtn, impBtn])
        ]));

        var qId = dom.id('trx-q'), hintId = dom.id('trx-hint'), mId = dom.id('trx-m'), cId = dom.id('trx-c'), aId = dom.id('trx-a');
        var q = dom.cap(h('input', { type: 'search', id: qId, autocomplete: 'off', spellcheck: 'false', 'aria-describedby': hintId, value: keep.query }), 'search');
        var mo = h('select', { id: mId }, [h('option', { value: '', text: 'All months' })].concat(months.map(function (x) { return h('option', { value: x, text: C.monthLong(x) }); })));
        mo.value = keep.month || '';
        var cat = h('select', { id: cId }, [h('option', { value: '', text: 'All categories' })]
          .concat(store.list('categories').map(function (c) { return h('option', { value: c.id, text: c.name }); }))
          .concat([h('option', { value: 'none', text: 'No category' })]));
        cat.value = keep.categoryId;
        var acct = h('select', { id: aId }, [h('option', { value: '', text: 'All accounts' })].concat(store.list('accounts').map(function (a) { return h('option', { value: a.id, text: a.name }); })));
        acct.value = keep.accountId;
        var clear = h('button', { type: 'button', class: 'btn small quiet', text: 'Clear' });
        card.appendChild(h('div', { class: 'trx-search', role: 'search', 'aria-label': 'Search transactions' }, [
          h('div', { class: 'field trx-q' }, [h('label', { for: qId, text: 'Search' }), q,
            h('span', { class: 'fine body-note', id: hintId, text: 'Words match the payee, note, category or account. Add “over 20” or “under 20” to look by amount. Search runs on this device.' })]),
          h('div', { class: 'trx-filters' }, [
            h('div', { class: 'field' }, [h('label', { for: mId, text: 'Month' }), mo]),
            h('div', { class: 'field' }, [h('label', { for: cId, text: 'Category' }), cat]),
            h('div', { class: 'field' }, [h('label', { for: aId, text: 'Account' }), acct]),
            clear
          ])
        ]));
        var imp = keep.importId ? store.get('imports', keep.importId) : null;
        if (keep.importId && !imp) keep.importId = '';
        if (imp) {
          var all = h('button', { type: 'button', class: 'linkbtn', text: 'Show every line' });
          all.addEventListener('click', function () { keep.importId = ''; paint(); });
          card.appendChild(h('p', { class: 'trx-chipline' }, ['Showing the lines from ' + (imp.fileName || 'one import') + '. ', all]));
        }
        var result = h('p', { class: 'trx-result', 'aria-live': 'polite' });
        var list = h('div', { class: 'trx-days' });
        card.appendChild(result);
        card.appendChild(list);
        card.appendChild(h('p', { class: 'note body-note', text: 'Lines you entered or imported. Money in has a plus sign, money out a minus sign. Day totals and the totals above add up the lines shown. For education only, not financial advice.' }));

        function fill() {
          var shown = A.filterStoreLines(lines, { query: keep.query, month: keep.month, categoryId: keep.categoryId, accountId: keep.accountId, importId: keep.importId }, look);
          var tot = A.lineTotals(shown), inMonth = keep.month ? lines.filter(function (t) { return t.date.slice(0, 7) === keep.month; }).length : lines.length;
          dom.clear(result);
          result.appendChild(document.createTextNode('Showing ' + tot.count + ' of ' + plural(inMonth, 'line', 'lines') + ' in ' + monthText(keep.month)));
          if (tot.count) {
            result.appendChild(document.createTextNode('. Money in '));
            result.appendChild(m(tot.inCents, { sign: true }));
            result.appendChild(document.createTextNode(', money out '));
            result.appendChild(m(tot.outCents));
          }
          result.appendChild(document.createTextNode('.'));
          dom.clear(list);
          if (!lines.length) {
            list.appendChild(h('div', { class: 'well trx-none' }, [h('p', { class: 'trx-body', text: 'No lines yet. Add one, or import a file from your bank’s website.' })]));
            return;
          }
          if (!tot.count) { list.appendChild(h('p', { class: 'well trx-none', text: 'No lines match. Clear the search to see every line.' })); return; }
          var left = keep.limit;
          A.daysOf(shown).some(function (d) {
            var sec = h('section', { class: 'trx-day', 'aria-label': A.dayLabel(d.date) + ' ' + d.date.slice(0, 4) });
            sec.appendChild(h('h3', { class: 'trx-dayhead' }, [h('span', { text: A.dayLabel(d.date) + (keep.month ? '' : ' ' + d.date.slice(0, 4)) }),
              h('span', {}, [h('span', { class: 'sr-only', text: 'Day total ' }), m(d.totalCents, { sign: true })])]));
            var ul = h('ul', { class: 'trx-lines', role: 'list' });
            d.lines.forEach(function (t) { ul.appendChild(lineRow(t, look)); });
            sec.appendChild(ul);
            list.appendChild(sec);
            left -= d.lines.length;
            return left <= 0;
          });
          if (tot.count > keep.limit) {
            var more = h('button', { type: 'button', class: 'btn small quiet trx-more', text: 'Show more lines' });
            more.addEventListener('click', function () { keep.limit += PAGE; fill(); });
            list.appendChild(more);
          }
        }
        q.addEventListener('input', function () { keep.query = q.value; keep.limit = PAGE; fill(); });
        mo.addEventListener('change', function () { keep.month = mo.value; keep.limit = PAGE; fill(); });
        cat.addEventListener('change', function () { keep.categoryId = cat.value; keep.limit = PAGE; fill(); });
        acct.addEventListener('change', function () { keep.accountId = acct.value; keep.limit = PAGE; fill(); });
        clear.addEventListener('click', function () {
          keep.query = ''; keep.categoryId = ''; keep.accountId = ''; keep.importId = ''; keep.limit = PAGE;
          paint();
          var qi = wrap.querySelector('.trx-q input');
          if (qi) qi.focus();
        });
        fill();
        return card;
      }

      // Why a line is in its category, in words.
      function whySentence(t, look) {
        if (t.splits && t.splits.length) return 'It is split across ' + plural(t.splits.length, 'part', 'parts') + '.';
        if (!t.categoryId) return 'It has no category yet.';
        var r = A.ruleFor(store.list('rules'), t.payee);
        if (r && r.categoryId === t.categoryId) return 'It matches your rule: lines with “' + r.text + '” go in ' + look.catName(r.categoryId) + '.';
        return 'It is in ' + look.catName(t.categoryId) + '.';
      }
      function sourceText(t) {
        if (t.source === 'sample') return 'Sample data';
        if (t.source === 'import') {
          var imp = t.importId ? store.get('imports', t.importId) : null;
          return 'Imported' + (imp ? ' from ' + (imp.fileName || 'a file') + ' on ' + C.dayLong(imp.at.slice(0, 10)) : '');
        }
        return 'Added by you';
      }

      // ---------- One line ----------
      function lineRow(t, look) {
        var li = h('li', { class: 'trx-line' });
        var catText = t.splits && t.splits.length ? 'Split: ' + t.splits.map(function (p) { return look.catName(p.categoryId); }).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(', ') : look.catName(t.categoryId);
        var r = !t.splits.length && t.categoryId ? A.ruleFor(store.list('rules'), t.payee) : null;
        var tag = r && r.categoryId === t.categoryId ? ' · by your rule' : '';
        var open = h('button', { type: 'button', class: 'trx-open', 'data-focus': 'line-' + t.id }, [
          h('span', { class: 'trx-text', text: t.payee }),
          h('span', { class: 'sub', text: catText + ' · ' + look.acctName(t.accountId) + tag })
        ]);
        var panel = h('div', { class: 'trx-detail' });
        dom.disclosure(open, panel, function () { keep.open[t.id] = true; });
        open.addEventListener('click', function () { if (open.getAttribute('aria-expanded') !== 'true') delete keep.open[t.id]; });
        li.appendChild(h('div', { class: 'trx-row' }, [open, h('span', { class: 'amt' }, m(t.cents, { sign: true }))]));
        var ex = A.explainLine(t.payee);
        if (ex) {
          var exBtn = h('button', { type: 'button', class: 'linkbtn trx-what', text: 'What is this?', 'aria-label': 'What is “' + t.payee + '”?' });
          var exPanel = explainer(t, ex, look);
          dom.disclosure(exBtn, exPanel);
          li.appendChild(exBtn);
          li.appendChild(exPanel);
        }
        detail(panel, t, look);
        if (keep.open[t.id]) { open.setAttribute('aria-expanded', 'true'); panel.hidden = false; }
        li.appendChild(panel);
        return li;
      }

      function explainer(t, ex, look) {
        var nameLine = '“' + ex.name + '” is ' + ex.nameIs + (ex.code ? '; “' + ex.code + '” is ' + ex.codeIs : '') + '.';
        var words = ex.words.length ? ex.words.map(function (w) { return '“' + w.word + '” means ' + w.means; }).join(', ') + '.' : '';
        return h('div', { class: 'explainer trx-ex' }, [
          h('h3', { text: 'About “' + t.payee + '”' }),
          h('p', { text: ex.means }),
          h('p', { text: nameLine + (words ? ' ' + words.charAt(0).toUpperCase() + words.slice(1) : '') }),
          h('p', { text: whySentence(t, look) }),
          h('p', { class: 'fine', text: 'Written from the bank’s text on this line only. It describes the line; it says nothing about the spending.' })
        ]);
      }

      function detail(panel, t, look) {
        var facts = h('dl', { class: 'trx-facts' }, [
          h('dt', { text: 'Date' }), h('dd', { text: A.dayLabel(t.date) + ' ' + t.date.slice(0, 4) }),
          h('dt', { text: 'Account' }), h('dd', { text: look.acctName(t.accountId) }),
          h('dt', { text: 'Category' }), h('dd', { text: whySentence(t, look) }),
          t.note ? h('dt', { text: 'Note' }) : null, t.note ? h('dd', { text: t.note }) : null,
          h('dt', { text: 'From' }), h('dd', { text: sourceText(t) })
        ]);
        panel.appendChild(facts);
        if (t.splits.length) {
          var pb = h('button', { type: 'button', class: 'explain', text: 'Show the parts' });
          var pp = h('div', { class: 'explainer' }, [
            h('h4', { text: 'Split into ' + plural(t.splits.length, 'part', 'parts') }),
            h('div', {}, t.splits.map(function (p) { return h('div', { class: 'li' }, [h('span', { text: look.catName(p.categoryId) }), h('span', { class: 'amt' }, m(p.cents, { sign: true }))]); })),
            h('p', { class: 'fine' }, ['Together: ', m(t.cents, { sign: true }), ', the whole line. Each part counts in its own category.'])
          ]);
          dom.disclosure(pb, pp);
          panel.appendChild(h('div', { class: 'trx-parts' }, [pb]));
          panel.appendChild(pp);
        }
        var edit = h('button', { type: 'button', class: 'btn small quiet', text: 'Edit', 'data-focus': 'edit-' + t.id });
        var rule = h('button', { type: 'button', class: 'btn small quiet', text: 'Make a rule', 'data-focus': 'rule-' + t.id });
        var del = h('button', { type: 'button', class: 'btn small fk-danger', text: 'Delete' });
        edit.addEventListener('click', function () { openLineForm(t); });
        rule.addEventListener('click', function () {
          var ex = A.explainLine(t.payee);
          openRuleForm(null, ex ? ex.name : t.payee, t.splits.length ? null : t.categoryId, 'rule-' + t.id);
        });
        del.addEventListener('click', function () {
          var copy = { accountId: t.accountId, date: t.date, cents: t.cents, payee: t.payee, note: t.note, categoryId: t.categoryId, splits: t.splits.slice(), importId: null, fitId: t.fitId };
          delete keep.open[t.id];
          run(store.delete('transactions', t.id), '“' + t.payee + '” deleted.', function () { return store.add('transactions', copy); });
        });
        panel.appendChild(h('div', { class: 'trx-actions' }, [edit, rule, del]));
      }

      // ---------- Form pieces: the shared form kit (labels above, ink errors under each field) ----------
      function sheet(title, kids, onCancel) {
        var hid = dom.id('trx-sheet');
        var el = h('section', { class: 'card trx-sheet', role: 'region', 'aria-labelledby': hid }, [h('h2', { id: hid, tabindex: '-1', text: title })].concat(kids));
        el.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } });
        return el;
      }
      function topError() { var p = h('p', { class: 'fk-formerr', tabindex: '-1' }); p.hidden = true; return p; }
      function showForm(form, focusEl) {
        ui.form = form;
        paint();
        window.scrollTo(0, 0);
        var t = focusEl || form.el.querySelector('h2');
        if (t) t.focus();
      }
      function closeForm(focusKey) { ui.form = null; paint(focusKey); }
      // A refusal (the store's, or the form's own checks in the same shape)
      // goes under its fields, or at the top; focus moves to the first error.
      function showErrors(form, e) {
        var hit = K.showErrors(e, form.fields, null);
        var rest = ((e && e.errors) || []).filter(function (x) { return !form.fields[x.field]; }).map(function (x) { return x.message; });
        if (!hit && !rest.length) rest = [(e && e.message) || 'That couldn’t be saved. Nothing has changed.'];
        if (rest.length) { form.top.hidden = false; form.top.textContent = rest.join(' '); }
        K.focusFirstError(form.el);
      }
      function clearErrors(form) { Object.keys(form.fields).forEach(function (k) { form.fields[k].clear(); }); form.top.hidden = true; form.top.textContent = ''; }
      // Category choices: any extra choices first, then every category by kind.
      function catOptions(extra) {
        var kinds = { expense: 'spending', income: 'money in', transfer: 'transfer' }, out = (extra || []).slice();
        ['expense', 'income', 'transfer'].forEach(function (k) {
          store.list('categories').filter(function (c) { return c.kind === k; }).forEach(function (c) { out.push([c.id, c.name + (k === 'expense' ? '' : ' (' + kinds[k] + ')')]); });
        });
        return out;
      }
      function catField(label, value, extra) { return K.field({ label: label, kind: 'select', value: value, options: catOptions(extra) }); }
      function saveCancel(saveText, back, onSave) {
        var save = h('button', { type: 'button', class: 'btn', text: saveText });
        var cancel = h('button', { type: 'button', class: 'btn ghost', text: 'Cancel' });
        save.addEventListener('click', onSave);
        cancel.addEventListener('click', function () { closeForm(back); });
        return { save: save, row: h('div', { class: 'trx-actions' }, [save, cancel]) };
      }

      // ---------- Add or edit a line (E1) ----------
      function openLineForm(t) {
        var editing = !!t, dir = t && t.cents > 0 ? 'in' : 'out';
        var accounts = store.list('accounts');
        var f = {
          cents: K.field({ label: 'Amount', kind: 'money', value: t ? Math.abs(t.cents) : null }),
          payee: K.field({ label: 'Payee', kind: 'text', cap: 'payee', value: t ? t.payee : '', hint: 'Who you paid, or who paid you, as you’d like to see it.' }),
          date: K.field({ label: 'Date', kind: 'date', value: t ? t.date : store.today() }),
          accountId: K.field({ label: 'Account', kind: 'select', options: accounts.map(function (a) { return [a.id, a.name]; }),
            value: t ? t.accountId : (keep.accountId || (accounts.filter(function (a) { return a.type === 'checking'; })[0] || accounts[0]).id) }),
          categoryId: catField('Category', t ? (t.categoryId || '__none') : '__rule',
            (editing ? [['__none', 'No category']] : [['__rule', 'Let my rules choose'], ['__none', 'No category']])),
          newName: K.field({ label: 'New category name', kind: 'text', cap: 'name' }),
          note: K.field({ label: 'Note', kind: 'text', cap: 'note', optional: true, value: t ? t.note : '' })
        };
        f.date.input.min = '1900-01-01';
        f.date.input.max = '2100-12-31';
        f.categoryId.input.appendChild(h('option', { value: '__new', text: '+ New category' }));
        f.categoryId.input.value = t ? (t.splits.length ? '__none' : (t.categoryId || '__none')) : '__rule';
        f.newName.el.hidden = true;
        var direction = dom.seg('Money out or in', [{ value: 'out', label: 'Money out' }, { value: 'in', label: 'Money in' }], dir, function (v) { dir = v; update(); });
        // Splits
        var splitOn = !!(t && t.splits.length);
        var splitId = dom.id('trx-sp');
        var splitBox = h('input', { type: 'checkbox', id: splitId });
        splitBox.checked = splitOn;
        var rows = h('div', { class: 'trx-split-rows' }), status = h('p', { class: 'trx-check', 'aria-live': 'polite' });
        var parts = [];
        function addPart(catId, cents) {
          var k = parts.length + 1;
          var cf = catField('Part ' + k + ' category', catId || '__none', [['__none', 'No category']]);
          var af = K.field({ label: 'Part ' + k + ' amount', kind: 'money', optional: true, value: cents ? Math.abs(cents) : null });
          af.input.addEventListener('input', update);
          rows.appendChild(h('div', { class: 'trx-split-row' }, [cf.el, af.el]));
          parts.push({ cat: cf.input, amt: af.input, af: af });
        }
        if (splitOn) t.splits.forEach(function (p) { addPart(p.categoryId, p.cents); }); else { addPart(); addPart(); }
        var morePart = h('button', { type: 'button', class: 'linkbtn', text: 'Add a part' });
        morePart.addEventListener('click', function () { addPart(); parts[parts.length - 1].cat.focus(); update(); });
        var splitWrap = h('div', { class: 'well trx-splits' }, [rows, morePart, status,
          h('p', { class: 'note', text: 'The gap is the amount minus the parts you typed. For education only, not financial advice.' })]);
        splitBox.addEventListener('change', function () { update(); });
        f.categoryId.input.addEventListener('change', function () { f.newName.el.hidden = f.categoryId.input.value !== '__new'; update(); });
        f.cents.input.addEventListener('input', update);

        var top = topError();
        var back = editing ? 'edit-' + t.id : 'add';
        var form = { fields: f, top: top };
        var btns = saveCancel(editing ? 'Save changes' : 'Save transaction', back, submit);
        // Read through the kit, so a figure hidden by Hide amounts still counts.
        function lineCents() {
          var r = f.cents.money();
          return r.ok && r.cents !== null ? (dir === 'out' ? -Math.abs(r.cents) : Math.abs(r.cents)) : null;
        }
        function partCents() {
          return parts.map(function (p) { var r = p.af.money(); return r.ok ? (r.cents === null ? 0 : r.cents) : null; });
        }
        // The split rows must add up to the amount before Save turns on.
        function update() {
          var on = splitBox.checked;
          splitWrap.hidden = !on;
          f.categoryId.el.hidden = on;
          f.newName.el.hidden = on || f.categoryId.input.value !== '__new';
          morePart.hidden = parts.length >= 10;
          btns.save.disabled = false;
          if (!on) return;
          dom.clear(status);
          var lc = lineCents();
          if (lc === null) { status.textContent = 'Enter the amount first, then share it out.'; btns.save.disabled = true; return; }
          var st = A.splitStatus(lc, partCents());
          if (st.bad) { status.textContent = 'A part’s amount could not be read. Type a plain amount, like 12.50.'; btns.save.disabled = true; return; }
          if (st.left === 0) { status.textContent = 'The parts add up to the amount.'; return; }
          btns.save.disabled = true;
          status.appendChild(dom.moneyCents(Math.abs(st.left)));
          status.appendChild(document.createTextNode(st.left > 0 ? ' still to place.' : ' over the amount.'));
        }
        form.el = sheet(editing ? 'Edit a transaction' : 'Add a transaction', [
          top,
          h('div', { class: 'fk-field' }, [h('span', { class: 'trx-label', text: 'Money out or in' }), direction]),
          f.cents.el, f.payee.el, f.date.el, f.accountId.el, f.categoryId.el, f.newName.el,
          h('div', { class: 'trx-check-row' }, [splitBox, h('label', { for: splitId, text: 'Split across categories' })]),
          splitWrap, f.note.el, btns.row
        ], function () { closeForm(back); });
        form.el.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') { e.preventDefault(); if (!btns.save.disabled) submit(); } });
        update();

        function submit() {
          if (ui.saving) return;
          clearErrors(form);
          var errs = [], lc = lineCents(), r = f.cents.money();
          if (!r.ok) errs.push({ field: 'cents', message: r.message });
          else if (r.cents === 0) errs.push({ field: 'cents', message: 'Enter an amount above $0.00.' });
          if (!f.payee.input.value.trim()) errs.push({ field: 'payee', message: 'Enter who you paid, or who paid you.' });
          if (!f.date.input.value) errs.push({ field: 'date', message: 'Enter the date.' });
          var cv = f.categoryId.input.value, newCat = null;
          if (!splitBox.checked && cv === '__new') {
            var nm = f.newName.input.value.trim();
            if (!nm) errs.push({ field: 'newName', message: 'Enter a name for the new category.' });
            else newCat = { name: nm, kind: dir === 'in' ? 'income' : 'expense', isFee: false };
          }
          var splits = [];
          if (splitBox.checked && lc !== null) {
            var st = A.splitStatus(lc, partCents());
            parts.forEach(function (p, i) {
              if (!st.parts[i]) return;
              splits.push({ categoryId: p.cat.value === '__none' ? null : p.cat.value, cents: st.parts[i] });
            });
            if (splits.length < 2) errs.push({ field: null, message: 'A split needs at least 2 parts with an amount.' });
          }
          if (errs.length) { showErrors(form, { errors: errs }); return; }
          var draft = { accountId: f.accountId.input.value, date: f.date.input.value, cents: lc, payee: f.payee.input.value.trim(), note: f.note.input.value.trim() };
          if (splitBox.checked) { draft.splits = splits; draft.categoryId = null; }
          else { draft.splits = []; if (cv === '__none') draft.categoryId = null; else if (cv !== '__rule' && cv !== '__new') draft.categoryId = cv; }
          ui.saving = true;
          btns.save.disabled = true;
          var job = newCat ? store.add('categories', newCat).then(function (c) { draft.categoryId = c.id; }) : Promise.resolve();
          job.then(function () {
            if (editing) {
              var before = { accountId: t.accountId, date: t.date, cents: t.cents, payee: t.payee, note: t.note, categoryId: t.categoryId, splits: t.splits.slice() };
              if (!('categoryId' in draft)) draft.categoryId = t.categoryId;
              return store.update('transactions', t.id, draft).then(function () { keep.open[t.id] = true; return function () { return store.update('transactions', t.id, before); }; });
            }
            return store.add('transactions', draft).then(function (rec) {
              if (keep.month && rec.date.slice(0, 7) !== keep.month) keep.month = rec.date.slice(0, 7);
              return function () { return store.delete('transactions', rec.id); };
            });
          }).then(function (undo) {
            ui.saving = false;
            ui.form = null;
            setFlash('Saved. Totals are up to date.', undo);
            paint('flash');
          }, function (e) {
            ui.saving = false;
            btns.save.disabled = false;
            // The store names line fields; split errors go to the top.
            showErrors(form, e);
          });
        }
        showForm(form);
      }

      // ---------- Rules ----------
      function rulesCard(look, lines) {
        var card = h('section', { class: 'card trx-rules', 'aria-labelledby': 'trx-rules-h' });
        var nb = h('button', { type: 'button', class: 'btn small quiet', text: 'New rule', 'data-focus': 'newrule' });
        nb.addEventListener('click', function () { openRuleForm(null, '', null, 'newrule'); });
        card.appendChild(h('div', { class: 'card-h' }, [h('h2', { id: 'trx-rules-h', text: 'Your rules' }), nb]));
        card.appendChild(h('p', { class: 'trx-body', text: 'A rule puts a new line in a category when its payee has the rule’s text. It works only when you leave the category for your rules to choose. It never changes a category you picked.' }));
        var rules = store.list('rules').slice().sort(function (a, b) { return a.order - b.order; });
        if (!rules.length) card.appendChild(h('p', { class: 'fine body-note', text: 'No rules yet. Make one from any line, or with New rule.' }));
        var ul = h('ul', { class: 'trx-rulelist', role: 'list' });
        rules.forEach(function (r) {
          var n = lines.filter(function (t) { return String(t.payee).toLowerCase().indexOf(r.text.toLowerCase()) >= 0; }).length;
          var ed = h('button', { type: 'button', class: 'linkbtn', text: 'Edit', 'data-focus': 'r-' + r.id, 'aria-label': 'Edit the rule for “' + r.text + '”' });
          var rm = h('button', { type: 'button', class: 'linkbtn', text: 'Delete', 'aria-label': 'Delete the rule for “' + r.text + '”' });
          ed.addEventListener('click', function () { openRuleForm(r, r.text, r.categoryId, 'r-' + r.id); });
          rm.addEventListener('click', function () {
            var copy = { text: r.text, categoryId: r.categoryId, order: r.order };
            run(store.delete('rules', r.id), 'Rule for “' + r.text + '” deleted.', function () { return store.add('rules', copy); });
          });
          ul.appendChild(h('li', { class: 'trx-rule' }, [
            h('span', {}, [h('span', { class: 'trx-rulename', text: '“' + r.text + '” goes in ' + look.catName(r.categoryId) }),
              h('span', { class: 'sub', text: plural(n, 'line has', 'lines have') + ' this text' })]),
            h('span', { class: 'trx-rule-acts' }, [ed, rm])
          ]));
        });
        card.appendChild(ul);
        card.appendChild(h('p', { class: 'note', text: 'A rule’s preview adds up the lines its text matches in the month shown. For education only, not financial advice.' }));
        return card;
      }

      function openRuleForm(rule, text, categoryId, back) {
        var cats = store.list('categories');
        if (!cats.length) { setFlash('Add a category first.'); paint('flash'); return; }
        var f = {
          text: K.field({ label: 'When the payee has this text', kind: 'text', cap: 'rule', value: text || '', hint: 'Capitals don’t matter. At least 2 characters.' }),
          categoryId: catField('Put the line in', categoryId || cats[0].id)
        };
        var preview = h('p', { class: 'trx-check', 'aria-live': 'polite' }), top = topError();
        var lines = store.list('transactions'), mo = keep.month;
        function update() {
          var p = A.previewStoreRule(lines, f.text.input.value, f.categoryId.input.value, mo);
          dom.clear(preview);
          if (f.text.input.value.trim().length < 2) { preview.textContent = 'Type at least 2 characters to see which lines have this text.'; return; }
          if (!p.count) { preview.textContent = 'No lines in ' + monthText(mo) + ' have this text.'; return; }
          preview.appendChild(document.createTextNode(plural(p.count, 'line', 'lines') + ' in ' + monthText(mo) + ' have this text, adding up to '));
          preview.appendChild(dom.moneyCents(p.totalCents, { sign: true }));
          preview.appendChild(document.createTextNode('. ' + p.inCat + ' of them ' + (p.inCat === 1 ? 'is' : 'are') + ' in ' + lookups().catName(f.categoryId.input.value) + '. The rule fills new lines only.'));
        }
        f.text.input.addEventListener('input', update);
        f.categoryId.input.addEventListener('change', update);
        var form = { fields: f, top: top };
        var btns = saveCancel(rule ? 'Save rule' : 'Save rule', back, submit);
        form.el = sheet(rule ? 'Edit a rule' : 'New rule', [top, f.text.el, f.categoryId.el, preview,
          h('p', { class: 'note', text: 'The total adds up the lines shown. For education only, not financial advice.' }),
          h('p', { class: 'fine', text: 'If two rules match a payee, the one listed first wins.' }), btns.row], function () { closeForm(back); });
        form.el.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); submit(); } });
        update();
        function submit() {
          if (ui.saving) return;
          clearErrors(form);
          var tx = f.text.input.value.trim();
          if (tx.length < 2) { showErrors(form, { errors: [{ field: 'text', message: 'Use at least 2 characters.' }] }); return; }
          var draft = { text: tx, categoryId: f.categoryId.input.value };
          ui.saving = true;
          btns.save.disabled = true;
          var job;
          if (rule) {
            var before = { text: rule.text, categoryId: rule.categoryId };
            job = store.update('rules', rule.id, draft).then(function () { return function () { return store.update('rules', rule.id, before); }; });
          } else {
            draft.order = store.list('rules').reduce(function (mx, r) { return Math.max(mx, r.order + 1); }, 0);
            job = store.add('rules', draft).then(function (r) { return function () { return store.delete('rules', r.id); }; });
          }
          job.then(function (undo) { ui.saving = false; ui.form = null; setFlash('Rule saved. It fills new lines from now on.', undo); paint('flash'); },
            function (e) { ui.saving = false; btns.save.disabled = false; showErrors(form, e); });
        }
        showForm(form);
      }

      // ---------- Categories ----------
      function categoriesCard(look, lines) {
        var card = h('section', { class: 'card trx-cats', 'aria-labelledby': 'trx-cats-h' });
        var nb = h('button', { type: 'button', class: 'btn small quiet', text: 'New category', 'data-focus': 'newcat' });
        nb.addEventListener('click', function () { openCategoryForm(null, 'newcat'); });
        card.appendChild(h('div', { class: 'card-h' }, [h('div', {}, [h('h2', { id: 'trx-cats-h', text: 'By category' }), h('p', { class: 'fine', text: monthText(keep.month) })]), nb]));
        var rows = A.categoryTotals(lines, store.list('categories'), keep.month || null);
        var ul = h('ul', { class: 'trx-catlist', role: 'list' });
        rows.forEach(function (c) {
          var show = h('button', { type: 'button', class: 'trx-cat', 'data-focus': 'cat-' + (c.categoryId || 'none') }, [
            h('span', {}, [h('span', { class: 'trx-catname', text: c.name }), h('span', { class: 'sub', text: plural(c.count, 'line', 'lines') + (c.count ? ' · show them' : '') })]),
            h('span', { class: 'amt' }, m(c.cents, { sign: true }))
          ]);
          show.addEventListener('click', function () {
            keep.categoryId = c.categoryId || 'none'; keep.query = ''; keep.limit = PAGE;
            paint();
            var hd = wrap.querySelector('#trx-h');
            if (hd) { hd.scrollIntoView({ block: 'start' }); hd.focus(); }
            ctx.app.announce('Showing ' + plural(c.count, 'line', 'lines') + ' in ' + c.name);
          });
          var acts = null;
          if (c.categoryId) {
            var cat = look.cats[c.categoryId];
            var ed = h('button', { type: 'button', class: 'linkbtn', text: 'Edit', 'data-focus': 'ce-' + c.categoryId, 'aria-label': 'Edit the category ' + c.name });
            ed.addEventListener('click', function () { openCategoryForm(cat, 'ce-' + c.categoryId); });
            acts = h('span', { class: 'trx-cat-acts' }, [ed]);
          }
          ul.appendChild(h('li', { class: 'trx-catrow' }, [show, acts]));
        });
        card.appendChild(ul);
        var tot = A.lineTotals(keep.month ? lines.filter(function (t) { return t.date.slice(0, 7) === keep.month; }) : lines);
        card.appendChild(h('p', { class: 'fine trx-catsum' }, ['Every line in ' + monthText(keep.month) + ': money in ', m(tot.inCents, { sign: true }), ', money out ', m(tot.outCents), '.']));
        card.appendChild(h('p', { class: 'note', text: 'Each total adds up its lines and split parts; select one to see them. For education only, not financial advice.' }));
        return card;
      }

      function openCategoryForm(cat, back) {
        var f = {
          name: K.field({ label: 'Name', kind: 'text', cap: 'name', value: cat ? cat.name : '' }),
          kind: K.field({ label: 'Kind', kind: 'select', value: cat ? cat.kind : 'expense', hint: 'Transfers count as neither money in nor money out.',
            options: [['expense', 'Spending'], ['income', 'Money in'], ['transfer', 'Transfer between your accounts']] })
        };
        var feeId = dom.id('trx-fee'), fee = h('input', { type: 'checkbox', id: feeId });
        fee.checked = !!(cat && cat.isFee);
        var top = topError(), form = { fields: f, top: top };
        var btns = saveCancel(cat ? 'Save changes' : 'Save category', back, submit);
        var kids = [top, f.name.el, f.kind.el, h('div', { class: 'trx-check-row' }, [fee, h('label', { for: feeId, text: 'Lines here are fees (they show in the fee x-ray on Bills)' })]), btns.row];
        if (cat) {
          var del = h('button', { type: 'button', class: 'btn small fk-danger', text: 'Delete category' });
          del.addEventListener('click', function () { openDeleteCategory(cat, back); });
          kids.push(h('div', { class: 'trx-actions' }, [del]));
        }
        form.el = sheet(cat ? 'Edit “' + cat.name + '”' : 'New category', kids, function () { closeForm(back); });
        form.el.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') { e.preventDefault(); submit(); } });
        function submit() {
          if (ui.saving) return;
          clearErrors(form);
          var nm = f.name.input.value.trim();
          if (!nm) { showErrors(form, { errors: [{ field: 'name', message: 'Enter a name for the category.' }] }); return; }
          var draft = { name: nm, kind: f.kind.input.value, isFee: fee.checked };
          ui.saving = true;
          btns.save.disabled = true;
          var job = cat
            ? store.update('categories', cat.id, draft).then(function () { var b = { name: cat.name, kind: cat.kind, isFee: cat.isFee }; return function () { return store.update('categories', cat.id, b); }; })
            : store.add('categories', draft).then(function (c) { return function () { return store.delete('categories', c.id); }; });
          job.then(function (undo) { ui.saving = false; ui.form = null; setFlash('Category saved.', undo); paint('flash'); },
            function (e) { ui.saving = false; btns.save.disabled = false; showErrors(form, e); });
        }
        showForm(form);
      }

      function openDeleteCategory(cat, back) {
        var dep = store.dependents('categories', cat.id), rem = dep.removed || {}, chg = dep.changed || {};
        var bits = [];
        if (rem.rules) bits.push(plural(rem.rules, 'rule that uses it goes too', 'rules that use it go too'));
        if (chg.transactions) bits.push(plural(chg.transactions, 'line loses', 'lines lose') + ' its category and becomes uncategorised');
        if (chg.budgets) bits.push(plural(chg.budgets, 'budget month drops', 'budget months drop') + ' its line for it');
        if (chg.bills) bits.push(plural(chg.bills, 'bill loses', 'bills lose') + ' the category');
        confirmSheet({
          title: 'Delete “' + cat.name + '”?',
          text: 'This removes the category from this device.' + (bits.length ? ' ' + bits.join('; ') + '.' : '') + ' Lines themselves stay. You can’t undo this unless you have a backup.',
          yes: 'Delete category', no: 'Keep it', back: back,
          onYes: function () { return run(store.delete('categories', cat.id), '“' + cat.name + '” deleted.'); }
        });
      }
      // The shared confirm box, in a card; the safe choice has focus.
      function confirmSheet(o) {
        var busy = false;
        var cb = K.confirmBox({ title: o.title, text: o.text, yes: o.yes, no: o.no,
          onYes: function () { if (busy || ui.saving) return; busy = true; o.onYes(); },
          onNo: function () { closeForm(o.back); } });
        showForm({ fields: {}, top: topError(), el: h('section', { class: 'card trx-sheet trx-confirm' }, [cb.el]) });
        cb.focus();
      }

      // ---------- Imports: the log, and Undo this import ----------
      function importsCard(look) {
        var card = h('section', { class: 'card trx-imports', 'aria-labelledby': 'trx-imp-h' });
        var ib = h('button', { type: 'button', class: 'btn small quiet', text: 'Import a file' });
        ib.addEventListener('click', function () { openImport(); });
        card.appendChild(h('div', { class: 'card-h' }, [h('h2', { id: 'trx-imp-h', text: 'Your imports' }), ib]));
        var log = store.list('imports').slice().sort(function (a, b) { return a.at < b.at ? 1 : -1; });
        if (!log.length) {
          card.appendChild(h('p', { class: 'trx-body', text: 'Import a CSV, OFX or QFX file from your bank’s website. We read it on this device. It isn’t sent anywhere.' }));
          return card;
        }
        var ul = h('ul', { class: 'trx-rulelist', role: 'list' });
        log.forEach(function (imp) {
          var info = store.importInfo(imp.id);
          var see = h('button', { type: 'button', class: 'linkbtn', text: 'See them', 'aria-label': 'See the lines from ' + (imp.fileName || 'this import') });
          var undo = h('button', { type: 'button', class: 'linkbtn', text: 'Undo this import', 'data-focus': 'undo-' + imp.id });
          see.addEventListener('click', function () { keep.importId = imp.id; keep.month = ''; keep.query = ''; keep.categoryId = ''; keep.accountId = ''; paint(); var hd = wrap.querySelector('#trx-h'); if (hd) hd.focus(); });
          undo.addEventListener('click', function () { openUndoImport(imp, 'undo-' + imp.id); });
          ul.appendChild(h('li', { class: 'trx-rule' }, [
            h('span', {}, [h('span', { class: 'trx-rulename', text: imp.fileName || 'A file' }),
              h('span', { class: 'sub', text: C.dayLong(imp.at.slice(0, 10)) + ' · ' + plural(info.lines, 'line', 'lines') + ' in ' + look.acctName(imp.accountId) })]),
            h('span', { class: 'trx-rule-acts' }, info.lines ? [see, undo] : [])
          ]));
        });
        card.appendChild(ul);
        return card;
      }

      function openUndoImport(imp, back) {
        var info = store.importInfo(imp.id);
        confirmSheet({
          title: 'Undo the import of ' + (imp.fileName || 'this file') + '?',
          text: 'This removes the ' + plural(info.lines, 'line', 'lines') + ' this import added' +
            (info.editedSince ? ', including ' + info.editedSince + ' you edited since' : '') + '. Your other lines stay as they are.',
          yes: 'Undo this import', no: 'Keep them', back: back,
          onYes: function () {
            if (keep.importId === imp.id) keep.importId = '';
            return run(store.undoImportBatch(imp.id), 'Import undone. Its ' + plural(info.lines, 'line was', 'lines were') + ' removed.');
          }
        });
      }

      // ---------- Import a file: choose (I1), match (I2), check (I3), done (I4) ----------
      function openImport() {
        // The page-side parsers and the client, read when the import opens.
        var N = window.SWImportNormalize, IC = window.SWImportClient;
        if (!N || !N.CAPS || !IC || typeof SW.startImportWorker !== 'function') {
          setFlash('We couldn’t start the file reader on this page. Nothing has changed. Reload the page to try again.');
          paint('flash');
          return;
        }
        var own = store.list('accounts').filter(function (a) { return a.source !== 'sample'; });
        var imp = { step: 1, file: null, accountId: own.length ? (own.some(function (a) { return a.id === keep.accountId; }) ? keep.accountId : own[0].id) : '', mapping: null, result: null, dup: null, saved: null, busy: false, large: false };
        var body = h('div', { class: 'trx-import' });
        var form = { fields: {}, top: topError() };
        form.el = sheet('Import a file', [form.top, body], function () { closeForm('import'); });
        var title = form.el.querySelector('h2');
        showForm(form);
        draw();

        function step(n, heading) { imp.step = n; title.textContent = heading; }
        function draw(focus) {
          dom.clear(body);
          if (imp.step === 1) chooseStep(); else if (imp.step === 2) mapStep(); else if (imp.step === 3) checkStep(); else doneStep();
          if (focus) title.focus();
        }
        function cancelBtn(text) {
          var b = h('button', { type: 'button', class: 'btn ghost', text: text || 'Cancel' });
          b.addEventListener('click', function () { closeForm('import'); });
          return b;
        }
        function errorCard(res) {
          var s = res.summary || { title: 'We couldn’t read your file', detail: '' };
          return h('div', { class: 'well trx-error-card', role: 'status' }, [h('h3', { text: s.title }), s.detail ? h('p', { text: s.detail }) : null,
            h('p', { class: 'fine', text: 'Nothing on this device has changed.' })]);
        }
        function fileError(res) {
          for (var i = 0; i < res.errors.length; i++) if (res.errors[i].sourceLine == null) return res.errors[i];
          return null;
        }

        // I1: choose
        function chooseStep() {
          step(1, 'Import a file');
          body.appendChild(h('p', { class: 'trx-body', text: 'Download a CSV, OFX or QFX file from your bank’s website, then choose it here. We read it on this device. It isn’t sent anywhere.' }));
          if (!own.length) {
            body.appendChild(h('p', { class: 'trx-body', text: 'An import goes into one of your own accounts. Sample accounts can’t take an import, so add an account first.' }));
            body.appendChild(h('div', { class: 'trx-actions' }, [h('a', { class: 'btn', href: '#/accounts', text: 'Go to Accounts' }), cancelBtn()]));
            return;
          }
          var aField = K.field({ label: 'Add it to', kind: 'select', value: imp.accountId, options: own.map(function (a) { return [a.id, a.name]; }) });
          aField.input.addEventListener('change', function () { imp.accountId = aField.input.value; });
          var fileId = dom.id('trx-file');
          var input = h('input', { type: 'file', id: fileId, accept: '.csv,.txt,.ofx,.qfx,text/csv', class: 'trx-file' });
          var drop = h('div', { class: 'trx-drop' }, [h('p', { text: 'Drop a file here, or choose one.' }), h('label', { for: fileId, class: 'trx-label', text: 'Choose a file' }), input]);
          ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
          ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function () { drop.classList.remove('over'); }); });
          drop.addEventListener('drop', function (e) { e.preventDefault(); var f0 = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f0) take(f0); });
          input.addEventListener('change', function () { if (input.files && input.files[0]) take(input.files[0]); });
          body.appendChild(drop);
          body.appendChild(aField.el);
          if (imp.busy) body.appendChild(h('div', { class: 'trx-reading', 'aria-busy': 'true' }, [h('div', { class: 'skeleton sk-line' }),
            h('p', { class: 'fine', role: 'status', text: imp.large ? N.MESSAGES.large : 'Reading the file on this device.' })]));
          if (imp.result && fileError(imp.result)) body.appendChild(errorCard(imp.result));
          body.appendChild(h('div', { class: 'trx-actions' }, [cancelBtn()]));
        }
        function take(file) {
          imp.file = file; imp.mapping = null; imp.result = null; imp.busy = true; imp.large = false; imp.confirmed = false;
          draw();
          read();
        }
        function read() {
          IC.readFile(imp.file, { mapping: imp.mapping, onProgress: function () { imp.large = true; if (imp.step === 1) draw(); } }).then(function (res) {
            if (dead || ui.form !== form) return;
            imp.busy = false;
            imp.result = res;
            if (res.csv && res.csv.mapping) imp.mapping = res.csv.mapping;
            var fe = fileError(res);
            var mappable = res.kind === 'csv' && res.csv && (!fe || ['no-date-column', 'no-amount-column', 'no-text-column', 'bad-mapping'].indexOf(fe.code) >= 0);
            // A CSV goes to "Which column is which?" first, and back there if the chosen columns don't work.
            if (mappable && (!imp.confirmed || fe)) { imp.confirmed = false; step(2); draw(true); return; }
            if (fe) { step(1); draw(true); return; }
            check();
          });
        }
        function check() {
          var rows = N.toStoreRows(imp.result.rows);
          imp.rows = rows;
          imp.dup = rows.length ? store.findDuplicates(imp.accountId, rows) : [];
          step(3);
          draw(true);
        }

        // I2: which column is which (CSV only)
        function mapStep() {
          step(2, 'Which column is which?');
          var res = imp.result, info = res.csv, mp = info.mapping;
          var lines = res.stats.rows + res.stats.skipped;
          body.appendChild(h('p', { class: 'fine', text: (imp.file.name || 'Your file') + ' · ' + plural(lines, 'line', 'lines') }));
          // A column choice: "Column A: "Posted" · 01/10/2026"
          function colField(label, value, allowNone) {
            return K.field({ label: label, kind: 'select', value: String(value == null ? -1 : value),
              options: [['-1', allowNone ? 'None' : 'Choose a column']].concat(info.columns.map(function (c) {
                return [String(c.index), c.label + (c.samples[0] ? ' · ' + c.samples[0] : '')];
              })) });
          }
          var dateF = colField('Date', mp.date), textF = colField('Payee', mp.text && mp.text.length ? mp.text[0] : -1);
          var mode = info.moneyOut === 'column' ? 'column' : 'minus';
          var amtF = colField('Amount', mp.amount), outF = colField('Money out', mp.debit, true), inF = colField('Money in', mp.credit, true);
          var modeSeg = dom.seg('Money out shows as', [{ value: 'minus', label: 'A minus sign' }, { value: 'column', label: 'Its own column' }], mode, function (v) { mode = v; sync(); });
          var negId = dom.id('trx-neg'), neg = h('input', { type: 'checkbox', id: negId });
          neg.checked = !!mp.negate;
          function sync() { amtF.el.hidden = mode !== 'minus'; outF.el.hidden = mode === 'minus'; inF.el.hidden = mode === 'minus'; }
          var fe = fileError(res);
          if (fe) body.appendChild(h('p', { class: 'fk-formerr', role: 'status', text: fe.message }));
          body.appendChild(dateF.el);
          body.appendChild(textF.el);
          body.appendChild(h('div', { class: 'fk-field' }, [h('span', { class: 'trx-label', text: 'Money out shows as' }), modeSeg]));
          body.appendChild(amtF.el); body.appendChild(outF.el); body.appendChild(inF.el);
          body.appendChild(h('div', { class: 'trx-check-row' }, [neg, h('label', { for: negId, text: 'This file shows money out without a minus sign (flip every sign)' })]));
          sync();
          if (info.firstLine) {
            var fl = info.firstLine;
            body.appendChild(h('p', { class: 'well trx-firstline' }, ['First line: ' + [fl.date, fl.text, fl.amount].filter(Boolean).join(' · ')]));
          }
          if (info.dateNote) body.appendChild(h('p', { class: 'fine', text: info.dateNote }));
          var next = h('button', { type: 'button', class: 'btn', text: 'Next: check the lines' });
          var again = h('button', { type: 'button', class: 'btn ghost', text: 'Choose another file' });
          again.addEventListener('click', function () { imp.file = null; imp.result = null; step(1); draw(true); });
          next.addEventListener('click', function () {
            var d = Number(dateF.input.value), t = Number(textF.input.value);
            var mapping = { delimiter: mp.delimiter, hasHeader: mp.hasHeader, date: d, text: t, negate: neg.checked };
            if (mode === 'minus') mapping.amount = Number(amtF.input.value);
            else { mapping.debit = Number(outF.input.value); mapping.credit = Number(inF.input.value); }
            imp.mapping = mapping;
            imp.confirmed = true;
            imp.busy = true;
            next.disabled = true;
            body.appendChild(h('p', { class: 'fine', role: 'status', text: 'Reading the file again with these columns.' }));
            read();
          });
          body.appendChild(h('div', { class: 'trx-actions' }, [next, again, cancelBtn()]));
        }

        // I3: check before saving
        function checkStep() {
          step(3, 'Check before saving');
          var res = imp.result, ck = A.importCheck(res, imp.dup), acctName = lookups().acctName(imp.accountId);
          body.appendChild(h('p', { class: 'fine', text: (imp.file.name || 'Your file') + ' · into ' + acctName }));
          var all = N.alreadyMessage(ck.read, ck.already);
          var dl = h('dl', { class: 'trx-counts' }, [
            h('dt', { text: 'New transactions' }), h('dd', { text: String(ck.fresh) }),
            h('dt', {}, ['Already in the app', h('span', { class: 'sub', text: N.MESSAGES.alreadyHint })]), h('dd', { text: String(ck.already) }),
            h('dt', { text: 'Couldn’t read' }), h('dd', { text: String(ck.unreadable) })
          ]);
          body.appendChild(dl);
          if (ck.unreadable) {
            body.appendChild(h('ul', { class: 'trx-reasons' }, res.preview.skipped.map(function (p) { return h('li', { text: p.reason }); })));
            if (ck.unreadable > res.preview.skipped.length) body.appendChild(h('p', { class: 'fine body-note', text: 'And ' + plural(ck.unreadable - res.preview.skipped.length, 'more line', 'more lines') + '. Lines we couldn’t read are left out.' }));
          }
          res.warnings.forEach(function (w) { body.appendChild(h('p', { class: 'fine body-note', text: w.message })); });
          if (ck.already) {
            var sk = h('button', { type: 'button', class: 'linkbtn', text: 'See the ' + ck.already + ' we’ll skip' });
            var skPanel = h('div', { class: 'explainer' }, [rowsTable(res.rows.filter(function (r, i) { return imp.dup[i]; }).slice(0, 100))]);
            dom.disclosure(sk, skPanel);
            body.appendChild(sk);
            body.appendChild(skPanel);
          }
          if (ck.fresh) {
            var fresh = res.rows.filter(function (r, i) { return !imp.dup[i]; });
            body.appendChild(h('h3', { class: 'trx-subhead', text: 'The first ' + Math.min(fresh.length, 20) + ' new lines' }));
            body.appendChild(rowsTable(fresh.slice(0, 20)));
          }
          if (all) body.appendChild(h('p', { class: 'trx-body', role: 'status', text: all }));
          var save = h('button', { type: 'button', class: 'btn', text: 'Save ' + ck.fresh });
          save.disabled = !ck.fresh;
          var back = h('button', { type: 'button', class: 'btn ghost', text: res.kind === 'csv' ? 'Back to the columns' : 'Choose another file' });
          back.addEventListener('click', function () { if (res.kind === 'csv') { step(2); } else { imp.file = null; imp.result = null; step(1); } draw(true); });
          save.addEventListener('click', function () {
            if (ui.saving) return;
            save.disabled = true;
            ui.saving = true;
            var rows = imp.rows.filter(function (r, i) { return !imp.dup[i]; });
            store.addImportBatch(rows, { accountId: imp.accountId, format: A.importFormat(res.kind, imp.file.name), fileName: S.clip ? S.clip(imp.file.name || '', 'fileName') : String(imp.file.name || '').slice(0, 80) }).then(function (out) {
              ui.saving = false;
              imp.saved = { importId: out.importId, added: out.added, ck: ck, acctName: acctName };
              step(4);
              draw(true);
            }, function (e) {
              ui.saving = false;
              save.disabled = false;
              var msg = e && e.message ? e.message : 'That couldn’t be saved. Nothing changed.';
              if (e && e.errors && e.errors.length && typeof e.errors[0].index === 'number') msg += ' (' + e.errors[0].message + ')';
              form.top.textContent = msg + ' Nothing on this device has changed.';
              form.top.hidden = false;
              form.top.focus();
            });
          });
          body.appendChild(h('p', { class: 'fine', text: N.MESSAGES.nothingSaved }));
          body.appendChild(h('div', { class: 'trx-actions' }, [save, back, cancelBtn()]));
        }
        function rowsTable(rows) {
          return h('div', { class: 'tablewrap' }, h('table', { class: 'numtable trx-preview' }, [
            h('thead', {}, h('tr', {}, [h('th', { scope: 'col', text: 'Date' }), h('th', { scope: 'col', text: 'Payee' }), h('th', { scope: 'col', text: 'Amount' })])),
            h('tbody', {}, rows.map(function (r) {
              return h('tr', {}, [h('td', { text: C.dayLong(r.date) }), h('td', { class: 'trx-pv-payee', text: r.text }), h('td', {}, dom.moneyCents(Math.round(r.amount * 100), { sign: true }))]);
            }))
          ]));
        }

        // I4: done
        function doneStep() {
          var sv = imp.saved, ck = sv.ck, st = imp.result.stats;
          step(4, plural(sv.added, 'transaction', 'transactions') + ' added');
          var range = st.dateFrom && st.dateTo ? ', ' + C.dayShort(st.dateFrom) + (st.dateFrom !== st.dateTo ? ' to ' + C.dayShort(st.dateTo) : '') : '';
          var bits = [];
          if (ck.already) bits.push(plural(ck.already, 'was', 'were') + ' already here');
          if (ck.unreadable) bits.push(plural(ck.unreadable, 'line was', 'lines were') + ' left out');
          body.appendChild(h('p', { class: 'trx-body', text: 'To ' + sv.acctName + range + '.' + (bits.length ? ' ' + bits.join(' and ') + '.' : '') }));
          body.appendChild(h('p', { class: 'fine', text: 'Your rules set the category of every new line they match.' }));
          var see = h('button', { type: 'button', class: 'btn', text: 'See transactions' });
          var undo = h('button', { type: 'button', class: 'btn fk-danger', text: 'Undo this import' });
          see.addEventListener('click', function () { keep.importId = sv.importId; keep.month = ''; keep.query = ''; keep.categoryId = ''; keep.accountId = ''; closeForm(); var hd = wrap.querySelector('#trx-h'); if (hd) hd.focus(); });
          undo.addEventListener('click', function () {
            var log = store.get('imports', sv.importId);
            if (log) openUndoImport(log, 'import'); else closeForm('import');
          });
          body.appendChild(h('div', { class: 'trx-actions' }, [see, undo]));
        }
      }
    }
  });
})();
