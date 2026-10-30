/* Settings and data: where the numbers live, export, backup, restore, the
   passphrase lock, the credit score as the reader entered it, look and feel,
   and Delete all. Everything goes through the store (docs/STORE.md); this
   file adds no storage of its own and sends nothing anywhere.

   PART 1 is pure (no DOM, no clock): counts, the restore table, the backup
   reminder and the score lines, so the test page can check them alone.
   PART 2 is the screen; forms use the shared form kit, SW.formKit. */
(function (root) {
  'use strict';
  var SW = root.SW = root.SW || {};
  var E = SW.engC = SW.engC || {};

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dayLong(d) { return Number(d.slice(8, 10)) + ' ' + MONTHS[Number(d.slice(5, 7)) - 1] + ' ' + d.slice(0, 4); }
  function dayShort(d) { return Number(d.slice(8, 10)) + ' ' + MONTHS[Number(d.slice(5, 7)) - 1]; }
  function grouped(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function plural(n, one, many) { return grouped(n) + ' ' + (n === 1 ? one : many); }
  function utcDay(d) { return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))); }
  function daysBetween(a, b) { return Math.round((utcDay(b) - utcDay(a)) / 86400000); }
  function addDays(d, n) { return new Date(utcDay(d) + n * 86400000).toISOString().slice(0, 10); }

  // countsText({ accounts: 9, transactions: 64, goals: 3 }) -> "9 accounts, 64 transactions and 3 goals"
  function countsText(c) {
    return plural(c.accounts || 0, 'account', 'accounts') + ', ' + plural(c.transactions || 0, 'transaction', 'transactions') +
      ' and ' + plural(c.goals || 0, 'goal', 'goals');
  }

  // What a restore would replace, store by store, in the order a reader thinks of them.
  var RESTORE_ROWS = [['accounts', 'Accounts'], ['balances', 'Balance entries'], ['transactions', 'Transactions'],
    ['categories', 'Categories'], ['rules', 'Rules'], ['budgets', 'Budget months'], ['payPlans', 'Pay templates'],
    ['bills', 'Bills'], ['goals', 'Goals'], ['scenarios', 'Saved What if scenarios'], ['scores', 'Credit score entries'],
    ['imports', 'Imports in the log'], ['profile', 'Name at the top of the app']];
  function restoreRows(file, now) {
    return RESTORE_ROWS.filter(function (r) { return (file[r[0]] || 0) || (now[r[0]] || 0); })
      .map(function (r) { return { store: r[0], label: r[1], file: file[r[0]] || 0, now: now[r[0]] || 0 }; });
  }

  // The backup reminder (spec 9.8): own records, no backup in 30 days, not snoozed.
  function reminder(settings, status, today) {
    var last = settings.lastBackupAt ? settings.lastBackupAt.slice(0, 10) : null;
    var lastText = last ? 'Last backup: ' + dayLong(last) + '.' : 'Last backup: never.';
    var snoozed = !!(settings.backupPromptSnoozedUntil && settings.backupPromptSnoozedUntil.slice(0, 10) > today);
    var due = !!status.hasOwnData && (!last || daysBetween(last, today) >= 30) && !snoozed;
    return { show: due, lastText: lastText };
  }
  // Snooze for 7 days: the end of the snooze as an ISO time the store accepts.
  function snoozeUntil(today) { return addDays(today, 7) + 'T00:00:00.000Z'; }

  // ---------- The credit score, as the reader entered it ----------
  var MODEL_TEXT = { FICO: 'FICO', VantageScore: 'VantageScore', unknown: 'model not stated' };
  // "712 on a 300 to 850 scale (FICO), as of 3 Oct 2026."
  function scoreLine(e) {
    return e.score + ' on a ' + e.rangeMin + ' to ' + e.rangeMax + ' scale (' + MODEL_TEXT[e.model] + '), as of ' + dayLong(e.asOf) + '.';
  }
  function newestFirst(list) {
    return list.slice().sort(function (a, b) { return a.asOf < b.asOf ? 1 : a.asOf > b.asOf ? -1 : (a.createdAt < b.createdAt ? 1 : -1); });
  }
  function sameScale(a, b) { return a.model === b.model && a.rangeMin === b.rangeMin && a.rangeMax === b.rangeMax; }
  // The difference from the entry before, only between entries of the same model and range.
  // "+8 points since 3 Sep"; null when there is no earlier entry like it.
  function scoreChange(list) {
    var all = newestFirst(list);
    if (all.length < 2) return null;
    var latest = all[0], prev = null;
    for (var i = 1; i < all.length; i++) if (sameScale(all[i], latest) && all[i].asOf < latest.asOf) { prev = all[i]; break; }
    if (!prev) return null;
    var d = latest.score - prev.score;
    var when = prev.asOf.slice(0, 4) === latest.asOf.slice(0, 4) ? dayShort(prev.asOf) : dayLong(prev.asOf);
    if (d === 0) return { points: 0, text: 'The same as on ' + when };
    return { points: d, text: (d > 0 ? '+' : '−') + Math.abs(d) + (Math.abs(d) === 1 ? ' point' : ' points') + ' since ' + when };
  }
  // Entries that share the latest entry's model and range, oldest first: the chart's one line.
  function scoreSeries(list) {
    var all = newestFirst(list);
    if (!all.length) return [];
    return all.filter(function (e) { return sameScale(e, all[0]); }).reverse();
  }
  function parseWhole(text) {
    var t = String(text || '').trim();
    return /^\d{1,4}$/.test(t) ? { ok: true, value: Number(t) } : { ok: false, message: 'Enter a whole number.' };
  }
  // Five factors, in the same generic words for everyone (FTC). No percentages.
  var FACTORS = [
    ['Payment history', 'the record of whether past bills on credit accounts were on time.'],
    ['Amounts owed', 'how much is owed on credit accounts, and how much of the available credit is in use.'],
    ['Length of credit history', 'how long the credit accounts have been open.'],
    ['New credit', 'how many accounts are new, and how many recent applications for credit there are.'],
    ['Credit mix', 'the kinds of credit on the report, such as cards and loans.']
  ];

  E.settings = { countsText: countsText, restoreRows: restoreRows, reminder: reminder, snoozeUntil: snoozeUntil,
    scoreLine: scoreLine, scoreChange: scoreChange, scoreSeries: scoreSeries, newestFirst: newestFirst, parseWhole: parseWhole,
    daysBetween: daysBetween, dayLong: dayLong, FACTORS: FACTORS };
})(this);

/* PART 2: the screen. */
(function () {
  'use strict';
  var SW = window.SW;
  if (!SW || !SW.screens) return;
  var P = SW.engC.settings;
  var root = document.documentElement;
  var mq = function (q) { return !!(window.matchMedia && window.matchMedia(q).matches); };
  var TIMEOUTS = [5, 15, 30, 60];
  var WHY_SCORES_DIFFER = 'Scores can differ between apps and sites because they use different models, different data held by each credit bureau, and different dates.';

  // UI choices that last while the page is open (never stored).
  var ui = { backupMode: 'encrypted' };

  SW.screens.register('settings', {
    render: function (wrap, ctx) {
      var store = ctx.store, dom = ctx.dom, h = dom.h, K = SW.formKit, S = window.SWSchema;
      var state = { panel: null, note: null, look: null, scoreEdit: null, confirm: null, deleting: false, focus: null, estimate: null };
      var noteTimer = 0;
      if (ctx.sub === 'restore' || ctx.sub === 'backup' || ctx.sub === 'lock' || (ctx.sub === 'score' && ctx.flags.creditScore)) state.focus = 'card-' + ctx.sub;

      draw();
      store.estimate().then(function (e) { if (e && e.almostFull) { state.estimate = e; draw(); } });
      return {
        onStoreChange: function (ev) {
          if (state.deleting) return true;                 // our own Delete all: deletedView() shows the result
          var st = store.status();
          if (st.locked || st.deleted || st.closed) return false; // the shell draws these states
          draw();
          return true;
        },
        destroy: function () { clearTimeout(noteTimer); }
      };

      // ---------- helpers ----------
      function counts() { return { accounts: store.count('accounts'), transactions: store.count('transactions'), goals: store.count('goals') }; }
      function setNote(text, isError) {
        state.note = { text: text, error: !!isError };
        clearTimeout(noteTimer);
        noteTimer = setTimeout(function () { state.note = null; var n = wrap.querySelector('.st-note'); if (n) dom.clear(n); }, 15000);
      }
      function noteEl() {
        if (!state.note) return null;
        return h('p', { class: state.note.error ? 'fk-formerr' : 'fk-saved', role: state.note.error ? 'alert' : 'status', text: state.note.text });
      }
      function btn(text, cls, focusKey, onClick) {
        var b = h('button', { type: 'button', class: cls, text: text, 'data-focus': focusKey || null });
        b.addEventListener('click', onClick);
        return b;
      }
      function go(focusKey) { state.focus = focusKey; draw(); }
      function passField(label, hint, auto) {
        var f = K.field({ label: label, kind: 'text', cap: 'passphrase', hint: hint });
        f.input.type = 'password';
        f.input.setAttribute('autocomplete', auto || 'new-password');
        f.input.setAttribute('spellcheck', 'false');
        return f;
      }
      // A live strength hint under a new passphrase.
      function strength(f) {
        var p = h('p', { class: 'st-strength', 'aria-live': 'polite' });
        function upd() {
          var v = f.input.value;
          p.textContent = v ? 'Strength, a hint, not a promise: ' + store.passphraseHint(v).message : '';
        }
        f.input.addEventListener('input', upd);
        return p;
      }
      function formErr() { var p = h('p', { class: 'fk-formerr', role: 'alert' }); p.hidden = true; return p; }
      function card(id, title, kids, cls) {
        return h('section', { class: 'card st-card' + (cls ? ' ' + cls : ''), id: 'st-' + id, 'aria-labelledby': 'st-' + id + '-h', tabindex: '-1', 'data-focus': 'card-' + id },
          [h('h2', { id: 'st-' + id + '-h', text: title })].concat(kids));
      }
      function para(text, cls) { return h('p', { class: 'st-p' + (cls ? ' ' + cls : ''), text: text }); }

      function draw() {
        var y = window.scrollY;
        dom.clear(wrap);
        var st = store.status(), s = store.settings(), today = store.today();
        wrap.appendChild(ctx.app.screenHeader(ctx.route, { eyebrow: st.hasSample ? 'Your data · Sample data' : 'Your data' }));
        var rem = P.reminder(s, st, today);
        if (rem.show) wrap.appendChild(reminderBar(rem, today));
        wrap.appendChild(h('div', { class: 'st-note' }, noteEl()));
        var grid = h('div', { class: 'st-grid' }, [
          whereCard(st, s), backupCard(st, s, rem), restoreCard(), lockCard(st, s), ctx.flags.creditScore ? scoreCard(today) : null, nameCard(), lookCard(s), deleteCard()
        ]);
        wrap.appendChild(grid);
        window.scrollTo(0, y);
        if (state.focus) {
          var el = wrap.querySelector('[data-focus="' + state.focus + '"]');
          state.focus = null;
          if (el) { el.focus(); if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }
        }
      }

      // ---------- Backup reminder ----------
      function reminderBar(rem, today) {
        return h('section', { class: 'card st-remind', 'aria-label': 'Backup reminder' }, [
          h('p', { class: 'st-p', text: rem.lastText + ' A backup file is the only copy of your numbers outside this browser.' }),
          h('div', { class: 'fk-actions' }, [
            btn('Save a backup', 'btn small', null, function () { go('backup-first'); }),
            btn('Snooze for 7 days', 'btn small quiet', null, function () {
              store.setSettings({ backupPromptSnoozedUntil: P.snoozeUntil(today) }).catch(function (e) { setNote(e.message, true); draw(); });
            })
          ])
        ]);
      }

      // ---------- Where your numbers live ----------
      function whereCard(st, s) {
        var kids = [h('div', { class: 'st-chip' }, h('span', { class: 'chip device' }, [h('span', { class: 'dot' }), 'On this device only']))];
        kids.push(para(P.countsText(counts()) + (st.hasSample ? ', sample data included' : '') + '. Nothing has been sent to us.', 'body'));
        var keep;
        if (st.backend === 'memory') keep = st.notice;
        else if (s.persistGranted === true) keep = 'This browser has agreed to keep your data, so it won’t clear it to make space.';
        else if (s.persistGranted === false) keep = 'This browser hasn’t agreed to keep your data, so it may clear it to make space.';
        else keep = 'The app asks this browser to keep your data after your first save.';
        kids.push(para(keep, 'body'));
        kids.push(para('Clearing this browser’s data deletes everything here. Some browsers also clear a site’s data after a long time without a visit. Stepwell Financial can’t get it back.', 'body'));
        if (state.estimate) kids.push(para('This device is almost out of space for the app. Save a backup, then you can remove older transactions.', 'body'));
        if (st.canLoadSample) {
          kids.push(h('div', { class: 'fk-actions' }, btn('Look around with sample data', 'btn small quiet', 'sample', function (e) {
            e.target.disabled = true;
            store.loadSample().then(function () { setNote('Sample data added. Remove it here, or from the bar at the top, in one tap.'); state.focus = 'sample'; draw(); },
              function (err) { setNote(err.message, true); draw(); });
          })));
        } else if (st.hasSample) {
          kids.push(h('div', { class: 'fk-actions' }, btn('Remove sample data', 'btn small quiet', 'sample', function (e) {
            e.target.disabled = true;
            store.removeSample().then(function (r) {
              var a = r.removed.accounts || 0, l = r.removed.transactions || 0;
              setNote('Removed ' + a + (a === 1 ? ' account' : ' accounts') + ' and ' + l + (l === 1 ? ' line.' : ' lines.') + ' Your own records are as they were.');
              state.focus = 'card-where';
              draw();
            }, function (err) { setNote(err.message, true); draw(); });
          })));
        }
        return card('where', 'Where your numbers live', kids);
      }

      // ---------- Export and backup ----------
      function backupCard(st, s, rem) {
        var csvMsg = h('p', { class: 'st-msg', role: 'status' });
        var csv = btn('Download CSV', 'btn small quiet', 'csv', function () {
          try {
            var f = store.exportTransactionsCsv();
            dom.download(f.text, f.fileName, f.type);
            csvMsg.textContent = 'Made ' + f.fileName + ' on this device.';
          } catch (e) { csvMsg.textContent = e.message; }
        });

        var msg = formErr();
        var mode = dom.seg('Backup file', [{ value: 'encrypted', label: 'With a passphrase' }, { value: 'plain', label: 'Without a passphrase' }],
          ui.backupMode, function (v) { ui.backupMode = v; state.focus = 'backup-mode'; draw(); });
        mode.firstChild.setAttribute('data-focus', 'backup-mode');
        mode.lastChild.setAttribute('data-focus', 'backup-mode-plain');
        var p1 = null, p2 = null, body = [];
        if (ui.backupMode === 'encrypted') {
          p1 = passField('Passphrase for the backup', 'At least 12 characters, used only for this file and separate from the lock.');
          p1.input.setAttribute('data-focus', 'backup-first');
          p2 = passField('Type it again');
          body = [p1.el, strength(p1), p2.el,
            para('If you forget it, we can’t open the file for you. Nobody can.', 'body')];
        } else {
          body = [h('div', { class: 'st-warn' }, [
            para('This file won’t be encrypted. It holds your financial details as plain text, so anyone who gets the file can read it.', 'body'),
            para('If this browser deletes your data, a backup you saved is the only copy. Stepwell Financial can’t recover it.', 'body')
          ])];
        }
        var save = btn('Save backup file', 'btn small', 'backup-save', function () {
          msg.hidden = true;
          if (p1) { p1.clear(); p2.clear(); }
          var opts = p1 ? { passphrase: p1.input.value, confirm: p2.input.value } : {};
          if (p1 && !p1.input.value) { p1.error('Enter a passphrase for the file, or choose Without a passphrase.'); K.focusFirstError(wrap.querySelector('#st-backup')); return; }
          save.disabled = true;
          store.makeBackup(opts).then(function (b) {
            dom.download(b.text, b.fileName, 'application/json');
            setNote('Made ' + b.fileName + (b.encrypted ? ', locked with its passphrase,' : ', not encrypted,') + ' on this device.');
            state.focus = 'backup-save';
            draw();
          }, function (e) {
            save.disabled = false;
            if (p1 && e.code === 'weak-passphrase') p1.error(e.message);
            else if (p1 && e.code === 'mismatch') p2.error(e.message);
            else { msg.hidden = false; msg.textContent = e.message; }
            K.focusFirstError(wrap.querySelector('#st-backup'));
          });
        });
        if (!p1) save.setAttribute('data-focus', 'backup-first');
        return card('backup', 'Save a copy', [
          h('div', { class: 'st-block' }, [
            h('h3', { text: 'Spreadsheet (CSV)' }),
            para('Your transactions, to open in a spreadsheet. It can’t be restored.', 'body'),
            h('div', { class: 'fk-actions' }, csv), csvMsg
          ]),
          h('div', { class: 'st-block' }, [
            h('h3', { text: 'Full backup' }),
            para('One file with everything: ' + P.countsText(counts()) + ', and your settings. You can restore it here later.', 'body'),
            mode
          ].concat(body).concat([msg, h('div', { class: 'fk-actions' }, save), h('p', { class: 'st-last', text: rem.lastText })]))
        ]);
      }

      // ---------- Restore ----------
      function restoreCard() {
        if (state.look) return restoreCheck(state.look);
        var file = h('input', { type: 'file', id: 'st-file', accept: '.json,application/json', 'data-focus': 'restore-file' });
        var fileErr = h('p', { class: 'fk-err', id: 'st-file-e' });
        fileErr.hidden = true;
        var fileField = h('div', { class: 'fk-field' }, [h('label', { for: 'st-file', text: 'Backup file' }), file, fileErr]);
        var pass = passField('Passphrase, if the file has one', 'Only for a backup saved with a passphrase.', 'off');
        var msg = formErr();
        var check = btn('Check this file', 'btn small quiet', 'restore-check', function () {
          fileErr.hidden = true; fileField.classList.remove('fk-bad'); pass.clear(); msg.hidden = true;
          var f = file.files && file.files[0];
          if (!f) { fileErr.hidden = false; fileErr.textContent = 'Choose a backup file first.'; fileField.classList.add('fk-bad'); file.focus(); return; }
          check.disabled = true;
          store.readBackupFile(f, pass.input.value || undefined).then(function (look) {
            state.look = { look: look, name: f.name };
            go('restore-replace');
          }, function (e) {
            check.disabled = false;
            if (e.code === 'needs-passphrase' || e.code === 'wrong-passphrase') { pass.error(e.message); pass.input.focus(); }
            else { msg.hidden = false; msg.textContent = e.message; K.focusFirstError(wrap.querySelector('#st-restore')); }
          });
        });
        return card('restore', 'Restore a backup', [
          para('Restoring replaces everything on this device with the backup. It never mixes the two. Nothing changes until you choose Replace my data.', 'body'),
          fileField, pass.el, msg, h('div', { class: 'fk-actions' }, check)
        ]);
      }
      function restoreCheck(x) {
        var look = x.look, rows = P.restoreRows(look.file, look.now);
        var table = h('table', { class: 'numtable st-table' }, [
          h('caption', { class: 'sr-only', text: 'What the backup holds, and what is on this device now' }),
          h('thead', {}, h('tr', {}, [h('th', { scope: 'col', text: 'Records' }), h('th', { scope: 'col', text: 'In the file' }), h('th', { scope: 'col', text: 'On this device now' })])),
          h('tbody', {}, rows.map(function (r) {
            return h('tr', {}, [h('th', { scope: 'row', text: r.label }), h('td', { text: r.file.toLocaleString('en-US') }), h('td', { text: r.now.toLocaleString('en-US') })]);
          }))
        ]);
        var msg = formErr();
        var replace = btn('Replace my data', 'btn small fk-danger', 'restore-replace', function () {
          replace.disabled = true;
          store.restoreBackup(look.token).then(function () {
            state.look = null;
            setNote('Restored the backup made on ' + P.dayLong(look.createdAt.slice(0, 10)) + '. Everything on this device now comes from that file.');
            state.focus = 'card-restore';
            draw();
          }, function (e) { replace.disabled = false; msg.hidden = false; msg.textContent = e.message; });
        });
        var cancel = btn('Cancel', 'btn small', 'restore-cancel', function () { state.look = null; go('restore-file'); });
        return card('restore', 'Restore a backup', [
          para(x.name + ' · made ' + P.dayLong(look.createdAt.slice(0, 10)) + (look.encrypted ? ' · opened with its passphrase' : ''), 'st-file-name'),
          h('div', { class: 'tablewrap' }, table),
          para('Restoring replaces everything on this device with this file. Anything added since ' + P.dayLong(look.createdAt.slice(0, 10)) + ' would be gone.', 'body'),
          msg,
          h('div', { class: 'fk-actions' }, [replace, cancel, btn('Save a backup of today first', 'linkbtn', null, function () { go('backup-first'); })])
        ], 'st-restore-check');
      }

      // ---------- The passphrase lock (spec 9.5) ----------
      function lockCard(st, s) {
        var lock = s.lock || {}, kids = [];
        if (st.backend === 'memory') {
          kids.push(para('The lock needs this browser to save, and it isn’t letting this page save, so the lock can’t be turned on here.', 'body'));
          return card('lock', 'Lock with a passphrase', kids);
        }
        if (!lock.enabled) {
          kids.push(para('Off. With the lock on, everything you’ve entered is encrypted on this device, and the app asks for your passphrase when it opens and after a time without use. Someone with this browser can still see that data exists.', 'body'));
          if (state.panel !== 'lock-on') {
            kids.push(h('div', { class: 'fk-actions' }, btn('Set up the lock', 'btn small quiet', 'lock-setup', function () { state.panel = 'lock-on'; go('lock-warn'); })));
            return card('lock', 'Lock with a passphrase', kids);
          }
          var p1 = passField('Passphrase', 'At least 12 characters; several unrelated words are easier to remember.');
          var p2 = passField('Type it again');
          var mins = K.field({ label: 'Lock after this long without use', kind: 'select', value: String(lock.timeoutMin || 15),
            options: TIMEOUTS.map(function (m) { return [String(m), m + ' minutes']; }) });
          var msg = formErr();
          var on = btn('Turn on the lock', 'btn small', 'lock-turn-on', function () {
            p1.clear(); p2.clear(); msg.hidden = true;
            on.disabled = true;
            var min = Number(mins.input.value);
            store.enableLock(p1.input.value, p2.input.value).then(function () {
              return min !== (store.settings().lock.timeoutMin) ? store.setLockTimeout(min) : null;
            }).then(function () {
              state.panel = null;
              setNote('The lock is on. The app locks after ' + min + ' minutes without use, when this tab closes, and each time it opens.');
              state.focus = 'card-lock';
              draw();
            }, function (e) {
              on.disabled = false;
              if (e.code === 'weak-passphrase') p1.error(e.message);
              else if (e.code === 'mismatch') p2.error(e.message);
              else { msg.hidden = false; msg.textContent = e.message; }
              K.focusFirstError(wrap.querySelector('#st-lock'));
            });
          });
          kids.push(h('div', { class: 'st-warn', tabindex: '-1', 'data-focus': 'lock-warn' }, [
            para('If you forget your passphrase, nobody can recover your data, including us. Download a backup first.', 'body'),
            h('div', { class: 'fk-actions' }, btn('Save a backup with a passphrase', 'btn small quiet', null, function () { ui.backupMode = 'encrypted'; go('backup-first'); }))
          ]));
          kids.push(p1.el, strength(p1), p2.el, mins.el, msg,
            h('div', { class: 'fk-actions' }, [on, btn('Cancel', 'btn small quiet', null, function () { state.panel = null; go('lock-setup'); })]));
          return card('lock', 'Lock with a passphrase', kids);
        }
        // On
        kids.push(para('On. The app locks after ' + lock.timeoutMin + ' minutes without use, when this tab closes, and each time it opens. Someone with this browser can still see that data exists.', 'body'));
        var seg = dom.seg('Lock after', TIMEOUTS.map(function (m) { return { value: m, label: m + ' min', aria: m + ' minutes' }; }), lock.timeoutMin, function (m) {
          state.focus = 'lock-time-' + m;
          store.setLockTimeout(m).catch(function (e) { setNote(e.message, true); draw(); });
        });
        Array.prototype.forEach.call(seg.children, function (b, i) { b.setAttribute('data-focus', 'lock-time-' + TIMEOUTS[i]); });
        kids.push(h('div', { class: 'st-row' }, [h('span', { class: 'st-row-t', text: 'Lock after' }), seg]));
        kids.push(h('div', { class: 'fk-actions' }, [
          btn('Lock now', 'btn small quiet', 'lock-now', function () { store.lock(); }),
          btn('Change passphrase', 'btn small quiet', 'lock-change', function () { state.panel = state.panel === 'lock-change' ? null : 'lock-change'; go('lock-change'); }),
          btn('Turn off the lock', 'btn small quiet', 'lock-off', function () { state.panel = state.panel === 'lock-off' ? null : 'lock-off'; go('lock-off'); })
        ]));
        if (state.panel === 'lock-change') kids.push(changePanel());
        if (state.panel === 'lock-off') kids.push(offPanel());
        return card('lock', 'Lock with a passphrase', kids);
      }
      function changePanel() {
        var old = passField('Passphrase you use now', null, 'current-password');
        var p1 = passField('New passphrase', 'At least 12 characters.');
        var p2 = passField('Type the new one again');
        var msg = formErr();
        var save = btn('Change passphrase', 'btn small', null, function () {
          old.clear(); p1.clear(); p2.clear(); msg.hidden = true; save.disabled = true;
          store.changePassphrase(old.input.value, p1.input.value, p2.input.value).then(function () {
            state.panel = null; setNote('Passphrase changed. The old one no longer opens the app.'); state.focus = 'lock-change'; draw();
          }, function (e) {
            save.disabled = false;
            if (e.code === 'wrong-passphrase') old.error(e.message);
            else if (e.code === 'weak-passphrase') p1.error(e.message);
            else if (e.code === 'mismatch') p2.error(e.message);
            else { msg.hidden = false; msg.textContent = e.message; }
            K.focusFirstError(wrap.querySelector('#st-lock'));
          });
        });
        return h('div', { class: 'st-panel' }, [old.el, p1.el, strength(p1), p2.el, msg, h('div', { class: 'fk-actions' }, save)]);
      }
      function offPanel() {
        var pass = passField('Passphrase', null, 'current-password');
        var msg = formErr();
        var off = btn('Turn off the lock', 'btn small fk-danger', null, function () {
          pass.clear(); msg.hidden = true; off.disabled = true;
          store.disableLock(pass.input.value).then(function () {
            state.panel = null; setNote('The lock is off. Nothing on this device is encrypted now.'); state.focus = 'card-lock'; draw();
          }, function (e) {
            off.disabled = false;
            if (e.code === 'wrong-passphrase') pass.error(e.message); else { msg.hidden = false; msg.textContent = e.message; }
            K.focusFirstError(wrap.querySelector('#st-lock'));
          });
        });
        return h('div', { class: 'st-panel' }, [
          para('With the lock off, your records are stored on this device without encryption.', 'body'),
          pass.el, msg, h('div', { class: 'fk-actions' }, off)
        ]);
      }

      // ---------- Credit score, as you entered it (spec 9.9) ----------
      function scoreCard(today) {
        var list = store.list('scores'), all = P.newestFirst(list), kids = [];
        if (all.length) {
          var latest = all[0], ch = P.scoreChange(list);
          kids.push(h('p', { class: 'st-score-line', text: P.scoreLine(latest) }));
          if (ch) kids.push(para(ch.text + ', between two entries of the same model and scale.', 'st-score-change'));
          kids.push(para('This is the number you typed in. We have not checked it.', 'body'));
          kids.push(h('p', { class: 'disclaimer', text: 'For education only, not financial advice.' }));
          var series = P.scoreSeries(list);
          if (series.length >= 2) kids.push(scoreChart(series));
          kids.push(scoreTable(all));
        } else {
          kids.push(para('No score yet. If you have a credit score from a card statement, a bank or a report, you can type it in here with its scale and date.', 'body'));
        }
        if (state.scoreEdit) kids.push(scoreForm(state.scoreEdit === 'new' ? null : store.get('scores', state.scoreEdit), today));
        else if (list.length < S.CAPS.scores) kids.push(h('div', { class: 'fk-actions' }, btn('Add a score', 'btn small quiet', 'score-add', function () { state.scoreEdit = 'new'; go('score-field'); })));
        if (state.confirm) kids.push(state.confirm.el);
        kids.push(para('Only the number. We never ask for your credit report, and we never ask for a Credit Karma login or any other.', 'body'));
        kids.push(h('h3', { text: 'What scores are generally built from' }));
        kids.push(h('ul', { class: 'st-factors' }, P.FACTORS.map(function (f) { return h('li', {}, [h('b', { text: f[0] + ': ' }), f[1]]); })));
        kids.push(para('These are the same for everyone, and they say nothing about your number. ' + WHY_SCORES_DIFFER, 'body'));
        kids.push(h('h3', { text: 'Free credit reports' }));
        kids.push(h('ul', { class: 'st-links' }, [
          h('li', { text: 'AnnualCreditReport.com: free credit reports from the three nationwide credit bureaus, available weekly. A report is not a score.' }),
          h('li', { text: 'consumerfinance.gov, the Consumer Financial Protection Bureau: how credit reports and scores work. A report is not a score.' })
        ]));
        kids.push(h('p', { class: 'st-p' }, ['More in Learn: ', h('a', { href: '#/learn/credit-scores', text: 'How credit scores work' }), '.']));
        return card('score', 'Your score, as you entered it', kids);
      }
      function scoreTable(all) {
        return h('div', { class: 'tablewrap' }, h('table', { class: 'numtable st-table st-scores' }, [
          h('caption', { class: 'sr-only', text: 'Every score you entered, newest first' }),
          h('thead', {}, h('tr', {}, ['Date', 'Score', 'Scale', 'Model', 'Where you saw it', 'Change'].map(function (t) { return h('th', { scope: 'col', text: t }); }))),
          h('tbody', {}, all.map(function (e) {
            var edit = btn('Edit', 'linkbtn', 'score-edit-' + e.id, function () { state.scoreEdit = e.id; go('score-field'); });
            edit.setAttribute('aria-label', 'Edit the score from ' + P.dayLong(e.asOf));
            var del = btn('Delete', 'linkbtn', 'score-del-' + e.id, function () { askDelete(e); });
            del.setAttribute('aria-label', 'Delete the score from ' + P.dayLong(e.asOf));
            return h('tr', {}, [h('td', { text: P.dayLong(e.asOf) }), h('td', { text: String(e.score) }), h('td', { text: e.rangeMin + ' to ' + e.rangeMax }),
              h('td', { text: e.model === 'unknown' ? 'Not stated' : e.model }), h('td', { text: e.note || '' }), h('td', {}, [edit, ' ', del])]);
          }))
        ]));
      }
      function askDelete(e) {
        state.confirm = K.confirmBox({
          title: 'Delete the score from ' + P.dayLong(e.asOf) + '?', text: 'This removes this one entry from this device. You can’t undo this unless you have a backup.',
          yes: 'Delete entry', no: 'Keep it',
          onYes: function () { state.confirm = null; store.delete('scores', e.id).then(function () { setNote('Deleted the score from ' + P.dayLong(e.asOf) + '.'); state.focus = 'card-score'; draw(); }, function (err) { setNote(err.message, true); draw(); }); },
          onNo: function () { state.confirm = null; go('score-del-' + e.id); }
        });
        draw();
        state.confirm.focus();
      }
      // One plain line in ink, with the table above as its text version.
      function scoreChart(series) {
        var s = dom.s, W = 320, H = 110, pad = 10, lo = series[0].rangeMin, hi = series[0].rangeMax, n = series.length;
        var pts = series.map(function (e, i) {
          return [pad + (W - 2 * pad) * (n === 1 ? 0.5 : i / (n - 1)), H - pad - (H - 2 * pad) * (e.score - lo) / (hi - lo)];
        });
        var svg = s('svg', { class: 'st-chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Your ' + (series[0].model === 'unknown' ? '' : series[0].model + ' ') + 'scores on the ' + lo + ' to ' + hi + ' scale, oldest to newest: ' + series.map(function (e) { return e.score; }).join(', ') + '.' }, [
          s('line', { class: 'st-chart-base', x1: pad, y1: H - pad, x2: W - pad, y2: H - pad }),
          s('polyline', { class: 'st-chart-line', points: pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') })
        ].concat(pts.map(function (p) { return s('circle', { class: 'st-chart-dot', cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: 3 }); })));
        return h('figure', { class: 'st-figure' }, [svg, h('figcaption', { class: 'fine', text: 'Entries with the same model and scale, oldest to newest, from ' + lo + ' at the bottom to ' + hi + ' at the top.' })]);
      }
      function scoreForm(e, today) {
        var preset = e ? (e.rangeMin === 300 && e.rangeMax === 850 ? '300-850' : e.rangeMin === 250 && e.rangeMax === 900 ? '250-900' : 'custom') : '300-850';
        var f = {
          score: K.field({ label: 'Your score', kind: 'text', value: e ? String(e.score) : '', hint: 'The number only, as your statement, bank or report shows it.' }),
          model: K.field({ label: 'Score model', kind: 'select', value: e ? e.model : 'FICO', options: [['FICO', 'FICO'], ['VantageScore', 'VantageScore'], ['unknown', 'I don’t know']] }),
          range: K.field({ label: 'Scale', kind: 'select', value: preset, options: [['300-850', '300 to 850'], ['250-900', '250 to 900'], ['custom', 'Another scale']] }),
          rangeMin: K.field({ label: 'Lowest possible', kind: 'text', value: e ? String(e.rangeMin) : '' }),
          rangeMax: K.field({ label: 'Highest possible', kind: 'text', value: e ? String(e.rangeMax) : '' }),
          asOf: K.field({ label: 'Date of the score', kind: 'date', value: e ? e.asOf : today }),
          note: K.field({ label: 'Where you saw it', kind: 'text', cap: 'scoreNote', optional: true, value: e ? e.note : '' })
        };
        f.score.input.setAttribute('inputmode', 'numeric');
        f.score.input.maxLength = 4;
        f.score.input.setAttribute('data-focus', 'score-field');
        [f.rangeMin, f.rangeMax].forEach(function (x) { x.input.setAttribute('inputmode', 'numeric'); x.input.maxLength = 4; });
        f.asOf.input.max = today;
        var customRow = h('div', { class: 'st-pair' }, [f.rangeMin.el, f.rangeMax.el]);
        function sync() { customRow.hidden = f.range.input.value !== 'custom'; }
        f.range.input.addEventListener('change', sync);
        sync();
        var top = formErr();
        var save = btn(e ? 'Save changes' : 'Save score', 'btn small', null, submit);
        var cancel = btn('Cancel', 'btn small quiet', null, function () { var back = e ? 'score-edit-' + e.id : 'score-add'; state.scoreEdit = null; go(back); });
        var form = h('div', { class: 'st-panel st-score-form', role: 'group', 'aria-label': e ? 'Edit a score' : 'Add a score' },
          [top, f.score.el, f.model.el, f.range.el, customRow, f.asOf.el, f.note.el, h('div', { class: 'fk-actions' }, [save, cancel])]);
        form.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') { ev.preventDefault(); submit(); } });
        return form;

        function submit() {
          Object.keys(f).forEach(function (k) { f[k].clear(); });
          top.hidden = true;
          var errs = [], sc = P.parseWhole(f.score.input.value), lo, hi;
          if (!sc.ok) errs.push(['score', sc.message]);
          if (f.range.input.value === 'custom') {
            var a = P.parseWhole(f.rangeMin.input.value), b = P.parseWhole(f.rangeMax.input.value);
            if (!a.ok) errs.push(['rangeMin', a.message]); else lo = a.value;
            if (!b.ok) errs.push(['rangeMax', b.message]); else hi = b.value;
          } else { var r = f.range.input.value.split('-'); lo = Number(r[0]); hi = Number(r[1]); }
          if (!f.asOf.input.value) errs.push(['asOf', 'Enter the date of the score.']);
          if (errs.length) { errs.forEach(function (x) { f[x[0]].error(x[1]); }); K.focusFirstError(form); return; }
          var draft = { score: sc.value, model: f.model.input.value, rangeMin: lo, rangeMax: hi, asOf: f.asOf.input.value, note: f.note.text() };
          save.disabled = true;
          var job = e ? store.update('scores', e.id, draft) : store.add('scores', draft);
          job.then(function () {
            state.scoreEdit = null;
            setNote(e ? 'Saved your changes to the score.' : 'Saved your score, as you entered it.');
            state.focus = 'card-score';
            draw();
          }, function (err) {
            save.disabled = false;
            var map = { score: f.score, asOf: f.asOf, note: f.note, rangeMin: f.range.input.value === 'custom' ? f.rangeMin : f.range, rangeMax: f.range.input.value === 'custom' ? f.rangeMax : f.range };
            if (!K.showErrors(err, map, top)) { top.hidden = false; top.textContent = err.message; }
            K.focusFirstError(form);
          });
        }
      }

      // ---------- Look and feel ----------
      function lookCard(s) {
        function set(patch, focusKey) { state.focus = focusKey; store.setSettings(patch).catch(function (e) { setNote(e.message, true); draw(); }); }
        var theme = dom.seg('Theme', [{ value: 'dark', label: 'Night ledger' }, { value: 'light', label: 'Paper' }], s.theme, function (v) { set({ theme: v }, 'theme-' + v); });
        theme.firstChild.setAttribute('data-focus', 'theme-dark');
        theme.lastChild.setAttribute('data-focus', 'theme-light');
        var pay = K.field({ label: 'How often you’re paid', kind: 'select', value: s.payFrequency,
          options: [['weekly', 'Every week'], ['biweekly', 'Every 2 weeks'], ['semimonthly', 'Twice a month'], ['monthly', 'Once a month']],
          hint: 'Bills uses this to show a per-pay figure.' });
        pay.input.setAttribute('data-focus', 'pay');
        pay.input.addEventListener('change', function () { set({ payFrequency: pay.input.value }, 'pay'); });
        return card('look', 'Look and feel', [
          h('div', { class: 'st-row' }, [h('span', { class: 'st-row-t', text: 'Theme' }), theme]),
          h('ul', { class: 'st-list', role: 'list' }, [
            toggle('Less motion', mq('(prefers-reduced-motion: reduce)') ? 'Your device asks for less motion too, so animation stays off.' : 'Stops animation in the app.', !!s.lessMotion, function (v) { set({ lessMotion: v }, 'sw-lessMotion'); }, 'lessMotion'),
            toggle('More contrast', 'Turns off the glass panels and draws stronger lines.', !!s.moreContrast, function (v) { set({ moreContrast: v }, 'sw-moreContrast'); }, 'moreContrast'),
            toggle('Hide amounts', 'Shows dots in place of every amount, like the button at the top, until you turn it off.', !!s.hideAmounts, function (v) { set({ hideAmounts: v }, 'sw-hideAmounts'); }, 'hideAmounts')
          ]),
          pay.el
        ]);
      }
      // ---------- Your name (shown at the top of the app, on this device only) ----------
      function nameCard() {
        var who = K.field({ label: 'What should we call you?', kind: 'text', cap: 'displayName', optional: true, mask: true, value: store.displayName(),
          hint: 'Shown at the top of the app, on this device only. Leave it blank to show nothing.' });
        who.input.setAttribute('data-focus', 'who');
        who.input.setAttribute('autocomplete', 'off');
        who.input.setAttribute('spellcheck', 'false');
        function save() {
          who.clear(); saveBtn.disabled = true;
          store.setDisplayName(who.text()).then(function () { setNote('Saved.'); state.focus = 'who-save'; draw(); },
            function (e) { saveBtn.disabled = false; who.error(e.message); who.input.focus(); });
        }
        var saveBtn = btn('Save', 'btn small quiet', 'who-save', save);
        who.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); save(); } });
        return card('name', 'Your name', [who.el, h('div', { class: 'fk-actions' }, saveBtn)]);
      }
      function toggle(label, sub, on, flip, key) {
        var sid = 'st-sub-' + key;
        var b = h('button', { type: 'button', role: 'switch', class: 'st-switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': label, 'aria-describedby': sid, 'data-focus': 'sw-' + key });
        b.addEventListener('click', function () { flip(!on); });
        return h('li', { class: 'li st-toggle' }, [h('span', {}, [h('span', { class: 'st-row-t', text: label }), h('span', { class: 'sub st-sub', id: sid, text: sub })]), b]);
      }

      // ---------- Delete all (spec 9.8) ----------
      function deleteCard() {
        var word = K.field({ label: 'Type DELETE to confirm', kind: 'text' });
        word.input.maxLength = 10;
        word.input.setAttribute('spellcheck', 'false');
        word.input.setAttribute('autocapitalize', 'characters');
        word.input.setAttribute('data-focus', 'delete-word');
        var msg = formErr();
        var del = btn('Delete everything', 'btn small fk-danger', 'delete', function () {
          word.clear(); msg.hidden = true;
          if (word.input.value !== 'DELETE') { word.error('Type DELETE to confirm.'); word.input.focus(); return; }
          del.disabled = true;
          state.deleting = true;
          store.deleteAll('DELETE').then(function (r) { deletedView(r); }, function (e) {
            state.deleting = false; del.disabled = false; msg.hidden = false;
            // Another tab or window still holds the data: say what to do, not the raw word "blocked".
            msg.textContent = e && e.code === 'blocked' ? 'Close the app in your other tabs or windows, then try again.' : e.message;
          });
        });
        return card('delete', 'Delete all my data on this device', [
          para('This removes ' + P.countsText(counts()) + (store.displayName() ? ', your settings and the name you gave the app' : ', and your settings') + ' from this device. We have no copy, so we can’t bring them back. Files you downloaded before, such as backups, are not touched.', 'body'),
          word.el, msg,
          h('div', { class: 'fk-actions' }, [del, btn('Save a backup first', 'btn small quiet', null, function () { go('backup-first'); })])
        ], 'st-delete');
      }
      function deletedView(r) {
        dom.clear(wrap);
        var reload = btn('Reload the page', 'btn', null, function () { location.reload(); });
        // The verified sentence only when the check found nothing left (spec 9.8).
        wrap.appendChild(h('header', { class: 'screen-head' }, h('h1', { id: 'view-title', tabindex: '-1',
          text: r.nothingLeft ? 'Nothing from this app is left on this device.' : 'Your data was deleted, but this browser still lists some of the app’s storage.' })));
        wrap.appendChild(h('section', { class: 'card st-card' }, [
          para('Files you downloaded before, such as backups, are not touched. Reloading the page starts the app again, empty.', 'body'),
          h('div', { class: 'fk-actions' }, reload)
        ]));
        var t = document.getElementById('view-title');
        if (t) t.focus();
      }
    }
  });
})();
