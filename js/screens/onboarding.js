/* Onboarding (A1) and the dashboard states (A3), on the store.
   Addresses (the shell passes the part after #/onboarding/ as ctx.sub):
     #/onboarding or /1 to /4: what the app does; where your numbers are
       kept, with the optional lock; a first account; what to learn.
     #/onboarding/state/empty, /loading, /error: the A3 states, for reviewers.
   Answers live in the store (the account, the lock, settings.topics), so Back
   and Forward keep them. Every step can be skipped. Finishing sets
   settings.onboardingDone, and the app then opens on Overview. */
(function () {
  'use strict';
  var SW = window.SW;
  if (!SW || !SW.screens) return;

  var S5_LINE = 'Control, monitor and enhance your financial life from one place.';
  var STEPS = { '1': S5_LINE, '2': 'Where your numbers are kept', '3': 'Add your first account', '4': 'What would you like to learn about?' };
  var STATES = { empty: 'Empty state', loading: 'Loading state', error: 'Error state: import' };
  var BASE = '#/onboarding/';
  var TIMEOUTS = [5, 15, 30, 60];

  function lessons() { return (SW.engC && SW.engC.learn && SW.engC.learn.LESSONS) || []; }

  SW.screens.register('onboarding', {
    render: function (wrap, ctx) {
      var store = ctx.store, dom = ctx.dom, h = dom.h, K = SW.formKit, Sc = window.SWSchema;
      var sub = String(ctx.sub || '');
      // The A3 states hold made-up figures and exist for reviewers: prototype builds only.
      var stateKey = ctx.flags.prototypeBuild && sub.indexOf('state/') === 0 ? sub.slice(6) : null;
      if (stateKey && !STATES[stateKey]) stateKey = 'empty';
      var step = stateKey ? null : (STEPS[sub] ? sub : '1');
      var ui = { lockOpen: false, note: null, focus: null };

      draw();
      return {
        onStoreChange: function () {
          var st = store.status();
          if (st.locked || st.deleted || st.closed) return false;
          draw();
          return true;
        }
      };

      function draw() {
        var y = window.scrollY;
        dom.clear(wrap);
        var title = stateKey ? STATES[stateKey] : STEPS[step];
        var eyebrow = stateKey ? 'Dashboard states' + (stateKey === 'error' ? ' · Sample data' : '') : 'Getting started · ' + step + ' of 4';
        wrap.appendChild(ctx.app.screenHeader(ctx.route, { eyebrow: eyebrow, title: title }));
        var body = stateKey === 'empty' ? stateEmpty() : stateKey === 'loading' ? stateLoading() : stateKey === 'error' ? stateError()
          : step === '1' ? step1() : step === '2' ? step2() : step === '3' ? step3() : step4();
        wrap.appendChild(h('div', { class: 'ob-stage' }, body));
        if (ctx.flags.prototypeBuild) wrap.appendChild(switcher());
        window.scrollTo(0, y);
        if (ui.focus) {
          var el = wrap.querySelector('[data-focus="' + ui.focus + '"]');
          ui.focus = null;
          if (el) el.focus();
        }
      }

      // ---------- pieces ----------
      function progress(n) {
        var dots = h('span', { class: 'ob-dots', 'aria-hidden': 'true' });
        for (var i = 1; i <= 4; i++) dots.appendChild(h('i', { class: i <= n ? 'on' : '' }));
        return h('div', { class: 'ob-progress' }, [h('p', { class: 'ob-count', text: n + ' of 4' }), dots]);
      }
      function linkBtn(text, to, cls) { return h('a', { class: 'btn' + (cls ? ' ' + cls : ''), href: to, text: text }); }
      function button(text, cls, focusKey, onClick) {
        var b = h('button', { type: 'button', class: 'btn' + (cls ? ' ' + cls : ''), text: text, 'data-focus': focusKey || null });
        b.addEventListener('click', onClick);
        return b;
      }
      function actions(kids) { return h('div', { class: 'ob-actions' }, kids); }
      function card(kids, cls) { return h('section', { class: 'card ob-card' + (cls ? ' ' + cls : ''), 'aria-labelledby': 'view-title' }, kids); }
      function msgEl() { return h('p', { class: 'ob-msg', role: 'status' }); }
      function noteEl() { return ui.note ? h('p', { class: ui.note.error ? 'fk-formerr' : 'fk-saved', role: ui.note.error ? 'alert' : 'status', text: ui.note.text }) : null; }
      function finish(to) {
        return store.setSettings({ onboardingDone: true }).then(function () { location.hash = to; }, function (e) { ui.note = { text: e.message, error: true }; draw(); });
      }
      function trySample(after) {
        return store.loadSample().then(function () { return after ? finish(after) : null; }, function (e) { ui.note = { text: e.message, error: true }; draw(); });
      }
      function passField(label, hint) {
        var f = K.field({ label: label, kind: 'text', cap: 'passphrase', hint: hint });
        f.input.type = 'password';
        f.input.setAttribute('autocomplete', 'new-password');
        f.input.setAttribute('spellcheck', 'false');
        return f;
      }

      // ---------- 1 of 4: what the app does ----------
      function step1() {
        // The reader's name is optional. It is saved when they press Continue (or Enter), and shown only at the top of the app.
        var who = K.field({ label: 'What should we call you?', kind: 'text', cap: 'displayName', optional: true, value: store.displayName(),
          hint: 'Shown at the top of the app, on this device only. Leave it blank to show nothing.' });
        who.input.setAttribute('spellcheck', 'false');
        var cont = linkBtn('Continue', BASE + '2');
        cont.addEventListener('click', function (e) {
          if (who.input.value.trim() === store.displayName()) return;
          e.preventDefault(); who.clear();
          store.setDisplayName(who.input.value).then(function () { location.hash = BASE + '2'; },
            function (err) { who.error(err.message); who.input.focus(); });
        });
        who.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); cont.click(); } });
        return card([
          progress(1),
          h('p', { class: 'ob-lead', text: 'You add the numbers. We add them up, draw them, and explain what each one means. We don’t move money, sell your data or tell you what to do with it.' }),
          h('p', { class: 'well ob-well', text: 'We teach and show. For choices about your own situation, a qualified professional can help.' }),
          who.el,
          actions([cont])
        ]);
      }

      // ---------- 2 of 4: where your numbers are kept, and the optional lock ----------
      function step2() {
        var st = store.status(), lock = store.settings().lock || {};
        var kids = [progress(2),
          h('div', { class: 'ob-fact' }, [
            h('span', { class: 'chip device' }, [h('span', { class: 'dot' }), 'On this device only']),
            h('p', { class: 'ob-lead', text: 'Nothing leaves this phone or computer. If you lose it, or clear the browser, your numbers are gone unless you save a backup.' })
          ])];
        if (st.notice) kids.push(h('p', { class: 'ob-lead', role: 'status', text: st.notice }));
        kids.push(h('h2', { class: 'ob-h2', text: 'Lock the app with a passphrase (optional)' }));
        if (st.backend === 'memory') {
          kids.push(h('p', { class: 'ob-lead', text: 'The lock needs this browser to save, and it isn’t letting this page save, so the lock can’t be turned on here.' }));
        } else if (lock.enabled) {
          kids.push(h('p', { class: 'ob-lead', text: 'The lock is on. The app locks after ' + lock.timeoutMin + ' minutes without use, when this tab closes, and each time it opens.' }));
        } else if (!ui.lockOpen) {
          kids.push(h('p', { class: 'ob-lead', text: 'With the lock on, everything you enter is encrypted on this device, and the app asks for your passphrase when it opens. It’s off unless you turn it on.' }));
          kids.push(actions([button('Set up the lock', 'small quiet', 'lock-setup', function () { ui.lockOpen = true; ui.focus = 'lock-warn'; draw(); })]));
        } else {
          kids.push(lockForm(st, lock));
        }
        kids.push(noteEl());
        kids.push(h('p', { class: 'fine', text: 'You can turn the lock on or off later in Settings.' }));
        kids.push(actions([linkBtn('Back', BASE + '1', 'quiet'), linkBtn('Continue', BASE + '3')]));
        return card(kids);
      }
      function lockForm(st, lock) {
        var p1 = passField('Passphrase', 'At least 12 characters; several unrelated words are easier to remember.');
        var p2 = passField('Type it again');
        var hint = h('p', { class: 'ob-strength', 'aria-live': 'polite' });
        p1.input.addEventListener('input', function () { hint.textContent = p1.input.value ? 'Strength, a hint, not a promise: ' + store.passphraseHint(p1.input.value).message : ''; });
        var mins = K.field({ label: 'Lock after this long without use', kind: 'select', value: String(lock.timeoutMin || 15), options: TIMEOUTS.map(function (m) { return [String(m), m + ' minutes']; }) });
        var err = h('p', { class: 'fk-formerr', role: 'alert' });
        err.hidden = true;
        var on = button('Turn on the lock', 'small', 'lock-on', function () {
          p1.clear(); p2.clear(); err.hidden = true; on.disabled = true;
          var min = Number(mins.input.value);
          store.enableLock(p1.input.value, p2.input.value).then(function () {
            return min !== store.settings().lock.timeoutMin ? store.setLockTimeout(min) : null;
          }).then(function () { ui.lockOpen = false; ui.note = { text: 'The lock is on.' }; ui.focus = 'lock-done'; draw(); }, function (e) {
            on.disabled = false;
            if (e.code === 'weak-passphrase') p1.error(e.message); else if (e.code === 'mismatch') p2.error(e.message); else { err.hidden = false; err.textContent = e.message; }
            K.focusFirstError(wrap);
          });
        });
        var backup = st.hasOwnData ? h('div', { class: 'ob-actions' }, h('a', { href: '#/settings/backup', class: 'btn small quiet', text: 'Save a backup with a passphrase' })) : null;
        return h('div', { class: 'ob-lock' }, [
          h('div', { class: 'ob-warn', tabindex: '-1', 'data-focus': 'lock-warn' }, [
            h('p', { class: 'ob-lead', text: 'If you forget your passphrase, nobody can recover your data, including us. Download a backup first.' }), backup
          ]),
          p1.el, hint, p2.el, mins.el, err,
          actions([on, button('Not now', 'small quiet', null, function () { ui.lockOpen = false; ui.focus = 'lock-setup'; draw(); })])
        ]);
      }

      // ---------- 3 of 4: a first account ----------
      function step3() {
        var st = store.status(), own = store.list('accounts').filter(function (a) { return a.source !== 'sample'; });
        var kids = [progress(3)];
        if (own.length) {
          kids.push(h('p', { class: 'ob-lead', text: own.length === 1 ? 'You have 1 account: ' + own[0].name + '.' : 'You have ' + own.length + ' accounts. You can add more, and change them, on the Accounts screen.' }));
        }
        kids.push(noteEl());
        kids.push(accountForm());
        var more = [h('a', { href: '#/transactions', text: 'Import a file instead' })];
        if (st.canLoadSample) more.push(button('Look around with sample data', 'small quiet', 'sample', function () { trySample(null).then(function () { ui.note = { text: 'Sample data added. You can remove it in one tap, from the bar at the top.' }; ui.focus = 'continue'; draw(); }); }));
        kids.push(h('div', { class: 'ob-more' }, more));
        var cont = linkBtn(own.length ? 'Continue' : 'Skip this', BASE + '4', own.length ? '' : 'quiet');
        cont.setAttribute('data-focus', 'continue');
        kids.push(actions([linkBtn('Back', BASE + '2', 'quiet'), cont]));
        return card(kids);
      }
      function accountForm() {
        var types = [];
        Sc.GROUPS.forEach(function (g) {
          Object.keys(Sc.ACCOUNT_TYPES).forEach(function (k) {
            var t = Sc.ACCOUNT_TYPES[k];
            if (t.group === g.id) types.push([k, t.label + (t.label === g.name ? '' : ' (' + g.name.toLowerCase() + ')')]);
          });
        });
        var f = {
          name: K.field({ label: 'Account name', kind: 'text', cap: 'name', hint: 'A name you’ll know it by, like “Everyday checking”.' }),
          type: K.field({ label: 'Type', kind: 'select', value: 'checking', options: types }),
          cents: K.field({ label: 'Balance today', kind: 'money', optional: true, hint: 'As your bank shows it.' })
        };
        f.name.input.setAttribute('data-focus', 'acct-name');
        function sync() {
          var debt = Sc.ACCOUNT_TYPES[f.type.input.value].debt;
          f.cents.el.querySelector('label').textContent = debt ? 'Amount you owe today (optional)' : 'Balance today (optional)';
          f.cents.el.querySelector('.fk-hint').textContent = debt ? 'What you owe, as your bank shows it.' : 'As your bank shows it; a minus sign if it’s overdrawn.';
        }
        f.type.input.addEventListener('change', sync);
        sync();
        var top = h('p', { class: 'fk-formerr', role: 'alert' });
        top.hidden = true;
        var save = button('Save account', 'small', 'acct-save', submit);
        var form = h('div', { class: 'ob-form', role: 'group', 'aria-label': 'Add an account' }, [top, f.name.el, f.type.el, f.cents.el, actions([save])]);
        form.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); submit(); } });
        return form;

        function submit() {
          Object.keys(f).forEach(function (k) { f[k].clear(); });
          top.hidden = true;
          var name = f.name.text(), t = f.type.input.value, r = f.cents.money();
          if (!name) f.name.error('Enter a name for the account.');
          if (!r.ok) f.cents.error(r.message);
          if (!name || !r.ok) { K.focusFirstError(form); return; }
          var cents = r.cents === null ? null : (Sc.ACCOUNT_TYPES[t].debt ? Math.abs(r.cents) : r.cents);
          save.disabled = true;
          store.add('accounts', { name: name, type: t }).then(function (a) {
            if (cents === null) return a;
            return store.add('balances', { accountId: a.id, date: store.today(), cents: cents }).then(function () { return a; },
              function (e) { return store.delete('accounts', a.id).then(function () { throw e; }); });
          }).then(function (a) {
            ui.note = { text: 'Saved “' + a.name + '”. You can add more on the Accounts screen.' };
            ui.focus = 'continue';
            draw();
          }, function (e) {
            save.disabled = false;
            if (!K.showErrors(e, { name: f.name, type: f.type, cents: f.cents }, top)) { top.hidden = false; top.textContent = e.message; }
            K.focusFirstError(form);
          });
        }
      }

      // ---------- 4 of 4: what to learn, and how to start ----------
      function step4() {
        var st = store.status(), picked = {};
        (store.settings().topics || []).forEach(function (t) { picked[t] = true; });
        var fs = h('fieldset', { class: 'ob-topics', 'aria-describedby': 'ob-pick' }, [h('legend', { class: 'sr-only', text: STEPS['4'] })]);
        lessons().forEach(function (l) {
          var cid = 'ob-topic-' + l.id;
          var input = h('input', { type: 'checkbox', id: cid, value: l.id, class: 'sr-only ob-check', 'data-focus': cid });
          input.checked = !!picked[l.id];
          input.addEventListener('change', function () {
            var now = lessons().map(function (x) { return x.id; }).filter(function (id) { var el = document.getElementById('ob-topic-' + id); return el && el.checked; });
            ui.focus = cid;
            store.setSettings({ topics: now }).catch(function (e) { ui.note = { text: e.message, error: true }; draw(); });
          });
          fs.appendChild(h('span', { class: 'ob-pill-wrap' }, [input, h('label', { for: cid, class: 'ob-pill', text: l.title })]));
        });
        var hasData = st.hasOwnData || st.hasSample;
        var ways = [button(hasData ? 'Go to my dashboard' : 'Start empty', '', 'start', function () { finish('#/overview'); })];
        if (st.canLoadSample) ways.push(button('Look around with sample data', 'quiet', 'sample', function () { trySample('#/overview'); }));
        ways.push(button('Restore from a backup', 'quiet', 'restore', function () { finish('#/settings/restore'); }));
        return card([
          progress(4),
          h('p', { class: 'fine body-note', id: 'ob-pick', text: 'Pick any. This only changes which lessons show first.' }),
          fs, noteEl(),
          h('div', { class: 'ob-ways' }, ways),
          actions([linkBtn('Back', BASE + '3', 'quiet')])
        ]);
      }

      // ---------- A3: dashboard states ----------
      function stateEmpty() {
        var s = dom.s, st = store.status();
        var art = s('svg', { class: 'ob-empty-art', viewBox: '0 0 120 50', width: '120', height: '50', 'aria-hidden': 'true', focusable: 'false' }, [
          s('path', { class: 'ob-art-base', d: 'M4 44 H116' }), s('path', { class: 'ob-art-line', d: 'M8 40 C40 38 60 30 112 12' })
        ]);
        var useSample = st.canLoadSample ? button('Look around with sample data', 'small quiet', 'sample', function () { trySample('#/overview'); })
          : h('a', { href: '#/overview', text: 'Go to Overview' });
        return card([
          h('p', { class: 'eyebrow', text: 'Empty' }), art,
          h('h2', { class: 'ob-state-h', text: 'No accounts yet' }),
          h('p', { class: 'ob-lead', text: 'Add one to see your net worth. Or look around with sample data, and delete it whenever you like.' }),
          actions([linkBtn('Add an account', BASE + '3')]),
          h('p', { class: 'ob-skip' }, useSample)
        ], 'ob-center');
      }
      function stateLoading() {
        return h('div', { class: 'ob-loading', 'aria-busy': 'true' }, [
          h('section', { class: 'card', 'aria-label': 'Net worth, loading' }, [
            h('p', { class: 'eyebrow', text: 'Loading' }),
            h('div', { class: 'skeleton ob-sk-a' }), h('div', { class: 'skeleton ob-sk-b' }), h('div', { class: 'skeleton ob-sk-c' })
          ]),
          h('section', { class: 'card', 'aria-label': 'Accounts, loading' }, [h('div', { class: 'skeleton ob-sk-d' }), h('div', { class: 'skeleton ob-sk-e' })]),
          h('p', { class: 'card ob-loading-msg', role: 'status', text: 'Adding up your accounts' })
        ]);
      }
      // Made-up figures (MF-6): marked "Sample data" on the card and in the screen's eyebrow.
      function stateError() {
        var msg = msgEl();
        function demo() { msg.textContent = ''; setTimeout(function () { msg.textContent = 'This is a sample of the card an import shows. Nothing was imported.'; }, 30); }
        return card([
          h('p', { class: 'eyebrow', text: 'Error: import · Sample data' }),
          h('h2', { class: 'ob-state-h', text: 'We couldn’t read 1 line of your file' }),
          h('p', { class: 'ob-lead', text: 'Line 14 has a date we don’t recognise: 31/02/2026. The other 212 lines are ready.' }),
          actions([button('Import 212 lines', 'small', null, demo), button('Look at line 14', 'small quiet', null, demo)]),
          msg,
          h('p', { class: 'fine', text: 'Nothing has been saved yet.' })
        ], 'ob-error');
      }

      // ---------- Prototype builds: every step and state, for reviewers ----------
      function switcher() {
        var ul = h('ul', { class: 'ob-switch', role: 'list' });
        ['1', '2', '3', '4'].forEach(function (n) { ul.appendChild(item(BASE + n, n + ' of 4', !stateKey && step === n)); });
        Object.keys(STATES).forEach(function (k) { ul.appendChild(item(BASE + 'state/' + k, k.charAt(0).toUpperCase() + k.slice(1) + ' state', stateKey === k)); });
        return h('nav', { class: 'card ob-nav', 'aria-labelledby': 'ob-nav-h' }, [h('h2', { id: 'ob-nav-h', text: 'Prototype: every onboarding step and state' }), ul]);
        function item(href, label, cur) {
          var a = h('a', { href: href, text: label });
          if (cur) a.setAttribute('aria-current', 'page');
          return h('li', {}, a);
        }
      }
    }
  });
})();
