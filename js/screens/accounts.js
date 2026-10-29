/* Accounts: every account the reader added, grouped by type, with its
   balance entries. Add, edit and delete accounts and balances here; every
   total comes from the calculation module, every money figure through the
   shared money helper (so "Hide amounts" shows dots), every record from the
   on-device store. The screen repaints itself after a store change, so open
   panels, focus and a half-filled form survive a save. */
(function () {
  'use strict';
  var SW = window.SW;

  // Kept between renders (the shell renders again when Hide amounts changes).
  var keep = { open: {}, filter: 'all', flash: null };
  var UNDO_MS = 8000;

  SW.screens.register('accounts', {
    render: function (wrap, ctx) {
      var store = ctx.store, dom = ctx.dom, h = dom.h, C = ctx.calc, S = window.SWSchema, A = window.SWEngA, F = SW.fmt, K = SW.formKit;
      var ui = { form: null, saving: false, stale: false };
      var timers = [], charts = [], dead = false;
      function m(cents, opts, cls) { return dom.moneyCents(cents, opts, cls); }

      paint();
      return {
        // Every change repaints every figure (Hide amounts included). An open
        // form is the same element put back, so what the reader typed stays.
        onStoreChange: function () { repaintKeepingForm(); return true; },
        destroy: function () { dead = true; timers.forEach(clearTimeout); charts.forEach(function (c) { c.destroy(); }); }
      };

      // ---------- Paint the whole screen from the store ----------
      function paint(focusKey) {
        if (dead) return;
        charts.forEach(function (c) { c.destroy(); });
        charts = [];
        ui.stale = false;
        var st = store.status();
        dom.clear(wrap);
        wrap.appendChild(ctx.app.screenHeader(ctx.route, { eyebrow: st.hasSample ? 'Sample data' : '' }));
        if (st.locked) return;
        var accounts = store.list('accounts'), balances = store.list('balances');
        var today = store.today(), idx = C.balanceIndex(balances);
        var note = flashNote();
        if (note) wrap.appendChild(note);
        if (ui.form) wrap.appendChild(ui.form.el);
        if (!accounts.length) {
          if (!ui.form) wrap.appendChild(emptyCard(st));
        } else {
          var main = h('div', { class: 'acs-col' }), side = h('div', { class: 'acs-col' });
          wrap.appendChild(h('div', { class: 'acs-grid' }, [main, side]));
          side.appendChild(summaryCard(accounts, idx, today));
          main.appendChild(listCard(accounts, balances, idx, today));
          side.appendChild(sourceCard());
        }
        if (focusKey) {
          var t = wrap.querySelector('[data-focus="' + focusKey + '"]');
          if (t) t.focus();
        }
      }

      // Repaint after a store change: the open form goes back in as it was,
      // focus returns to where it was, and filled money fields follow Hide
      // amounts (dots while it is on, the typed figure when it is off).
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
          if (keep.flash && Date.now() >= keep.flash.until) { keep.flash = null; var n = wrap.querySelector('.acs-flash'); if (n) n.remove(); }
        }, UNDO_MS + 50));
      }
      function flashNote() {
        var f = keep.flash;
        if (!f || Date.now() >= f.until) { keep.flash = null; return null; }
        // The shared saved note (it has its own solid surface).
        var note = K.savedNote(f.text, f.undo ? function () {
          var fn = f.undo;
          keep.flash = null;
          ui.saving = true;
          fn().then(function () {
            ui.saving = false;
            setFlash('Undone. Net worth is up to date.');
            paint('flash');
          }, function (e) {
            ui.saving = false;
            setFlash(e && e.message ? e.message : 'That couldn’t be undone.');
            paint('flash');
          });
        } : null);
        note.setAttribute('tabindex', '-1');
        note.setAttribute('data-focus', 'flash');
        note.classList.add('acs-flash');
        return note;
      }

      // ---------- Empty state ----------
      function emptyCard(st) {
        var add = h('button', { type: 'button', class: 'btn', text: 'Add an account', 'data-focus': 'add' });
        add.addEventListener('click', function () { openAccountForm(null); });
        var kids = [
          h('h2', { id: 'acs-empty-h', text: 'No accounts yet' }),
          h('p', { class: 'acs-body', text: 'Add each account with the balance your bank shows, and its date. Your net worth is the sum of what you add. Everything stays on this device.' }),
          h('div', { class: 'acs-actions' }, [add])
        ];
        if (st.canLoadSample) {
          var sample = h('button', { type: 'button', class: 'btn quiet', text: 'Look around with sample data' });
          sample.addEventListener('click', function () {
            sample.disabled = true;
            store.loadSample().then(function () { paint(); }, function (e) { sample.disabled = false; ctx.app.announce(e.message); });
          });
          kids[2].appendChild(sample);
          kids.push(h('p', { class: 'fine body-note', text: 'Sample data is a made-up household. You can remove it in one step, and it never mixes with what you add.' }));
        }
        return h('section', { class: 'card acs-empty', 'aria-labelledby': 'acs-empty-h' }, kids);
      }

      // ---------- Net worth and its parts ----------
      function summaryCard(accounts, idx, today) {
        var t = C.totalsOn(accounts, idx, today), prev = A.previousMonthEnd(C, today), since = C.dayShort(prev);
        var card = h('section', { class: 'card acs-sum', 'aria-labelledby': 'acs-sum-h' });
        card.appendChild(h('p', { class: 'eyebrow', id: 'acs-sum-h', text: 'Net worth, ' + C.dayLong(today) }));
        card.appendChild(h('p', { class: 'acs-big' }, m(t.netCents)));
        card.appendChild(h('p', { class: 'acs-eq' }, ['Assets ', m(t.assetsCents), ' minus debts ', m(t.debtsCents), ' = ', m(t.netCents)]));

        var partsBtn = h('button', { type: 'button', class: 'explain', text: 'What makes this up?' });
        var partsPanel = h('div', { class: 'explainer' }, [h('h3', { text: 'What makes up net worth' })].concat(
          S.GROUPS.filter(function (g) { return t.groups[g.id].accounts.length; }).map(function (g) {
            return h('div', { class: 'li' }, [
              h('span', { class: 'acs-gname' }, [swatch(g), g.name + (g.kind === 'debt' ? ', owed' : '')]),
              h('span', { class: 'amt' }, m(t.groups[g.id].cents))
            ]);
          })).concat([h('p', { class: 'fine', text: 'Each type adds up its accounts, listed on this screen. What you owe counts as minus.' })]));
        dom.disclosure(partsBtn, partsPanel);
        var btns = h('div', { class: 'chips acs-btns' }, [partsBtn]);

        var panels = [partsPanel];
        if (C.hasBalanceOn(accounts, idx, prev)) {
          var ch = C.changeBetweenDates(accounts, idx, prev, today);
          var word = ch.amountCents > 0 ? 'Up ' : ch.amountCents < 0 ? 'Down ' : 'No change';
          card.appendChild(h('p', { class: 'acs-delta' }, ch.amountCents === 0 ? ['No change since ' + since] :
            [word, m(Math.abs(ch.amountCents)), (ch.pct !== null ? ' · ' + Math.abs(ch.pct).toFixed(1) + '%' : '') + ' since ' + since]));
          var chBtn = h('button', { type: 'button', class: 'explain', text: 'What changed?' });
          var chPanel = h('div', { class: 'explainer' }, [
            h('h3', { text: 'What changed since ' + since }),
            ch.items.length ? h('div', {}, ch.items.map(function (it) {
              var sub = it.debt ? (it.toCents < it.fromCents ? 'You owe less' : 'You owe more') : '';
              return h('div', { class: 'li' }, [h('span', {}, [it.name, sub ? h('span', { class: 'sub', text: sub }) : null]),
                h('span', { class: 'amt' }, m(it.changeCents, { sign: true }))]);
            })) : h('p', { text: 'No balance changed.' }),
            h('p', { class: 'fine' }, ['Total: ', m(ch.itemsTotalCents, { sign: true }), '. Each line is the change in a balance you entered, from ' + since + ' to ' + C.dayShort(today) + '.'])
          ]);
          dom.disclosure(chBtn, chPanel);
          btns.appendChild(chBtn);
          panels.push(chPanel);
        }
        card.appendChild(btns);
        panels.forEach(function (p) { card.appendChild(p); });
        card.appendChild(h('p', { class: 'note', text: 'Sums of the balances you entered, on ' + C.dayLong(today) + '. For education only, not financial advice.' }));
        return card;
      }

      function sourceCard() {
        return h('section', { class: 'card acs-src', 'aria-labelledby': 'acs-src-h' }, [
          h('h2', { id: 'acs-src-h', text: 'Where these numbers come from' }),
          h('p', { class: 'acs-body', text: 'Every balance here is one you entered, with its date. An account’s balance today is its latest entry on or before today. Nothing is linked to a bank.' }),
          h('p', { class: 'acs-body', text: 'Your numbers are kept on this device only. A balance you enter does not change by itself when you add a line in Transactions.' })
        ]);
      }

      function swatch(g) { return h('span', { class: 'sw bg-' + g.token + (g.kind === 'debt' ? ' hatch' : ''), 'aria-hidden': 'true' }); }

      // ---------- Accounts by type ----------
      function listCard(accounts, balances, idx, today) {
        var t = C.totalsOn(accounts, idx, today), prev = A.previousMonthEnd(C, today);
        var card = h('section', { class: 'card acs-list', 'aria-labelledby': 'acs-list-h' });
        var add = h('button', { type: 'button', class: 'btn small', text: 'Add account', 'data-focus': 'add' });
        add.addEventListener('click', function () { openAccountForm(null); });
        var sections = [];
        var filter = dom.seg('Show', [{ value: 'all', label: 'All' }, { value: 'asset', label: 'Assets' }, { value: 'debt', label: 'Debts' }], keep.filter, function (v) {
          keep.filter = v;
          sections.forEach(function (s) { s.el.hidden = v !== 'all' && s.kind !== v; });
        });
        card.appendChild(h('div', { class: 'card-h' }, [h('h2', { id: 'acs-list-h', text: 'Accounts by type' }), h('div', { class: 'acs-tools' }, [filter, add])]));
        card.appendChild(h('p', { class: 'fine body-note acs-count', text: accounts.length + (accounts.length === 1 ? ' account' : ' accounts') + '. Select one to see its balances, add a new one, or edit it.' }));

        S.GROUPS.forEach(function (g) {
          var grp = t.groups[g.id];
          if (!grp.accounts.length) return;
          var sec = h('section', { class: 'acs-group', 'aria-labelledby': 'acs-g-' + g.id });
          sec.hidden = keep.filter !== 'all' && keep.filter !== g.kind;
          sec.appendChild(h('h3', { class: 'acs-ghead', id: 'acs-g-' + g.id }, [
            h('span', { class: 'acs-gname' }, [swatch(g), h('span', { class: 'tx-' + g.token, text: g.name }),
              h('span', { class: 'acs-gcount', text: grp.accounts.length + (grp.accounts.length === 1 ? ' account' : ' accounts') })]),
            h('span', { class: 'acs-gtotal' }, [h('span', { class: 'sr-only', text: g.kind === 'debt' ? 'Total owed ' : 'Total ' }), m(grp.cents)])
          ]));
          var ul = h('ul', { class: 'acs-accts', role: 'list' });
          grp.accounts.forEach(function (row) { ul.appendChild(accountRow(row, g, balances, idx, today, prev)); });
          sec.appendChild(ul);
          if (grp.accounts.length > 1) {
            var parts = [g.name + ': '];
            grp.accounts.forEach(function (row, i) { if (i) parts.push(' + '); parts.push(m(row.cents)); });
            parts.push(' = ', m(grp.cents), g.kind === 'debt' ? ' owed' : '');
            sec.appendChild(h('p', { class: 'fine acs-gsum' }, parts));
          }
          card.appendChild(sec);
          sections.push({ el: sec, kind: g.kind });
        });
        card.appendChild(h('p', { class: 'note body-note', text: 'Each type’s total adds up the balances listed under it, on ' + C.dayLong(today) + '. Changes compare each balance with ' + C.dayShort(prev) + '. For education only, not financial advice.' }));
        return card;
      }

      function typeText(a) {
        var label = S.ACCOUNT_TYPES[a.type] ? S.ACCOUNT_TYPES[a.type].label : a.type;
        // Leave out "ending 4021" when the name already says it.
        return label + (a.last4 && a.name.indexOf(a.last4) < 0 ? ' ending ' + a.last4 : '');
      }

      function moveLine(a, idx, prev) {
        var mv = A.accountMove(C, a, idx, prev, store.today()), since = C.dayShort(prev);
        if (mv.kind === 'none') return h('span', { class: 'acs-chg', text: 'No change since ' + since });
        if (mv.kind === 'new') return h('span', { class: 'acs-chg', text: 'First balance ' + C.dayShort(mv.firstDate) });
        if (mv.kind === 'more' || mv.kind === 'less') return h('span', { class: 'acs-chg' }, ['You owe ', m(mv.cents), ' ' + mv.kind + ' than on ' + since]);
        return h('span', { class: 'acs-chg' }, [(mv.kind === 'up' ? 'Up ' : 'Down '), m(mv.cents), ' since ' + since]);
      }

      function accountRow(row, g, balances, idx, today, prev) {
        var a = row.account, li = h('li', { class: 'acs-acct' });
        var series = A.accountSeries(C, a, idx, today, 13);
        var sub = row.entry ? 'Balance from ' + C.dayLong(row.entry.date) : 'No balance yet';
        var btn = h('button', { type: 'button', class: 'acs-row', 'data-focus': 'row-' + a.id }, [
          h('span', { class: 'acs-ico tint-' + g.token, 'aria-hidden': 'true', text: g.abbr }),
          h('span', { class: 'acs-name' }, [h('span', { class: 'acs-title', text: a.name }), h('span', { class: 'sub', text: typeText(a) + ' · ' + sub })]),
          h('span', { class: 'acs-spark', 'aria-hidden': 'true' }, series.length > 1 ?
            ctx.charts.sparkline(series.map(function (s) { return g.kind === 'debt' ? -s.cents : s.cents; }), { width: 72, height: 26, cls: 's-' + g.token, dotCls: 'f-' + g.token }) : null),
          row.entry ? m(row.cents, null, 'acs-amt') : h('span', { class: 'acs-amt muted', text: 'No balance' }),
          row.entry ? moveLine(a, idx, prev) : h('span', { class: 'acs-chg', text: 'Add one to count it' })
        ]);
        if (g.kind === 'debt' && row.entry) btn.querySelector('.acs-amt').appendChild(h('span', { class: 'sr-only', text: ' owed' }));
        var panel = h('div', { class: 'acs-detail' });
        dom.disclosure(btn, panel, function () { keep.open[a.id] = true; });
        btn.addEventListener('click', function () { if (btn.getAttribute('aria-expanded') !== 'true') delete keep.open[a.id]; });
        detail(panel, a, g, balances, series, today);
        if (keep.open[a.id]) { btn.setAttribute('aria-expanded', 'true'); panel.hidden = false; }
        li.appendChild(btn);
        li.appendChild(panel);
        return li;
      }

      // ---------- One account in detail ----------
      function detail(panel, a, g, balances, series, today) {
        var debt = g.kind === 'debt', entries = A.entriesFor(balances, a.id);
        if (series.length > 1) {
          var host = h('div', { class: 'chart-host acs-chart' });
          var readout = h('p', { class: 'acs-readout', 'aria-live': 'polite' });
          var setReadout = function (i) {
            var s = series[i];
            dom.clear(readout);
            readout.appendChild(h('b', { text: C.monthLong(s.month) + (s.date === today ? ', today' : ', month end') + ': ' }));
            readout.appendChild(m(s.cents));
            if (debt) readout.appendChild(document.createTextNode(' owed'));
            readout.appendChild(document.createTextNode(' (your entry from ' + C.dayShort(s.entry.date) + ')'));
          };
          panel.appendChild(h('h4', { text: 'Balance at the end of each month' }));
          panel.appendChild(host);
          panel.appendChild(readout);
          panel.appendChild(h('ul', { class: 'legend', 'aria-label': 'Chart key' }, [
            h('li', {}, [swatch(g), a.name + (debt ? ', owed, drawn below zero' : '')])
          ]));
          // The chart is drawn when the panel is first shown, at its real width.
          charts.push(balanceChart(host, a, g, series, setReadout));
          setReadout(series.length - 1);
        }

        // Entries
        var shown = entries.slice(0, 12);
        var tbody = h('tbody', {}, shown.map(function (e) { return entryRow(e, a, debt); }));
        panel.appendChild(h('h4', { text: debt ? 'Amounts owed you entered' : 'Balances you entered' }));
        if (entries.length) {
          panel.appendChild(h('div', { class: 'tablewrap' }, h('table', { class: 'numtable acs-entries' }, [
            h('caption', { class: 'sr-only', text: a.name + ', balance entries, newest first' }),
            h('thead', {}, h('tr', {}, [h('th', { scope: 'col', text: 'Date' }), h('th', { scope: 'col', text: debt ? 'Owed' : 'Balance' }),
              h('th', { scope: 'col', text: 'From' }), h('th', { scope: 'col' }, h('span', { class: 'sr-only', text: 'Actions' }))])),
            tbody
          ])));
          if (entries.length > shown.length) {
            var more = h('button', { type: 'button', class: 'linkbtn', text: 'Show all ' + entries.length + ' entries' });
            more.addEventListener('click', function () {
              entries.slice(shown.length).forEach(function (e) { tbody.appendChild(entryRow(e, a, debt)); });
              more.remove();
            });
            panel.appendChild(more);
          }
        } else {
          panel.appendChild(h('p', { class: 'fine body-note', text: 'No balance yet, so this account counts as $0.00. Add the balance your bank shows.' }));
        }

        var n = store.query('transactions', { accountId: a.id }).length;
        panel.appendChild(h('div', { class: 'well acs-where' }, [
          h('h4', { text: 'Where this number comes from' }),
          // The entry that counts today: the latest one on or before today (entries are newest first).
          (function () {
            var cur = entries.filter(function (e) { return e.date <= today; })[0];
            if (cur) return h('p', { text: 'The balance today is your entry from ' + C.dayLong(cur.date) + '. It is kept on this device only.' });
            if (entries.length) return h('p', { text: 'Every entry is dated after today, so today this account counts as ' + F.money(0) + '.' });
            return h('p', { text: 'There is no entry yet.' });
          })(),
          g.id === 'property' ? h('p', { text: 'A value you enter for property is your own estimate, not a price from anywhere else.' }) : null,
          debt ? h('p', { text: 'You enter what you owe. It counts as minus in net worth.' }) : null,
          n ? h('p', {}, [n + (n === 1 ? ' line uses' : ' lines use') + ' this account. A balance you enter doesn’t change when a line is added. ',
            h('a', { href: '#/transactions?account=' + encodeURIComponent(a.id), text: 'See ' + (n === 1 ? 'it' : 'them') + ' in Transactions' })]) : null
        ]));

        var addBal = h('button', { type: 'button', class: 'btn small', text: debt ? 'Add amount owed' : 'Add a balance', 'data-focus': 'addbal-' + a.id });
        var edit = h('button', { type: 'button', class: 'btn small quiet', text: 'Edit account', 'data-focus': 'edit-' + a.id });
        var del = h('button', { type: 'button', class: 'btn small fk-danger', text: 'Delete account', 'data-focus': 'del-' + a.id });
        addBal.addEventListener('click', function () { openBalanceForm(a, null); });
        edit.addEventListener('click', function () { openAccountForm(a); });
        del.addEventListener('click', function () { openDeleteSheet(a); });
        panel.appendChild(h('div', { class: 'acs-actions' }, [addBal, edit, del]));
      }

      function entryRow(e, a, debt) {
        var src = e.source === 'import' ? 'Imported' : e.source === 'sample' ? 'Sample' : 'You';
        var ed = h('button', { type: 'button', class: 'linkbtn', text: 'Edit', 'data-focus': 'bal-' + e.id, 'aria-label': 'Edit the entry from ' + C.dayLong(e.date) });
        var rm = h('button', { type: 'button', class: 'linkbtn', text: 'Delete', 'aria-label': 'Delete the entry from ' + C.dayLong(e.date) });
        ed.addEventListener('click', function () { openBalanceForm(a, e); });
        rm.addEventListener('click', function () { deleteEntry(a, e); });
        return h('tr', {}, [h('th', { scope: 'row', text: C.dayLong(e.date) }), h('td', {}, m(e.cents)), h('td', { text: src }),
          h('td', { class: 'acs-entry-acts' }, [ed, rm])]);
      }

      // ---------- Forms: the shared form kit (labels above, ink errors under each field) ----------
      // A short text field with a fixed character limit (last four, percents).
      function shortField(o) {
        var f = K.field({ label: o.label, kind: 'text', cap: 'name', value: o.value, hint: o.hint, optional: o.optional });
        f.input.maxLength = o.max;
        f.input.inputMode = o.inputmode;
        f.input.spellcheck = false;
        return f;
      }
      function dateField(label, value) {
        var f = K.field({ label: label, kind: 'date', value: value });
        f.input.min = '1900-01-01';
        f.input.max = '2100-12-31';
        return f;
      }
      function topError() { var p = h('p', { class: 'fk-formerr', tabindex: '-1' }); p.hidden = true; return p; }
      function clearErrors(form) { Object.keys(form.fields).forEach(function (k) { form.fields[k].clear(); }); form.top.hidden = true; form.top.textContent = ''; }
      function sheet(title, kids, onCancel) {
        var hid = dom.id('acs-sheet');
        var el = h('section', { class: 'card acs-sheet', role: 'region', 'aria-labelledby': hid }, [h('h2', { id: hid, tabindex: '-1', text: title })].concat(kids));
        el.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } });
        return el;
      }
      function closeForm(focusKey) {
        ui.form = null;
        paint(focusKey);
      }
      function showForm(form) {
        ui.form = form;
        paint();
        window.scrollTo(0, 0);
        var t = form.el.querySelector('h2');
        if (t) t.focus();
      }
      // A refusal (the store's, or this form's own checks in the same shape)
      // goes under its fields, or at the top; focus moves to the first error.
      function showErrors(form, e) {
        var hit = K.showErrors(e, form.fields, null);
        var rest = ((e && e.errors) || []).filter(function (x) { return !form.fields[x.field]; }).map(function (x) { return x.message; });
        if (!hit && !rest.length) rest = [(e && e.message) || 'That couldn’t be saved. Nothing has changed.'];
        if (rest.length) { form.top.hidden = false; form.top.textContent = rest.join(' '); }
        K.focusFirstError(form.el);
      }

      // Account types, named with their group: "Checking (cash)".
      function typeField(value) {
        var opts = [];
        S.GROUPS.forEach(function (g) {
          Object.keys(S.ACCOUNT_TYPES).forEach(function (k) {
            if (S.ACCOUNT_TYPES[k].group === g.id) opts.push([k, S.ACCOUNT_TYPES[k].label + (S.ACCOUNT_TYPES[k].label === g.name ? '' : ' (' + g.name.toLowerCase() + ')')]);
          });
        });
        return K.field({ label: 'Type', kind: 'select', value: value || 'checking', options: opts });
      }

      function openAccountForm(a) {
        var editing = !!a, today = store.today();
        var f = {
          name: K.field({ label: 'Account name', kind: 'text', cap: 'name', value: a ? a.name : '', hint: 'A name you’ll know it by, like “Everyday checking”.' }),
          type: typeField(a ? a.type : 'checking'),
          last4: shortField({ label: 'Last four digits', optional: true, max: 8, inputmode: 'numeric', value: a ? a.last4 : '', hint: 'Only the last 4, so the full number is never stored.' }),
          aprBps: shortField({ label: 'Interest rate, APR %', optional: true, max: 8, inputmode: 'decimal', value: a ? A.bpsText(a.aprBps) : '', hint: 'As your statement shows it, like 22.9.' }),
          fundCostBps: shortField({ label: 'Fund cost, % a year', optional: true, max: 8, inputmode: 'decimal', value: a ? A.bpsText(a.fundCostBps) : '', hint: 'The expense ratio your provider lists, like 0.2.' })
        };
        if (!editing) {
          f.cents = K.field({ label: 'Balance', kind: 'money', optional: true, hint: 'As your bank shows it.' });
          f.date = dateField('As of', today);
        }
        var currency = h('p', { class: 'fine', text: 'Currency: US dollar.' });
        function syncType() {
          var t = f.type.input.value, debt = S.ACCOUNT_TYPES[t].debt, inv = S.ACCOUNT_TYPES[t].group === 'invest';
          f.aprBps.el.hidden = !debt;
          f.fundCostBps.el.hidden = !inv;
          if (f.cents) {
            f.cents.el.querySelector('label').textContent = debt ? 'Amount you owe (optional)' : 'Balance (optional)';
            f.cents.el.querySelector('.fk-hint').textContent = debt ? 'What you owe, as your bank shows it. A minus sign is fine.' : 'As your bank shows it. Use a minus sign if it’s overdrawn.';
          }
        }
        f.type.input.addEventListener('change', syncType);
        var top = topError();
        var save = h('button', { type: 'button', class: 'btn', text: editing ? 'Save changes' : 'Save account' });
        var cancel = h('button', { type: 'button', class: 'btn ghost', text: 'Cancel' });
        var back = editing ? 'edit-' + a.id : 'add';
        var form = { fields: f, top: top };
        cancel.addEventListener('click', function () { closeForm(back); });
        form.el = sheet(editing ? 'Edit “' + a.name + '”' : 'Add an account',
          [top].concat(Object.keys(f).map(function (k) { return f[k].el; })).concat([currency, h('div', { class: 'acs-actions' }, [save, cancel])]),
          function () { closeForm(back); });
        syncType();
        save.addEventListener('click', function () { submit(); });
        form.el.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); submit(); } });

        function submit() {
          if (ui.saving) return;
          clearErrors(form);
          var t = f.type.input.value, ty = S.ACCOUNT_TYPES[t], errs = [];
          var name = f.name.input.value.trim();
          if (!name) errs.push({ field: 'name', message: 'Enter a name for the account.' });
          var l4 = A.lastFourMessage(f.last4.input.value);
          if (l4) errs.push({ field: 'last4', message: l4 });
          var apr = ty.debt ? A.parsePercentBps(f.aprBps.input.value, 10000) : { ok: true, bps: null };
          if (!apr.ok) errs.push({ field: 'aprBps', message: apr.message });
          var fund = ty.group === 'invest' ? A.parsePercentBps(f.fundCostBps.input.value, 1000) : { ok: true, bps: null };
          if (!fund.ok) errs.push({ field: 'fundCostBps', message: fund.message });
          var cents = null;
          if (f.cents) {
            // Read through the kit, so a figure hidden by Hide amounts still counts.
            var r = f.cents.money();
            if (!r.ok) errs.push({ field: 'cents', message: r.message });
            else if (r.cents !== null) {
              cents = ty.debt ? Math.abs(r.cents) : r.cents;
              if (!f.date.input.value) errs.push({ field: 'date', message: 'Enter the date of this balance.' });
            }
          }
          if (errs.length) { showErrors(form, { errors: errs }); return; }
          var draft = { name: name, type: t, last4: f.last4.input.value.trim(), aprBps: apr.bps, fundCostBps: fund.bps };
          ui.saving = true;
          save.disabled = true;
          var job;
          if (editing) {
            var before = { name: a.name, type: a.type, last4: a.last4, aprBps: a.aprBps, fundCostBps: a.fundCostBps };
            job = store.update('accounts', a.id, draft).then(function () {
              setFlash('Saved. Net worth is up to date.', function () { return store.update('accounts', a.id, before); });
              return 'row-' + a.id;
            });
          } else {
            job = store.add('accounts', draft).then(function (acct) {
              var undo = function () { return store.delete('accounts', acct.id); };
              if (cents === null) { setFlash('Saved. Add a balance when you have one.', undo); keep.open[acct.id] = true; return 'row-' + acct.id; }
              return store.add('balances', { accountId: acct.id, date: f.date.input.value, cents: cents }).then(function () {
                setFlash('Saved. Net worth is up to date.', undo);
                return 'flash';
              }, function (e) {
                // Keep it all or nothing: take the account back out, then show why.
                return store.delete('accounts', acct.id).then(function () { throw e; });
              });
            });
          }
          job.then(function (focusKey) {
            ui.saving = false;
            ui.form = null;
            paint(focusKey);
          }, function (e) {
            ui.saving = false;
            save.disabled = false;
            showErrors(form, e);
          });
        }
        showForm(form);
      }
      function openBalanceForm(a, entry) {
        var debt = S.ACCOUNT_TYPES[a.type].debt, editing = !!entry;
        var f = {
          cents: K.field({ label: debt ? 'Amount you owe' : 'Balance', kind: 'money', value: entry ? entry.cents : null,
            hint: debt ? 'What you owe, as your bank shows it. A minus sign is fine.' : 'As your bank shows it. Use a minus sign if it’s overdrawn.' }),
          date: dateField('As of', entry ? entry.date : store.today())
        };
        var top = topError();
        var save = h('button', { type: 'button', class: 'btn', text: editing ? 'Save changes' : 'Save balance' });
        var cancel = h('button', { type: 'button', class: 'btn ghost', text: 'Cancel' });
        var back = editing ? 'bal-' + entry.id : 'addbal-' + a.id;
        var form = { fields: f, top: top };
        cancel.addEventListener('click', function () { closeForm(back); });
        form.el = sheet((editing ? 'Edit an entry for “' : 'Add a balance for “') + a.name + '”',
          [top, f.cents.el, f.date.el, h('p', { class: 'fine body-note', text: 'Each entry is the balance on its date. The latest one on or before a day counts for that day.' }),
            h('div', { class: 'acs-actions' }, [save, cancel])], function () { closeForm(back); });
        save.addEventListener('click', submit);
        form.el.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); submit(); } });
        function submit() {
          if (ui.saving) return;
          clearErrors(form);
          var r = f.cents.money(), errs = [];
          if (!r.ok) errs.push({ field: 'cents', message: r.message });
          if (!f.date.input.value) errs.push({ field: 'date', message: 'Enter the date of this balance.' });
          if (errs.length) { showErrors(form, { errors: errs }); return; }
          var cents = debt ? Math.abs(r.cents) : r.cents, date = f.date.input.value;
          ui.saving = true;
          save.disabled = true;
          keep.open[a.id] = true;
          var job = editing
            ? store.update('balances', entry.id, { cents: cents, date: date }).then(function () {
              setFlash('Saved. Net worth is up to date.', function () { return store.update('balances', entry.id, { cents: entry.cents, date: entry.date }); });
            })
            : store.add('balances', { accountId: a.id, date: date, cents: cents }).then(function (b) {
              setFlash('Saved. Net worth is up to date.', function () { return store.delete('balances', b.id); });
            });
          job.then(function () { ui.saving = false; ui.form = null; paint('flash'); },
            function (e) { ui.saving = false; save.disabled = false; showErrors(form, e); });
        }
        showForm(form);
      }

      function deleteEntry(a, e) {
        ui.saving = true;
        keep.open[a.id] = true;
        var copy = { accountId: e.accountId, date: e.date, cents: e.cents };
        store.delete('balances', e.id).then(function () {
          ui.saving = false;
          setFlash('Entry from ' + C.dayLong(e.date) + ' deleted. Net worth is up to date.', function () { return store.add('balances', copy); });
          paint('flash');
        }, function (err) { ui.saving = false; setFlash(err.message); paint('flash'); });
      }

      // ---------- Delete an account: confirm with what else goes ----------
      function openDeleteSheet(a) {
        var dep = store.dependents('accounts', a.id), rem = dep.removed || {}, chg = dep.changed || {};
        var nb = rem.balances || 0, nt = rem.transactions || 0, parts = [];
        if (nb) parts.push(nb + (nb === 1 ? ' balance entry' : ' balance entries'));
        if (nt) parts.push(nt + (nt === 1 ? ' transaction' : ' transactions'));
        var also = [];
        if (chg.bills) also.push(chg.bills + (chg.bills === 1 ? ' bill keeps its details but loses' : ' bills keep their details but lose') + ' the link to this account.');
        if (chg.imports) also.push((chg.imports === 1 ? 'One import in the log loses' : chg.imports + ' imports in the log lose') + ' the link to this account.');
        var back = 'del-' + a.id, top = topError();
        var form = { fields: {}, top: top };
        var cb = K.confirmBox({
          title: 'Delete “' + a.name + '”?',
          text: 'This removes the account' + (parts.length ? ' and its ' + parts.join(' and ') : '') + ' from this device. Your other accounts stay as they are. ' +
            (also.length ? also.join(' ') + ' ' : '') + 'You can’t undo this unless you have a backup.',
          yes: 'Delete account', no: 'Keep it',
          onNo: function () { closeForm(back); },
          onYes: function () {
            if (ui.saving) return;
            ui.saving = true;
            store.delete('accounts', a.id).then(function () {
              ui.saving = false;
              delete keep.open[a.id];
              setFlash('“' + a.name + '” deleted. Net worth is up to date.');
              ui.form = null;
              paint('flash');
            }, function (e) { ui.saving = false; showErrors(form, e); });
          }
        });
        form.el = h('section', { class: 'card acs-sheet acs-confirm' }, [top, cb.el]);
        showForm(form);
        cb.focus();
      }

      // ---------- Monthly balance bars. Debts sit below zero, hatched, never red ----------
      function balanceChart(host, a, g, series, onSelect) {
        var debt = g.kind === 'debt', vals = series.map(function (s) { return debt ? -s.cents : s.cents; });
        var n = vals.length, sel = n - 1, svg = null, cols = [];
        var s = dom.s, pid = dom.id('acs-h');
        function draw(W) {
          var H = W < 480 ? 180 : 200, L = 56, R = 6, T = 10, B = 26;
          var ax = A.niceAxis(Math.min.apply(null, vals) / 100, Math.max.apply(null, vals) / 100, W < 480 ? 3 : 4);
          var top = ax.top * 100, bot = ax.bot * 100, step = ax.step * 100;
          var y = function (v) { return T + (top - v) / (top - bot) * (H - T - B); };
          var cw = (W - L - R) / n, bw = Math.min(cw * 0.6, 30);
          var label = a.name + (debt ? ', amount owed' : ', balance') + ' at the end of each month, ' + C.monthLong(series[0].month) + ' to ' + C.monthLong(series[n - 1].month) +
            ': from ' + F.money(series[0].cents) + ' to ' + F.money(series[n - 1].cents) + '. Use the arrow keys to read each month.';
          var next = s('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', tabindex: '0', class: 'chart', 'aria-label': label });
          if (debt) {
            var defs = s('defs'), p = s('pattern', { id: pid, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
            p.appendChild(s('rect', { width: 6, height: 6, class: 'f-' + g.token, opacity: '.35' }));
            p.appendChild(s('rect', { width: 2.5, height: 6, class: 'f-' + g.token }));
            defs.appendChild(p);
            next.appendChild(defs);
          }
          var selRect = s('rect', { y: T - 2, width: Math.max(1, cw - 2), height: H - T - B + 4, rx: 5, class: 'f-sel' });
          next.appendChild(selRect);
          for (var v = bot; v <= top + 0.5; v += step) {
            next.appendChild(s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: Math.abs(v) < 0.5 ? 's-zero' : 's-grid' }));
            var tx = s('text', { x: L - 8, y: y(v) + 4, class: 'ax money', 'text-anchor': 'end' });
            tx.textContent = F.hidden ? F.HIDDEN : A.axisLabel(v / 100);
            next.appendChild(tx);
          }
          cols = [];
          vals.forEach(function (val, i) {
            var x = L + i * cw + (cw - bw) / 2, t0 = y(Math.max(0, val)), b0 = y(Math.min(0, val));
            var r = s('rect', { x: x, y: t0, width: bw, height: Math.max(1, b0 - t0), rx: 3 });
            if (val < 0) r.setAttribute('fill', 'url(#' + pid + ')'); else r.setAttribute('class', 'f-' + g.token);
            next.appendChild(r);
            cols.push(L + i * cw + 1);
          });
          var every = Math.max(1, Math.ceil(34 / cw));
          series.forEach(function (sr, i) {
            if ((n - 1 - i) % every !== 0) return;
            var tx = s('text', { x: L + i * cw + cw / 2, y: H - 8, class: 'ax', 'text-anchor': 'middle' });
            tx.textContent = C.monthShort(sr.month);
            next.appendChild(tx);
          });
          vals.forEach(function (val, i) {
            var hit = s('rect', { x: L + i * cw, y: 0, width: cw, height: H, class: 'hit' });
            hit.addEventListener('pointerenter', function () { select(i); });
            hit.addEventListener('click', function () { select(i); });
            next.appendChild(hit);
          });
          next.addEventListener('keydown', function (e) {
            var k = e.key;
            if (k !== 'ArrowRight' && k !== 'ArrowLeft' && k !== 'Home' && k !== 'End') return;
            e.preventDefault();
            select(k === 'Home' ? 0 : k === 'End' ? n - 1 : Math.max(0, Math.min(n - 1, sel + (k === 'ArrowRight' ? 1 : -1))));
          });
          next._sel = selRect;
          if (svg && svg.parentNode === host) host.replaceChild(next, svg); else host.appendChild(next);
          svg = next;
          place();
        }
        function place() { if (svg) svg._sel.setAttribute('x', cols[sel] || 0); }
        function select(i) { if (i === sel) return; sel = i; place(); onSelect(i); }
        return ctx.charts.responsive(host, draw);
      }
    }
  });
})();
