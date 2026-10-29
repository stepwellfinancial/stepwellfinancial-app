/* Goals: the reader's own goals, kept on this device. Add, change and
   delete a goal, a sinking fund or an emergency fund (what it's for, the
   amount, what is already put aside, and an optional date). With a date, an
   illustration shows how much a month would reach it, with no interest or
   growth assumed. The emergency fund meter says how many months of the
   reader's own spending the amount put aside covers. It never says how many
   months anyone should have; no target is ours.

   PART 1 is pure (no DOM): figures in whole cents from store records with the
   calc module, so the test page can check it alone. "Today" is passed in.
   PART 2 is the screen; it uses the shared form kit, SW.formKit (js/dom.js). */
(function (root) {
  'use strict';
  var SW = root.SW = root.SW || {};

  function monthsBetween(a, b) { return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7)); }

  // goalModel(goal, today) -> progress, and the pace illustration when the goal has a date.
  // Pace: the month-ends from next month up to the last month-end on or before
  // the date. Each month is (target - saved) / months, rounded up to the cent;
  // the last month is whatever is left, so the months add up exactly.
  function goalModel(g, today) {
    var C = root.SWCalc;
    var left = Math.max(0, g.targetCents - g.savedCents), reached = g.savedCents >= g.targetCents;
    var out = { goal: g, leftCents: left, reached: reached, share: Math.min(1, g.savedCents / g.targetCents),
      pct: Math.min(100, C.divRound(g.savedCents * 100, g.targetCents)), pace: null, paceNote: null };
    if (!g.targetDate || reached) return out;
    var dateMonth = g.targetDate.slice(0, 7);
    var lastMonth = g.targetDate === C.monthEnd(dateMonth) ? dateMonth : C.addMonths(dateMonth, -1);
    var first = C.addMonths(today.slice(0, 7), 1);
    var n = monthsBetween(first, lastMonth) + 1;
    if (n < 1) { out.paceNote = 'past'; return out; }
    var per = C.divUp(left, n), last = left - per * (n - 1);
    if (last <= 0) { // tiny amounts: fewer months than the date allows would do it
      n = Math.ceil(left / per); last = left - per * (n - 1); lastMonth = C.addMonths(first, n - 1);
    }
    out.pace = { months: n, perCents: per, lastCents: last, fromMonth: first, toMonth: lastMonth, reachDate: C.monthEnd(lastMonth),
      checkCents: per * (n - 1) + last };
    return out;
  }

  // spendingBasis(transactions, categories, today) -> the reader's own spending
  // the emergency fund meter divides by: the average money out over the last 3
  // full months. The meter is ready only when each of those 3 months has
  // everyday spending lines (a spending category that is not a fee category).
  function spendingBasis(transactions, categories, today) {
    var C = root.SWCalc, now = today.slice(0, 7), months = [];
    var fee = {}; categories.forEach(function (c) { if (c.isFee) fee[c.id] = true; });
    for (var k = 3; k >= 1; k--) {
      var m = C.addMonths(now, -k), cf = C.cashFlowMonth(transactions, categories, m);
      months.push({ month: m, cents: cf.outCents, lines: cf.expense.reduce(function (s, x) { return s + x.count; }, 0),
        everyday: cf.expense.filter(function (x) { return !fee[x.categoryId]; }).reduce(function (s, x) { return s + x.count; }, 0) });
    }
    var ready = months.every(function (x) { return x.everyday > 0; });
    var total = months.reduce(function (s, x) { return s + x.cents; }, 0);
    return { months: months, ready: ready, missing: months.filter(function (x) { return !x.everyday; }).map(function (x) { return x.month; }),
      totalCents: total, avgCents: ready ? C.divRound(total, 3) : 0 };
  }

  // Months covered, to one decimal, half up: saved / spending a month.
  function monthsCovered(savedCents, avgCents) {
    if (!(avgCents > 0)) return null;
    var tenths = root.SWCalc.divRound(savedCents * 10, avgCents);
    return { tenths: tenths, text: (tenths / 10).toFixed(1) };
  }

  SW.models = SW.models || {};
  SW.models.goal = goalModel;
  SW.models.spendingBasis = spendingBasis;
  SW.models.monthsCovered = monthsCovered;
})(this);

/* PART 2: the screen. */
(function () {
  'use strict';
  var SW = window.SW;
  if (!SW || !SW.screens) return;

  var KINDS = [['goal', 'A goal'], ['sinking', 'A sinking fund'], ['emergency', 'An emergency fund']];
  var KIND_LABEL = { goal: 'Goal', sinking: 'Sinking fund', emergency: 'Emergency fund' };
  var SINKING = 'A sinking fund is a named goal for one cost you know is coming.';
  // What is open on this screen (a form and what has been typed in it, a
  // confirm box) outlives a repaint of the same screen, whoever repaints it.
  // Moving to another screen starts fresh.
  var keep = null;
  window.addEventListener('hashchange', function () { if (keep && keep.hash !== location.hash) keep = null; });

  SW.screens.register('goals', {
    render: function (wrap, ctx) {
      var store = ctx.store, C = ctx.calc, dom = ctx.dom, h = dom.h, K = SW.formKit;
      var M = function (c, o) { return dom.moneyCents(c, o); };
      var T = function (c, o) { return SW.fmt.money(c, o); };
      var state = keep && keep.hash === location.hash ? keep.state : { editing: null, confirm: null, note: null, focus: null, draft: null };
      keep = { hash: location.hash, state: state };
      var noteTimer = 0, reg = [];

      draw();
      return {
        // Hide amounts (a settings change) repaints every figure; an open form is
        // rebuilt with what was typed, so its money fields follow the setting.
        onStoreChange: function (ev) {
          var settings = ev && ev.stores && ev.stores.indexOf('settings') >= 0;
          if (settings || !state.editing) draw();
          return true;
        },
        destroy: function () { snapshot(); clearTimeout(noteTimer); }
      };

      // A form field whose typed value survives a repaint: F('name', field options).
      function F(name, o) {
        var d = state.draft && state.draft[name], opts = {};
        Object.keys(o).forEach(function (k) { opts[k] = o[k]; });
        if (d) opts.value = o.kind === 'money' ? (d.cents === undefined ? null : d.cents) : d.text;
        var f = K.field(opts);
        if (d && d.raw !== undefined) f.input.value = d.raw;
        reg.push({ name: name, f: f, kind: o.kind });
        return f;
      }
      function snapshot() {
        if (!reg.length) return;
        var d = {};
        reg.forEach(function (r) {
          if (!r.f.input.isConnected) return;
          if (r.kind === 'money') { var m = r.f.money(); d[r.name] = m.ok ? { cents: m.cents } : { raw: r.f.input.value }; }
          else d[r.name] = { text: r.f.input.value };
        });
        state.draft = d;
      }
      function closeForm() { state.editing = null; reg = []; state.draft = null; draw(); }
      // After a form or confirm closes, focus goes back to the button that opened it, or to the list.
      function focusAfter(selector, fallback) {
        state.focus = function () {
          var el = wrap.querySelector(selector) || wrap.querySelector(fallback);
          if (el) { if (!/^(A|BUTTON|INPUT|SELECT)$/.test(el.tagName) && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1'); el.focus(); }
        };
      }
      function cssq(s) { return String(s).replace(/["\\]/g, '\\$&'); }

      function monthName(m) { return C.monthLong(m).split(' ')[0]; }
      function monthRange(a, b) { return a === b ? C.monthLong(a) : (a.slice(0, 4) === b.slice(0, 4) ? monthName(a) : C.monthLong(a)) + ' to ' + C.monthLong(b); }
      function setNote(el) {
        state.note = el; clearTimeout(noteTimer);
        noteTimer = setTimeout(function () { state.note = null; var n = wrap.querySelector('.go-note'); if (n) dom.clear(n); }, 12000);
      }
      function fail(e) { setNote(h('p', { class: 'fk-formerr', role: 'alert', text: e.message })); draw(); }
      function bar(share) {
        var fill = h('span');
        fill.style.width = Math.max(0, Math.min(100, share * 100)).toFixed(1) + '%';
        return h('div', { class: 'go-meter', 'aria-hidden': 'true' }, fill);
      }

      function draw() {
        var y = window.scrollY;
        snapshot();
        reg = [];
        dom.clear(wrap);
        var st = store.status(), today = store.today();
        var goals = store.list('goals').slice().sort(function (a, b) {
          var o = { emergency: 0, goal: 1, sinking: 2 };
          return (o[a.kind] - o[b.kind]) || a.name.localeCompare(b.name);
        });
        wrap.appendChild(ctx.app.screenHeader(ctx.route, { eyebrow: C.dayLong(today) + (st.hasSample ? ' · Sample data' : '') }));
        wrap.appendChild(h('div', { class: 'go-note' }, state.note));
        var bar0 = h('section', { class: 'card go-bar', 'aria-label': 'Your goals' }, [
          h('p', { class: 'go-count', text: goals.length ? goals.length + (goals.length === 1 ? ' goal' : ' goals') + ' you set, each with its own amount.' : 'No goals yet.' }),
          state.editing === 'new' ? null : h('button', { type: 'button', class: 'btn small', text: 'New goal', on: { click: function () { state.editing = 'new'; state.draft = null; state.justOpened = 'new'; draw(); } } })
        ]);
        wrap.appendChild(bar0);
        if (state.editing === 'new') wrap.appendChild(h('section', { class: 'card go-formcard', 'aria-label': 'New goal' }, goalForm(null)));
        if (!goals.length && state.editing !== 'new') {
          wrap.appendChild(h('section', { class: 'card go-empty' }, [
            h('p', { class: 'go-read', text: 'A goal is a named amount, with a date if you have one. Add one with New goal, in your own words. Nothing here is a suggestion.' }),
            h('p', { class: 'go-read', text: SINKING }),
            st.canLoadSample ? h('div', { class: 'fk-actions' }, h('button', { type: 'button', class: 'btn small quiet', text: 'Look around with sample data', on: { click: function () { store.loadSample().catch(fail); } } })) : null
          ]));
        }
        var grid = h('div', { class: 'go-grid' });
        goals.forEach(function (g) {
          if (state.editing === g.id) { grid.appendChild(h('section', { class: 'card go-formcard go-wide', 'aria-label': 'Change ' + g.name }, goalForm(g))); return; }
          grid.appendChild(g.kind === 'emergency' ? emergencyCard(g, today) : goalCard(g, today));
        });
        wrap.appendChild(grid);
        state.draft = null;
        window.scrollTo(0, y);
        if (state.focus) { var f = state.focus; state.focus = null; f(); }
      }

      function actions(g) {
        var box = null;
        if (state.confirm === g.id) {
          var cb = K.confirmBox({ title: 'Delete “' + g.name + '”?', text: 'This removes the goal from this device. Your accounts and transactions stay as they are. You can’t undo this unless you have a backup.',
            yes: 'Delete goal', no: 'Keep it',
            onYes: function () { store['delete']('goals', g.id).then(function () { state.confirm = null; focusAfter('.go-bar button', '#view-title'); setNote(h('p', { class: 'fk-saved', role: 'status', text: 'Deleted “' + g.name + '”.' })); draw(); }, function (e) { state.confirm = null; fail(e); }); },
            onNo: function () { state.confirm = null; focusAfter('[aria-label="Delete ' + cssq(g.name) + '"]', '.go-bar button'); draw(); } });
          box = cb.el; state.focus = cb.focus;
        }
        return [h('div', { class: 'go-btns' }, [
          h('button', { type: 'button', class: 'linkbtn', text: 'Change', 'aria-label': 'Change ' + g.name, on: { click: function () { state.editing = g.id; state.draft = null; state.justOpened = g.id; draw(); } } }),
          h('button', { type: 'button', class: 'linkbtn', text: 'Delete', 'aria-label': 'Delete ' + g.name, on: { click: function () { state.confirm = g.id; draw(); } } })
        ]), box];
      }
      function amounts(G) {
        var g = G.goal;
        return h('p', { class: 'go-amt' }, [M(g.savedCents), h('span', { class: 'go-of' }, [' of ', M(g.targetCents), ' · ' + G.pct + '%'])]);
      }
      function asOf(g) { return g.savedAsOf ? 'Put aside, as you entered it on ' + C.dayLong(g.savedAsOf) + '.' : 'Put aside, as you entered it.'; }

      // The pace illustration (E2). Its figures are about future dates, so it says "illustration",
      // gives every input and the method, and says "would".
      function paceBlock(G) {
        var g = G.goal, p = G.pace;
        if (G.reached) return [h('p', { class: 'go-line', text: 'You reached the amount you set.' })];
        if (!g.targetDate) return [h('p', { class: 'go-line' }, [M(G.leftCents), ' to go to the amount you set. Add a date to see a monthly illustration.'])];
        if (!p) return [h('p', { class: 'go-line' }, [M(G.leftCents), ' to go. The date you set, ' + C.dayLong(g.targetDate) + ', has no month-end left after this month, so there is no monthly illustration.'])];
        var even = p.lastCents === p.perCents;
        return [h('div', { class: 'well go-illus' }, [
          h('p', { class: 'go-ill-h', text: 'Illustration' }),
          h('p', { class: 'go-line' }, ['If you put in ', M(p.perCents), ' at the end of each month from ' + monthRange(p.fromMonth, p.toMonth) + ' (' + p.months + (p.months === 1 ? ' month' : ' months') + '), with no interest, ',
            even ? '' : ['the last month would be ', M(p.lastCents), ', and '],
            'the goal would reach ', M(g.targetCents), ' on ' + C.dayLong(p.reachDate) + '.']),
          h('p', { class: 'fine body-note' }, ['How this works: (', M(g.targetCents), ' − ', M(g.savedCents), ') ÷ ' + p.months + ' months = ', M(p.perCents),
            even ? '' : ', rounded up to the cent; the last month is what is left',
            '. Months are counted from next month to the last month-end on or before ' + C.dayLong(g.targetDate) + '. Nothing is added for interest or growth. Not a prediction.']),
          h('p', { class: 'fine', text: 'For education only, not financial advice.' })
        ])];
      }

      // ---------- A goal or a sinking fund ----------
      function goalCard(g, today) {
        var G = SW.models.goal(g, today), id = dom.id('go-h');
        var card = h('section', { class: 'card go-card', 'aria-labelledby': id });
        card.appendChild(h('div', { class: 'card-h' }, [h('h2', { id: id, text: g.name }),
          h('span', { class: 'eyebrow', text: KIND_LABEL[g.kind] + (g.targetDate ? ', by ' + C.dayLong(g.targetDate) : '') })]));
        card.appendChild(amounts(G));
        card.appendChild(bar(G.share));
        card.appendChild(h('p', { class: 'fine', text: asOf(g) }));
        paceBlock(G).forEach(function (n) { card.appendChild(n); });
        if (g.kind === 'sinking') card.appendChild(h('p', { class: 'fine', text: SINKING }));
        actions(g).forEach(function (n) { if (n) card.appendChild(n); });
        card.appendChild(h('p', { class: 'note', text: 'Amounts you entered; the amount to go is what you set minus what is put aside. For education only, not financial advice.' }));
        return card;
      }

      // ---------- The emergency fund meter ----------
      function emergencyCard(g, today) {
        var G = SW.models.goal(g, today), id = dom.id('go-h');
        var S = SW.models.spendingBasis(store.list('transactions'), store.list('categories'), today);
        var cov = S.ready ? SW.models.monthsCovered(g.savedCents, S.avgCents) : null;
        var card = h('section', { class: 'card go-card go-ef go-wide', 'aria-labelledby': id });
        card.appendChild(h('div', { class: 'card-h' }, [h('h2', { id: id, text: g.name }), h('span', { class: 'eyebrow', text: 'Emergency fund · the amount you set' })]));
        card.appendChild(amounts(G));
        card.appendChild(bar(G.share));
        card.appendChild(h('p', { class: 'fine', text: asOf(g) }));
        var range = monthRange(S.months[0].month, S.months[2].month);
        if (cov) {
          card.appendChild(h('p', { class: 'go-line go-cover' }, ['Covers about ' + cov.text + ' months of your own spending (', M(S.avgCents), ' a month, your average for ' + range + ').']));
          card.appendChild(h('p', { class: 'fine' }, [M(g.savedCents), ' ÷ ', M(S.avgCents), ' = ' + cov.text + ' months, to one decimal.']));
          var btn = h('button', { type: 'button', class: 'explain', text: 'Show the parts', 'aria-label': 'Show the parts of your spending a month' });
          var panel = h('div', { class: 'explainer' }, [
            h('h3', { text: 'Your spending, by month' }),
            h('div', {}, S.months.map(function (x) {
              return h('div', { class: 'li' }, [h('span', {}, [C.monthLong(x.month), h('span', { class: 'sub', text: x.lines + (x.lines === 1 ? ' line' : ' lines') })]), h('span', { class: 'amt' }, M(x.cents))]);
            })),
            h('p', { class: 'fine body-note' }, ['Total ', M(S.totalCents), ' ÷ 3 = ', M(S.avgCents), ' a month, half up to the cent. Spending is money out in your spending categories, as on Cash flow.'])
          ]);
          dom.disclosure(btn, panel);
          card.appendChild(h('div', { class: 'go-foot' }, [btn]));
          card.appendChild(panel);
        } else {
          card.appendChild(h('p', { class: 'go-line', text: 'This needs 3 full months of your spending in your transactions, ' + range + '. It shows how many months the amount put aside covers once each of those months has spending lines.' }));        }
        if (g.targetDate) paceBlock(G).forEach(function (n) { card.appendChild(n); });
        actions(g).forEach(function (n) { if (n) card.appendChild(n); });
        card.appendChild(h('p', { class: 'note', text: 'Months covered describes your own numbers; it is not a target. For education only, not financial advice.' }));
        return card;
      }

      // ---------- New goal, or change one ----------
      function goalForm(g) {
        var box = h('div', { class: 'go-form' });
        var formErr = h('p', { class: 'fk-formerr', role: 'alert' }); formErr.hidden = true;
        var f = {
          name: F('goal.name', { label: 'What it’s for', kind: 'text', value: g ? g.name : '' }),
          kind: F('goal.kind', { label: 'Kind', kind: 'select', value: g ? g.kind : 'goal', options: KINDS }),
          targetCents: F('goal.target', { label: 'Amount you’re aiming for', kind: 'money', value: g ? g.targetCents : null }),
          savedCents: F('goal.saved', { label: 'Already put aside', kind: 'money', value: g ? g.savedCents : null, optional: true }),
          targetDate: F('goal.date', { label: 'By', kind: 'date', value: g && g.targetDate ? g.targetDate : '', optional: true })
        };
        var back = function () { focusAfter(g ? '[aria-label="Change ' + cssq(g.name) + '"]' : '.go-bar button', '.go-bar button'); closeForm(); };
        var preview = h('div', { class: 'go-preview', 'aria-live': 'polite' });
        var kindNote = h('p', { class: 'fine' });
        function refresh() {
          dom.clear(preview);
          kindNote.textContent = f.kind.input.value === 'sinking' ? SINKING : '';
          var t = f.targetCents.money(), s = f.savedCents.money(), d = f.targetDate.input.value;
          if (!t.ok || !s.ok || !(t.cents > 0) || !d || !window.SWSchema.isDate(d)) return;
          var G = SW.models.goal({ targetCents: t.cents, savedCents: s.cents || 0, targetDate: d }, store.today());
          paceBlock(G).forEach(function (n) { preview.appendChild(n); });
        }
        ['input', 'change'].forEach(function (ev) { box.addEventListener(ev, refresh); });
        var save = h('button', { type: 'button', class: 'btn small', text: 'Save goal' });
        var cancel = h('button', { type: 'button', class: 'btn small quiet', text: 'Cancel', on: { click: back } });
        save.addEventListener('click', function () {
          formErr.hidden = true; Object.keys(f).forEach(function (k) { f[k].clear(); });
          var bad = false, name = f.name.text(), t = f.targetCents.money(), s = f.savedCents.money(), d = f.targetDate.input.value;
          if (!name) { f.name.error('Enter what it’s for.'); bad = true; }
          if (!t.ok) { f.targetCents.error(t.message); bad = true; } else if (t.cents <= 0) { f.targetCents.error('Use an amount above $0.00.'); bad = true; }
          if (!s.ok) { f.savedCents.error(s.message); bad = true; } else if (s.cents !== null && s.cents < 0) { f.savedCents.error('Use an amount of $0.00 or more.'); bad = true; }
          if (d && !window.SWSchema.isDate(d)) { f.targetDate.error('That date doesn’t exist. Check the day and month.'); bad = true; }
          if (bad) { K.focusFirstError(box); return; }
          var saved = s.cents === null ? 0 : s.cents;
          var fields = { name: name, kind: f.kind.input.value, targetCents: t.cents, savedCents: saved, targetDate: d || null,
            savedAsOf: g && g.savedCents === saved ? g.savedAsOf : store.today() };
          var before = g ? { name: g.name, kind: g.kind, targetCents: g.targetCents, savedCents: g.savedCents, targetDate: g.targetDate, savedAsOf: g.savedAsOf } : null;
          save.disabled = true;
          (g ? store.update('goals', g.id, fields) : store.add('goals', fields)).then(function (rec) {
            state.editing = null; reg = []; state.draft = null;
            focusAfter('[aria-label="Change ' + cssq(name) + '"]', '.go-bar button');
            setNote(K.savedNote('Saved “' + name + '”.', function () { (g ? store.update('goals', g.id, before) : store['delete']('goals', rec.id)).catch(fail); }));
            draw();
          }, function (err) { save.disabled = false; K.showErrors(err, f, formErr); K.focusFirstError(box); });
        });
        box.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') back();
          if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save.click(); }
        });
        box.appendChild(h('h2', { text: g ? 'Change “' + g.name + '”' : 'New goal' }));
        box.appendChild(h('p', { class: 'fine body-note', text: 'Your own amount and date. Nothing here is a suggestion.' }));
        box.appendChild(formErr);
        box.appendChild(h('div', { class: 'go-form-grid' }, [f.name.el, f.kind.el, f.targetCents.el, f.savedCents.el, f.targetDate.el]));
        box.appendChild(kindNote);
        box.appendChild(preview);
        box.appendChild(h('div', { class: 'fk-actions' }, [save, cancel]));
        refresh();
        if (state.justOpened === state.editing) { state.justOpened = null; state.focus = function () { f.name.input.focus(); }; }
        return box;
      }
    }
  });
})();
