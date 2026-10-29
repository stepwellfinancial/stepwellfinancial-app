/* Budget: the reader's own monthly budget, kept on this device.
   Set an amount for each category for a month (or copy last month's), see
   the month at a glance (two plain bars, no score), each category against
   what was set, and the money "not yet given a job", every part shown.
   Also "Give your pay a job": split one pay into named jobs, and the income
   the month's budget needs per pay.

   PART 1 (pure, no DOM) works the figures out from store records with the
   calc module, in whole cents, so the test page can check it alone.
   PART 2 is the screen. */
(function (root) {
  'use strict';
  var SW = root.SW = root.SW || {};

  function daysIn(month) { return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate(); }

  // budgetModel({ categories, transactions, budget, month, today, payFrequency })
  function budgetModel(o) {
    var C = root.SWCalc, month = o.month, nowMonth = o.today.slice(0, 7);
    var bm = C.budgetMonth(o.budget || null, o.transactions, o.categories, month);
    var cf = C.cashFlowMonth(o.transactions, o.categories, month);
    var days = daysIn(month);
    var gone = month < nowMonth ? days : month > nowMonth ? 0 : Number(o.today.slice(8, 10));
    var spent = bm.lines.reduce(function (s, l) { return s + l.actualCents; }, 0);
    var targets = bm.targetsCents;
    var inMonth = o.transactions.filter(function (t) { return t.date.slice(0, 7) === month; });
    function partsFor(categoryId) {
      var out = [];
      inMonth.forEach(function (t) {
        var c = C.partsOf(t).filter(function (p) { return p.categoryId === categoryId; }).reduce(function (s, p) { return s + p.cents; }, 0);
        var hit = C.partsOf(t).some(function (p) { return p.categoryId === categoryId; });
        if (hit) out.push({ id: t.id, date: t.date, payee: t.payee, cents: c, split: !!(t.splits && t.splits.length) });
      });
      out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
      return out;
    }
    var lines = bm.lines.map(function (l) {
      var parts = partsFor(l.categoryId);
      return { categoryId: l.categoryId, name: l.name, targetCents: l.targetCents, actualCents: l.actualCents, leftCents: l.leftCents,
        direction: l.direction, parts: parts, partsCents: -parts.reduce(function (s, p) { return s + p.cents; }, 0) };
    });
    var unbudgeted = bm.unbudgeted.map(function (u) {
      var parts = partsFor(u.categoryId);
      return { categoryId: u.categoryId, name: u.name, actualCents: u.actualCents, parts: parts, partsCents: -parts.reduce(function (s, p) { return s + p.cents; }, 0) };
    });
    var payFreq = o.payFrequency || 'monthly';
    return {
      month: month, days: days, gone: gone, hasBudget: !!o.budget,
      plannedIncomeCents: bm.plannedIncomeCents, targetsCents: targets, notYetGivenAJobCents: bm.notYetGivenAJobCents,
      spentCents: spent, unbudgetedCents: unbudgeted.reduce(function (s, u) { return s + u.actualCents; }, 0),
      moneyInCents: cf.inCents, moneyOutCents: cf.outCents, income: cf.income, uncategorised: cf.uncategorised,
      pctMonth: C.divRound(gone * 100, days), pctBudget: targets > 0 ? C.divRound(spent * 100, targets) : null,
      shareMonth: gone / days, shareBudget: targets > 0 ? spent / targets : 0,
      lines: lines, unbudgeted: unbudgeted, budgetLines: o.budget ? o.budget.lines : [],
      needs: targets > 0 ? C.perMonthAndPay([{ cents: targets, frequency: 'monthly' }], payFreq) : null, payFrequency: payFreq
    };
  }

  // payPlanModel(plan, targetsCents) -> the split, what is left, and the
  // budget's monthly total per pay at this plan's frequency.
  function payPlanModel(plan, targetsCents) {
    var C = root.SWCalc;
    var given = plan.buckets.reduce(function (s, b) { return s + b.cents; }, 0);
    return {
      givenCents: given, leftCents: plan.payCents - given,
      needs: targetsCents > 0 ? C.perMonthAndPay([{ cents: targetsCents, frequency: 'monthly' }], plan.frequency) : null
    };
  }

  SW.models = SW.models || {};
  SW.models.budget = budgetModel;
  SW.models.payPlan = payPlanModel;
})(this);

/* PART 2: the screen. It uses the shared form kit, SW.formKit (js/dom.js). */
(function () {
  'use strict';
  var SW = window.SW;
  if (!SW || !SW.screens) return;

  var FREQ_LABEL = { weekly: 'Every week', biweekly: 'Every 2 weeks', semimonthly: 'Twice a month', monthly: 'Every month' };
  var FREQ_PER_YEAR = { weekly: '52', biweekly: '26', semimonthly: '24', monthly: '12' };
  var JOB_TOKENS = ['cash', 'invest', 'property', 'other'];

  function monthFromHash(today) {
    var m = /[?&]month=(\d{4}-\d{2})(?:&|$)/.exec(location.hash || '');
    if (m && window.SWSchema.isDate(m[1] + '-01')) return m[1];
    return today.slice(0, 7);
  }

  // What is open on this screen (a form and what has been typed in it, a
  // confirm box) outlives a repaint of the same screen, whoever repaints it.
  // Moving to another screen or month starts fresh.
  var keep = null;
  window.addEventListener('hashchange', function () { if (keep && keep.hash !== location.hash) keep = null; });

  SW.screens.register('budget', {
    render: function (wrap, ctx) {
      var store = ctx.store, C = ctx.calc, dom = ctx.dom, h = dom.h, K = SW.formKit;
      var M = function (c, o) { return dom.moneyCents(c, o); };
      var T = function (c, o) { return SW.fmt.money(c, o); };
      var state = keep && keep.hash === location.hash ? keep.state : { month: monthFromHash(store.today()), editing: null, note: null, confirm: null, draft: null, focus: null };
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
          if (r.custom) { d[r.name] = { list: r.custom() }; return; }
          if (!r.f.input.isConnected) return;
          if (r.kind === 'money') { var m = r.f.money(); d[r.name] = m.ok ? { cents: m.cents } : { raw: r.f.input.value }; }
          else d[r.name] = { text: r.f.input.value };
        });
        state.draft = d;
      }
      function forget(prefix) { reg = reg.filter(function (r) { return prefix && r.name.indexOf(prefix) !== 0; }); if (!prefix) state.draft = null; }
      function closeForm() { state.editing = null; forget(); draw(); }

      function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
      function monthName(m) { return C.monthLong(m).split(' ')[0]; }
      function link(m) { return '#/budget?month=' + m; }
      function setNote(el) {
        state.note = el;
        clearTimeout(noteTimer);
        noteTimer = setTimeout(function () { state.note = null; var n = wrap.querySelector('.bu-note'); if (n) dom.clear(n); }, 12000);
      }
      function bar(share, cls) {
        var fill = h('span', { class: cls });
        fill.style.width = Math.max(0, Math.min(100, share * 100)).toFixed(1) + '%';
        return h('div', { class: 'bu-bar', 'aria-hidden': 'true' }, fill);
      }

      function draw() {
        var y = window.scrollY;
        snapshot();
        reg = [];
        dom.clear(wrap);
        var st = store.status();
        var KORDER = { expense: 0, income: 1, transfer: 2 };
        var cats = store.list('categories').sort(function (a, b) { return (KORDER[a.kind] - KORDER[b.kind]) || a.name.localeCompare(b.name); });
        var txs = store.list('transactions');
        var budget = store.budgetFor(state.month), prevMonth = C.addMonths(state.month, -1), prev = store.budgetFor(prevMonth);
        var settings = store.settings() || {};
        var B = SW.models.budget({ categories: cats, transactions: txs, budget: budget, month: state.month, today: store.today(), payFrequency: settings.payFrequency });
        var sampleHere = st.hasSample;

        wrap.appendChild(ctx.app.screenHeader(ctx.route, { eyebrow: C.monthLong(state.month) + (sampleHere ? ' · Sample data' : ''), title: monthName(state.month) + ' budget' }));
        wrap.appendChild(monthNav());
        wrap.appendChild(h('div', { class: 'bu-note' }, state.note));
        if (state.editing === 'amounts') wrap.appendChild(amountsForm(cats, budget));

        var left = h('div', { class: 'bu-col' }), right = h('div', { class: 'bu-col' });
        wrap.appendChild(h('div', { class: 'bu-grid' }, [left, right]));
        left.appendChild(glanceCard(B, budget, prev, prevMonth, st));
        left.appendChild(noJobCard(B));
        left.appendChild(payCard(B));
        right.appendChild(categoriesCard(B));
        right.appendChild(manageCard(cats));
        state.draft = null;
        window.scrollTo(0, y);
        if (state.confirm) { var c = wrap.querySelector('.fk-confirm'); if (c && state.confirmFocus) { state.confirmFocus(); state.confirmFocus = null; } }
        else if (state.focus) { var fo = state.focus; state.focus = null; var el = typeof fo === 'string' ? wrap.querySelector(fo) : null; if (el) el.focus(); else if (typeof fo === 'function') fo(); }
      }
      // After a confirm closes, focus goes back to the button that opened it, or to the list.
      function focusAfter(selector, fallback) { state.focus = function () { var el = wrap.querySelector(selector) || wrap.querySelector(fallback); if (el) { if (!el.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT)$/.test(el.tagName)) el.setAttribute('tabindex', '-1'); el.focus(); } }; }
      function cssq(s) { return String(s).replace(/["\\]/g, '\\$&'); }

      // ---------- Month switcher ----------
      function monthNav() {
        var now = store.today().slice(0, 7);
        return h('nav', { class: 'card bu-months', 'aria-label': 'Choose a month' }, [
          h('a', { class: 'btn small quiet', href: link(C.addMonths(state.month, -1)), text: '← ' + C.monthLong(C.addMonths(state.month, -1)) }),
          h('p', { class: 'bu-month-now', text: C.monthLong(state.month) }),
          h('a', { class: 'btn small quiet', href: link(C.addMonths(state.month, 1)), text: C.monthLong(C.addMonths(state.month, 1)) + ' →' }),
          state.month !== now ? h('a', { class: 'small-link', href: link(now), text: 'This month' }) : null
        ]);
      }

      // ---------- The month at a glance ----------
      function glanceCard(B, budget, prev, prevMonth, st) {
        var card = h('section', { class: 'card bu-glance', 'aria-labelledby': 'bu-g-h' });
        card.appendChild(h('div', { class: 'card-h' }, [h('h2', { id: 'bu-g-h', text: 'The month at a glance' }),
          h('button', { type: 'button', class: 'btn small', text: budget ? 'Change amounts' : 'Set amounts', on: { click: function () { state.editing = 'amounts'; state.draft = null; draw(); var f = wrap.querySelector('.bu-form input'); if (f) f.focus(); } } })]));
        if (!budget) {
          card.appendChild(h('p', { class: 'bu-read', text: 'No amounts are set for ' + C.monthLong(B.month) + ' yet. Set an amount for each category you want to keep track of.' }));
          var acts = h('div', { class: 'fk-actions' });
          if (prev) acts.appendChild(h('button', { type: 'button', class: 'btn small quiet', text: 'Copy ' + monthName(prevMonth) + '’s amounts', on: { click: function () { copyLast(prevMonth); } } }));
          if (st.canLoadSample) acts.appendChild(h('button', { type: 'button', class: 'btn small quiet', text: 'Look around with sample data', on: { click: function () { store.loadSample().catch(function (e) { setNote(h('p', { class: 'fk-formerr', text: e.message })); draw(); }); } } }));
          if (acts.childNodes.length) card.appendChild(acts);
          if (B.moneyOutCents) card.appendChild(h('p', { class: 'fine body-note' }, ['Spending in ' + monthName(B.month) + ' so far: ', M(B.moneyOutCents), '. It is listed under Categories.']));
          card.appendChild(h('p', { class: 'note', text: 'Spending you entered or imported for ' + C.monthLong(B.month) + '. For education only, not financial advice.' }));
          return card;
        }
        card.appendChild(h('div', { class: 'bu-meter' }, [
          h('p', { class: 'bu-meter-l' }, ['Month gone: ' + B.gone + ' of ' + B.days + ' days', h('span', { class: 'bu-pct', text: B.pctMonth + '%' })]),
          bar(B.shareMonth, 'bu-fill-muted')
        ]));
        card.appendChild(h('div', { class: 'bu-meter' }, [
          h('p', { class: 'bu-meter-l' }, [h('span', {}, ['Budget used: ', M(B.spentCents), ' of ', M(B.targetsCents)]), h('span', { class: 'bu-pct', text: B.pctBudget === null ? '' : B.pctBudget + '%' })]),
          bar(B.shareBudget, 'bu-fill-ink')
        ]));
        card.appendChild(h('p', { class: 'bu-read', text: B.pctBudget === null
          ? B.pctMonth + '% of the month is gone. The amounts you set add to $0.00.'
          : B.pctMonth + '% of the month is gone and ' + B.pctBudget + '% of the budget is used.' }));
        var btn = h('button', { type: 'button', class: 'explain', text: 'What makes this up?' });
        var panel = h('div', { class: 'explainer' }, [
          h('h3', { text: 'Spending in the categories you set amounts for' }),
          h('div', {}, B.lines.map(function (l) {
            return h('div', { class: 'li' }, [h('span', { text: l.name }), h('span', { class: 'amt' }, [M(l.actualCents), ' of ', M(l.targetCents)])]);
          })),
          h('p', { class: 'bu-sum' }, ['Total ', M(B.spentCents), ' of ', M(B.targetsCents)]),
          h('p', { class: 'fine body-note', text: 'The month bar is days gone divided by days in the month. The budget bar is that spending divided by the amounts you set. Both are pictures of your own numbers, not a score.' })
        ]);
        dom.disclosure(btn, panel);
        card.appendChild(h('div', { class: 'bu-foot' }, btn));
        card.appendChild(panel);
        card.appendChild(h('p', { class: 'note', text: 'Spending you entered or imported for ' + C.monthLong(B.month) + '. For education only, not financial advice.' }));
        return card;
      }

      // ---------- Not yet given a job ----------
      function noJobCard(B) {
        var card = h('section', { class: 'card bu-nojob', 'aria-labelledby': 'bu-n-h' });
        card.appendChild(h('h2', { id: 'bu-n-h', text: 'Not yet given a job' }));
        if (!B.hasBudget) {
          card.appendChild(h('p', { class: 'bu-read', text: 'Once you enter the income you expect this month and the amounts for your categories, this shows the money no amount has claimed yet.' }));
          return card;
        }
        var left = B.notYetGivenAJobCents;
        card.appendChild(h('p', { class: 'bu-big' }, left < 0 ? [M(-left), h('span', { class: 'bu-big-sub', text: ' more than planned income' })] : M(left)));
        card.appendChild(h('p', { class: 'bu-eq' }, left < 0
          ? [M(-left), ' more than the income you entered: ', M(B.plannedIncomeCents), ' expected, and ', M(B.targetsCents), ' of amounts set.']
          : [M(left), ' not yet given a job: ', M(B.plannedIncomeCents), ' expected in, minus ', M(B.targetsCents), ' of amounts set.']));
        card.appendChild(h('p', { class: 'fine body-note', text: 'It is the money you expect in that no amount has claimed yet. It is a sum, not a judgement.' }));
        var btn = h('button', { type: 'button', class: 'explain', text: 'What makes this up?' });
        var panel = h('div', { class: 'explainer' }, [
          h('h3', { text: 'How this is worked out' }),
          h('div', { class: 'li' }, [h('span', { text: 'Income you expect in ' + monthName(B.month) }), h('span', { class: 'amt' }, M(B.plannedIncomeCents))]),
          h('h4', { class: 'bu-h4', text: 'Amounts you set' }),
          h('div', {}, B.lines.map(function (l) { return h('div', { class: 'li' }, [h('span', { text: l.name }), h('span', { class: 'amt' }, M(l.targetCents))]); })),
          h('p', { class: 'bu-sum' }, ['Total ', M(B.targetsCents)]),
          h('p', { class: 'bu-sum bu-final' }, [M(B.plannedIncomeCents), ' − ', M(B.targetsCents), ' = ', M(left)]),
          h('p', { class: 'fine' }, ['Money in so far this month, for comparison: ', M(B.moneyInCents),
            B.income.length ? ' (' + B.income.map(function (x) { return x.name + ' ' + T(x.cents); }).join(', ') + ').' : '.'])
        ]);
        dom.disclosure(btn, panel);
        card.appendChild(h('div', { class: 'bu-foot' }, btn));
        card.appendChild(panel);
        card.appendChild(h('p', { class: 'note', text: 'Worked out from the income and amounts you entered. For education only, not financial advice.' }));
        return card;
      }

      // ---------- Categories ----------
      function partsPanel(name, parts, total) {
        return h('div', { class: 'explainer bu-lines' }, [
          h('h3', { text: name + ', ' + C.monthLong(state.month) }),
          parts.length ? h('div', {}, parts.map(function (p) {
            return h('div', { class: 'li' }, [h('span', {}, [p.payee, h('span', { class: 'sub', text: C.dayLong(p.date) + (p.split ? ' · part of a split line' : '') })]), h('span', { class: 'amt' }, M(-p.cents))]);
          })) : h('p', { class: 'fine', text: 'No lines in this category this month.' }),
          h('p', { class: 'bu-sum' }, [plural(parts.length, 'line', 'lines') + ', total ', M(total)])
        ]);
      }
      function categoriesCard(B) {
        var card = h('section', { class: 'card bu-cats', 'aria-labelledby': 'bu-c-h' });
        card.appendChild(h('div', { class: 'card-h' }, [h('h2', { id: 'bu-c-h', text: 'Categories' }), h('span', { class: 'eyebrow', text: 'Spent in ' + C.monthLong(B.month) + ', of what you set' })]));
        if (!B.lines.length && !B.unbudgeted.length) {
          card.appendChild(h('p', { class: 'bu-read', text: 'Nothing to show for this month yet. Add transactions, or set amounts for your categories.' }));
          return card;
        }
        var ul = h('ul', { class: 'bu-list', role: 'list' });
        B.lines.forEach(function (l) {
          var over = l.direction === 'over';
          var words = l.direction === 'on' ? 'The same as you set' : over ? T(-l.leftCents) + ' more than you set' : T(l.leftCents) + ' under what you set';
          var btn = h('button', { type: 'button', class: 'linkbtn', text: 'Show the parts', 'aria-label': 'Show the parts of ' + l.name });
          var panel = partsPanel(l.name, l.parts, l.partsCents);
          dom.disclosure(btn, panel);
          ul.appendChild(h('li', { class: 'bu-cat' }, [
            h('div', { class: 'bu-cat-top' }, [h('span', { class: 'bu-cat-name', text: l.name }), h('span', { class: 'amt' }, [M(l.actualCents), h('span', { class: 'bu-of' }, [' of ', M(l.targetCents)])])]),
            bar(l.targetCents > 0 ? l.actualCents / l.targetCents : (l.actualCents > 0 ? 1 : 0), over ? 'bu-fill-ink' : 'bu-fill-ledger'),
            h('div', { class: 'bu-cat-sub' }, [h('span', {}, [plural(l.parts.length, 'line', 'lines') + ' · ', h('span', { class: over ? 'bu-over' : '', text: words })]), btn]),
            panel
          ]));
        });
        card.appendChild(ul);
        if (B.lines.length) card.appendChild(h('p', { class: 'bu-total' }, [h('span', { text: 'All amounts set' }), h('span', { class: 'amt' }, [M(B.spentCents), h('span', { class: 'bu-of' }, [' of ', M(B.targetsCents)])])]));
        if (B.unbudgeted.length) {
          card.appendChild(h('h3', { class: 'bu-h3', text: 'Spending with no amount set' }));
          var ul2 = h('ul', { class: 'bu-list', role: 'list' });
          B.unbudgeted.forEach(function (u) {
            var btn = h('button', { type: 'button', class: 'linkbtn', text: 'Show the parts', 'aria-label': 'Show the parts of ' + u.name });
            var panel = partsPanel(u.name, u.parts, u.partsCents);
            dom.disclosure(btn, panel);
            ul2.appendChild(h('li', { class: 'bu-cat' }, [
              h('div', { class: 'bu-cat-top' }, [h('span', { class: 'bu-cat-name', text: u.name }), h('span', { class: 'amt' }, M(u.actualCents))]),
              h('div', { class: 'bu-cat-sub' }, [h('span', { text: plural(u.parts.length, 'line', 'lines') }), btn]), panel
            ]));
          });
          card.appendChild(ul2);
          card.appendChild(h('p', { class: 'bu-total' }, [h('span', { text: 'Total with no amount set' }), h('span', { class: 'amt' }, M(B.unbudgetedCents))]));
        }
        if (B.uncategorised.count) card.appendChild(h('p', { class: 'fine body-note' }, [plural(B.uncategorised.count, 'line has', 'lines have') + ' no category yet (', M(B.uncategorised.cents, { sign: true }), '). Give ' + (B.uncategorised.count === 1 ? 'it' : 'them') + ' one in Transactions.']));
        card.appendChild(h('p', { class: 'note body-note', text: 'Each total adds up the lines you entered or imported. A bar drawn in ink went over the amount you set. For education only, not financial advice.' }));
        return card;
      }

      // ---------- Set amounts ----------
      function amountsForm(cats, budget) {
        var card = h('section', { class: 'card bu-form', 'aria-labelledby': 'bu-f-h' });
        var current = {};
        (budget ? budget.lines : []).forEach(function (l) { current[l.categoryId] = l.targetCents; });
        card.appendChild(h('h2', { id: 'bu-f-h', text: 'Amounts for ' + C.monthLong(state.month) }));
        card.appendChild(h('p', { class: 'fk-intro', text: 'Type the amount you want to keep track of for each category. Leave one empty to keep it out of this month’s budget. Nothing here is a suggestion.' }));
        var formErr = h('p', { class: 'fk-formerr', role: 'alert' });
        formErr.hidden = true;
        var income = F('income', { label: 'Income you expect this month', kind: 'money', value: budget ? budget.plannedIncomeCents : null, optional: true, hint: 'Used for “not yet given a job”.' });
        var rows = [];
        var grid = h('div', { class: 'bu-form-grid' });
        cats.filter(function (c) { return c.kind === 'expense'; }).forEach(function (c) {
          var f = F('cat.' + c.id, { label: c.name, kind: 'money', value: current[c.id] === undefined ? null : current[c.id], optional: true });
          rows.push({ cat: c, f: f });
          grid.appendChild(f.el);
        });
        var save = h('button', { type: 'button', class: 'btn', text: 'Save amounts' });
        var cancel = h('button', { type: 'button', class: 'btn quiet', text: 'Cancel' });
        cancel.addEventListener('click', closeForm);
        card.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeForm(); if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save.click(); } });
        save.addEventListener('click', function () {
          formErr.hidden = true;
          income.clear(); rows.forEach(function (r) { r.f.clear(); });
          var bad = false, inc = income.money();
          if (!inc.ok) { income.error(inc.message); bad = true; } else if (inc.cents !== null && inc.cents < 0) { income.error('Use an amount of $0.00 or more.'); bad = true; }
          var lines = [];
          rows.forEach(function (r) {
            var m = r.f.money();
            if (!m.ok) { r.f.error(m.message); bad = true; return; }
            if (m.cents === null) return;
            if (m.cents < 0) { r.f.error('Use an amount of $0.00 or more.'); bad = true; return; }
            lines.push({ categoryId: r.cat.id, targetCents: m.cents });
          });
          // Keep any lines on categories this form does not show.
          var shown = {}; rows.forEach(function (r) { shown[r.cat.id] = true; });
          (budget ? budget.lines : []).forEach(function (l) { if (!shown[l.categoryId]) lines.push({ categoryId: l.categoryId, targetCents: l.targetCents }); });
          if (bad) { K.focusFirstError(card); return; }
          var before = budget ? { plannedIncomeCents: budget.plannedIncomeCents, lines: budget.lines.map(function (l) { return { categoryId: l.categoryId, targetCents: l.targetCents }; }) } : null;
          var month = state.month;
          save.disabled = true;
          store.setBudget(month, { plannedIncomeCents: inc.cents === null ? 0 : inc.cents, lines: lines }).then(function () {
            state.editing = null; forget();
            setNote(K.savedNote('Saved. ' + C.monthLong(month) + '’s budget is up to date.', function () { undoBudget(month, before); }));
            draw();
            var t = document.getElementById('view-title'); if (t) t.focus();
          }, function (err) {
            save.disabled = false;
            K.showErrors(err, { plannedIncomeCents: income }, formErr);
            K.focusFirstError(card);
          });
        });
        card.appendChild(formErr);
        card.appendChild(income.el);
        card.appendChild(h('h3', { class: 'bu-h3', text: 'Amount for each category' }));
        card.appendChild(grid);
        card.appendChild(h('p', { class: 'fine body-note', text: 'Need a category that isn’t here? Add it under Your categories, then come back.' }));
        card.appendChild(h('div', { class: 'fk-actions' }, [save, cancel]));
        return card;
      }
      function undoBudget(month, before) {
        var cur = store.budgetFor(month);
        var p = before ? store.setBudget(month, before) : cur ? store['delete']('budgets', cur.id) : Promise.resolve();
        p.then(function () { setNote(h('p', { class: 'fk-saved', role: 'status', text: 'Undone. ' + C.monthLong(month) + '’s budget is as it was.' })); draw(); },
          function (e) { setNote(h('p', { class: 'fk-formerr', role: 'alert', text: e.message })); draw(); });
      }
      function copyLast(prevMonth) {
        var month = state.month;
        store.copyBudget(prevMonth, month).then(function () {
          setNote(K.savedNote('Copied ' + monthName(prevMonth) + '’s amounts to ' + monthName(month) + '. The income you expect isn’t copied: add it with Change amounts.', function () { undoBudget(month, null); }));
          draw();
        }, function (e) { setNote(h('p', { class: 'fk-formerr', role: 'alert', text: e.message })); draw(); });
      }

      // ---------- Your categories: add, rename, delete ----------
      function manageCard(cats) {
        var card = h('section', { class: 'card bu-manage', 'aria-labelledby': 'bu-m-h' });
        card.appendChild(h('h2', { id: 'bu-m-h', text: 'Your categories' }));
        card.appendChild(h('p', { class: 'fine', text: 'The same categories are used in Transactions and Cash flow.' }));
        card.querySelector('h2').setAttribute('tabindex', '-1');
        var KIND = { expense: 'Spending', income: 'Income', transfer: 'Transfer between your accounts' };
        var ul = h('ul', { class: 'bu-list', role: 'list' });
        cats.forEach(function (c) {
          var li = h('li', { class: 'li bu-mrow' });
          if (state.editing === 'cat:' + c.id) {
            var nameF = F('rename.' + c.id, { label: 'New name for ' + c.name, kind: 'text', value: c.name });
            var formErr = h('p', { class: 'fk-formerr', role: 'alert' }); formErr.hidden = true;
            var save = h('button', { type: 'button', class: 'btn small', text: 'Save name' });
            var cancel = h('button', { type: 'button', class: 'btn small quiet', text: 'Cancel' });
            var back = function () { focusAfter('[aria-label="Rename ' + cssq(c.name) + '"]', '#bu-m-h'); closeForm(); };
            cancel.addEventListener('click', back);
            save.addEventListener('click', function () {
              nameF.clear(); formErr.hidden = true;
              var v = nameF.text();
              if (!v) { nameF.error('Enter a name.'); nameF.input.focus(); return; }
              store.update('categories', c.id, { name: v }).then(function () {
                state.editing = null; forget();
                setNote(K.savedNote('Saved. “' + c.name + '” is now “' + v + '”.', function () { store.update('categories', c.id, { name: c.name }); }));
                focusAfter('[aria-label="Rename ' + cssq(v) + '"]', '#bu-m-h');
                draw();
              }, function (err) { if (!K.showErrors(err, { name: nameF }, formErr)) formErr.hidden = false; K.focusFirstError(li); });
            });
            nameF.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); save.click(); } if (e.key === 'Escape') back(); });
            li.appendChild(h('div', { class: 'bu-mform' }, [nameF.el, formErr, h('div', { class: 'fk-actions' }, [save, cancel])]));
            if (state.justOpened === 'cat:' + c.id) { state.justOpened = null; state.focus = function () { nameF.input.focus(); }; }
          } else {
            var rename = h('button', { type: 'button', class: 'linkbtn', text: 'Rename', 'aria-label': 'Rename ' + c.name });
            var del = h('button', { type: 'button', class: 'linkbtn', text: 'Delete', 'aria-label': 'Delete ' + c.name });
            rename.addEventListener('click', function () { state.editing = 'cat:' + c.id; state.draft = null; state.justOpened = state.editing; draw(); });
            del.addEventListener('click', function () { state.confirm = c.id; draw(); });
            li.appendChild(h('span', {}, [c.name, h('span', { class: 'sub', text: KIND[c.kind] + (c.isFee ? ' · fees' : '') })]));
            li.appendChild(h('span', { class: 'bu-mbtns' }, [rename, del]));
          }
          ul.appendChild(li);
          if (state.confirm === c.id) ul.appendChild(h('li', {}, deleteBox(c)));
        });
        card.appendChild(ul);
        card.appendChild(addCategoryForm());
        return card;
      }
      function deleteBox(c) {
        var d = store.dependents('categories', c.id), ch = d.changed || {}, rm = d.removed || {};
        var parts = [];
        if (ch.transactions) parts.push(plural(ch.transactions, 'line becomes', 'lines become') + ' uncategorised');
        if (ch.budgets) parts.push('its amount leaves ' + plural(ch.budgets, 'month’s budget', 'months’ budgets'));
        if (ch.bills) parts.push(plural(ch.bills, 'bill loses', 'bills lose') + ' this category');
        if (rm.rules) parts.push(plural(rm.rules, 'rule is', 'rules are') + ' removed');
        var box = K.confirmBox({
          title: 'Delete “' + c.name + '”?',
          text: (parts.length ? parts.join('; ') + '. ' : 'Nothing else uses it. ') + 'Your other categories stay as they are. You can’t undo this unless you have a backup.',
          yes: 'Delete category', no: 'Keep it',
          onYes: function () {
            store['delete']('categories', c.id).then(function () { state.confirm = null; focusAfter('#bu-m-h', '#view-title'); setNote(h('p', { class: 'fk-saved', role: 'status', text: 'Deleted “' + c.name + '”.' })); draw(); },
              function (e) { state.confirm = null; setNote(h('p', { class: 'fk-formerr', role: 'alert', text: e.message })); draw(); });
          },
          onNo: function () { state.confirm = null; focusAfter('[aria-label="Delete ' + cssq(c.name) + '"]', '#bu-m-h'); draw(); }
        });
        state.confirmFocus = box.focus;
        return box.el;
      }
      function addCategoryForm() {
        var nameF = F('addcat.name', { label: 'New category name', kind: 'text', value: '' });
        var kindF = F('addcat.kind', { label: 'Kind', kind: 'select', value: 'expense', options: [['expense', 'Spending'], ['income', 'Income'], ['transfer', 'Transfer between your accounts']] });
        var formErr = h('p', { class: 'fk-formerr', role: 'alert' }); formErr.hidden = true;
        var add = h('button', { type: 'button', class: 'btn small', text: 'Add category' });
        add.addEventListener('click', function () {
          nameF.clear(); formErr.hidden = true;
          var v = nameF.text();
          if (!v) { nameF.error('Enter a name.'); nameF.input.focus(); return; }
          store.add('categories', { name: v, kind: kindF.input.value }).then(function (rec) {
            setNote(K.savedNote('Added “' + v + '”.', function () { store['delete']('categories', rec.id); }));
            nameF.input.value = '';
            if (state.editing !== 'amounts') draw();
          }, function (err) { if (!K.showErrors(err, { name: nameF, kind: kindF }, formErr)) formErr.hidden = false; K.focusFirstError(add.parentNode.parentNode); });
        });
        nameF.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); add.click(); } });
        return h('div', { class: 'bu-add' }, [h('h3', { class: 'bu-h3', text: 'Add a category' }), h('div', { class: 'bu-add-row' }, [nameF.el, kindF.el]), formErr, h('div', { class: 'fk-actions' }, add)]);
      }

      // ---------- Give your pay a job ----------
      function payCard(B) {
        var card = h('section', { class: 'card bu-pay', 'aria-labelledby': 'bu-p-h' });
        var plans = store.list('payPlans');
        card.appendChild(h('div', { class: 'card-h' }, [h('h2', { id: 'bu-p-h', text: 'Give your pay a job' }),
          state.editing === 'plan:new' ? null : h('button', { type: 'button', class: 'btn small quiet', text: 'Split a pay', on: { click: function () { state.editing = 'plan:new'; state.draft = null; state.justOpened = state.editing; draw(); } } })]));
        card.querySelector('h2').setAttribute('tabindex', '-1');
        if (state.editing === 'plan:new') card.appendChild(planForm(null));
        if (!plans.length && state.editing !== 'plan:new') {
          card.appendChild(h('p', { class: 'bu-read', text: 'Split one pay into jobs you name yourself, such as bills or day-to-day spending. Every dollar stays “not yet given a job” until you type an amount.' }));
        }
        plans.forEach(function (p) {
          if (state.editing === 'plan:' + p.id) { card.appendChild(planForm(p)); return; }
          card.appendChild(planView(p, B));
        });
        if (B.needs) {
          var freq = B.payFrequency;
          card.appendChild(h('p', { class: 'bu-needs' }, freq === 'monthly'
            ? ['The amounts you set for ' + monthName(B.month) + ' add to ', M(B.targetsCents), ': the income this budget needs each month, paid monthly.']
            : ['The amounts you set for ' + monthName(B.month) + ' add to ', M(B.targetsCents),
              ' a month. Paid ' + FREQ_LABEL[freq].toLowerCase() + ', that is ', M(B.needs.perPayCents), ' a pay (',
              M(B.targetsCents), ' × 12 ÷ ' + FREQ_PER_YEAR[freq] + '): the income this budget needs.']));
          card.appendChild(h('p', { class: 'fine body-note', text: 'How often you are paid is set in Settings. Each figure is rounded once, half up to the cent.' }));
        }
        card.appendChild(h('p', { class: 'note', text: 'Sums of the amounts you typed. For education only, not financial advice.' }));
        return card;
      }
      function planView(p, B) {
        var P = SW.models.payPlan(p, B.targetsCents);
        var segs = h('div', { class: 'bu-split', role: 'img', 'aria-label': p.name + ': ' + p.buckets.map(function (b) { return b.name + ' ' + T(b.cents); }).join(', ') + (P.leftCents > 0 ? ', not yet given a job ' + T(P.leftCents) : '') });
        var total = Math.max(p.payCents, P.givenCents) || 1;
        p.buckets.forEach(function (b, i) {
          var s = h('span', { class: i < JOB_TOKENS.length ? 'bg-' + JOB_TOKENS[i] : 'bu-seg-muted' });
          s.style.width = (b.cents / total * 100).toFixed(2) + '%';
          segs.appendChild(s);
        });
        if (P.leftCents > 0) { var s2 = h('span', { class: 'bu-seg-left' }); s2.style.width = (P.leftCents / total * 100).toFixed(2) + '%'; segs.appendChild(s2); }
        var list = h('ul', { class: 'bu-jobs', role: 'list' }, p.buckets.map(function (b, i) {
          return h('li', { class: 'li' }, [h('span', { class: 'bu-job' }, [h('span', { class: 'sw ' + (i < JOB_TOKENS.length ? 'bg-' + JOB_TOKENS[i] : 'bu-seg-muted') }), b.name]), h('span', { class: 'amt' }, M(b.cents))]);
        }));
        if (P.leftCents >= 0) list.appendChild(h('li', { class: 'li' }, [h('span', { class: 'bu-job' }, [h('span', { class: 'sw bu-seg-left' }), 'Not yet given a job']), h('span', { class: 'amt' }, M(P.leftCents))]));
        var eq = p.buckets.map(function (b) { return T(b.cents); }).concat(P.leftCents > 0 ? [T(P.leftCents)] : []).join(' + ');
        var edit = h('button', { type: 'button', class: 'linkbtn', text: 'Change', 'aria-label': 'Change ' + p.name, on: { click: function () { state.editing = 'plan:' + p.id; state.draft = null; state.justOpened = state.editing; draw(); } } });
        var del = h('button', { type: 'button', class: 'linkbtn', text: 'Delete', 'aria-label': 'Delete ' + p.name, on: { click: function () { state.confirm = 'plan:' + p.id; draw(); } } });
        var box = null;
        if (state.confirm === 'plan:' + p.id) {
          var cb = K.confirmBox({ title: 'Delete “' + p.name + '”?', text: 'This removes the split from this device. Your budget stays as it is. You can’t undo this unless you have a backup.', yes: 'Delete split', no: 'Keep it',
            onYes: function () { store['delete']('payPlans', p.id).then(function () { state.confirm = null; focusAfter('#bu-p-h', '#view-title'); setNote(h('p', { class: 'fk-saved', role: 'status', text: 'Deleted “' + p.name + '”.' })); draw(); }); },
            onNo: function () { state.confirm = null; focusAfter('[aria-label="Delete ' + cssq(p.name) + '"]', '#bu-p-h'); draw(); } });
          state.confirmFocus = cb.focus; box = cb.el;
        }
        return h('div', { class: 'bu-plan' }, [
          h('div', { class: 'bu-plan-h' }, [h('h3', { text: p.name }), h('span', { class: 'bu-plan-pay' }, [M(p.payCents), ' · ' + FREQ_LABEL[p.frequency].toLowerCase()])]),
          segs, list,
          h('p', { class: 'bu-sum bu-final' }, P.leftCents < 0
            ? [M(-P.leftCents), ' more than this pay: the jobs add to ', M(P.givenCents), ' of ', M(p.payCents), '.']
            : [eq + ' = ', M(p.payCents)]),
          h('div', { class: 'bu-mbtns' }, [edit, del]), box
        ]);
      }
      function planForm(p) {
        var card = h('div', { class: 'bu-plan bu-planform' });
        var formErr = h('p', { class: 'fk-formerr', role: 'alert' }); formErr.hidden = true;
        var nameF = F('plan.name', { label: 'Name of this pay', kind: 'text', value: p ? p.name : '', hint: 'For example, the employer or “Main pay”.' });
        var payF = F('plan.pay', { label: 'Pay amount', kind: 'money', value: p ? p.payCents : null, hint: 'The amount that comes in, after anything taken out.' });
        var freqF = F('plan.freq', { label: 'How often', kind: 'select', value: p ? p.frequency : ((store.settings() || {}).payFrequency || 'monthly'),
          options: Object.keys(FREQ_LABEL).map(function (k) { return [k, FREQ_LABEL[k]]; }) });
        var rowsEl = h('div', { class: 'bu-buckets' }), rows = [];
        var live = h('p', { class: 'bu-sum bu-final', 'aria-live': 'polite' });
        var draftRows = state.draft && state.draft['plan.rows'] ? state.draft['plan.rows'].list : null;
        reg.push({ name: 'plan.rows', custom: function () {
          return rows.map(function (r) { var m = r.c.money(); return m.ok ? { name: r.n.input.value, cents: m.cents } : { name: r.n.input.value, cents: null, raw: r.c.input.value }; });
        } });
        function addRow(b) {
          if (rows.length >= 20) return;
          var n = K.field({ label: 'Job ' + (rows.length + 1), kind: 'text', value: b ? b.name : '', cap: 'bucket' });
          var c = K.field({ label: 'Amount', kind: 'money', value: b ? b.cents : null });
          if (b && b.raw !== undefined) c.input.value = b.raw;
          var rm = h('button', { type: 'button', class: 'linkbtn', text: 'Remove', 'aria-label': 'Remove job ' + (rows.length + 1) });
          var row = { n: n, c: c, el: h('div', { class: 'bu-bucket' }, [n.el, c.el, rm]) };
          rm.addEventListener('click', function () { rows.splice(rows.indexOf(row), 1); rowsEl.removeChild(row.el); tally(); addBtn.disabled = false; });
          c.input.addEventListener('input', tally);
          rows.push(row); rowsEl.appendChild(row.el); tally();
          addBtn.disabled = rows.length >= 20;
          return row;
        }
        function tally() {
          var pay = payF.money(), sum = 0, okAll = true;
          rows.forEach(function (r) { var m = r.c.money(); if (m.ok && m.cents !== null) sum += m.cents; else okAll = false; });
          dom.clear(live);
          if (!pay.ok) { live.textContent = rows.length ? 'Jobs so far: ' + T(sum) + '.' : ''; return; }
          var left = pay.cents - sum;
          if (left < 0) live.appendChild(document.createTextNode(T(-left) + ' more than this pay. You can still press Save split.'));
          else live.appendChild(document.createTextNode('Given a job: ' + T(sum) + ' of ' + T(pay.cents) + '. Not yet given a job: ' + T(left) + '.' + (okAll ? '' : ' Some amounts can’t be read yet.')));
        }
        var addBtn = h('button', { type: 'button', class: 'btn small quiet', text: 'Add a job' });
        addBtn.addEventListener('click', function () { var r = addRow(null); if (r) r.n.input.focus(); });
        payF.input.addEventListener('input', tally);
        (draftRows || (p ? p.buckets : [null])).forEach(addRow);
        var save = h('button', { type: 'button', class: 'btn small', text: 'Save split' });
        var cancel = h('button', { type: 'button', class: 'btn small quiet', text: 'Cancel', on: { click: closeForm } });
        save.addEventListener('click', function () {
          formErr.hidden = true; [nameF, payF, freqF].forEach(function (f) { f.clear(); }); rows.forEach(function (r) { r.n.clear(); r.c.clear(); });
          var bad = false, pay = payF.money(), name = nameF.text(), buckets = [];
          if (!name) { nameF.error('Enter a name.'); bad = true; }
          if (!pay.ok) { payF.error(pay.message); bad = true; } else if (pay.cents <= 0) { payF.error('Use an amount above $0.00.'); bad = true; }
          if (!rows.length) { formErr.hidden = false; formErr.textContent = 'Add at least one job.'; bad = true; }
          rows.forEach(function (r) {
            var nm = r.n.text(), m = r.c.money();
            if (!nm) { r.n.error('Name this job.'); bad = true; }
            if (!m.ok) { r.c.error(m.message); bad = true; } else if (m.cents < 0) { r.c.error('Use an amount of $0.00 or more.'); bad = true; }
            buckets.push({ name: nm, cents: m.ok ? m.cents : 0 });
          });
          if (bad) { K.focusFirstError(card); return; }
          var fields = { name: name, payCents: pay.cents, frequency: freqF.input.value, buckets: buckets };
          var before = p ? { name: p.name, payCents: p.payCents, frequency: p.frequency, buckets: p.buckets.map(function (b) { return { name: b.name, cents: b.cents }; }) } : null;
          save.disabled = true;
          (p ? store.update('payPlans', p.id, fields) : store.add('payPlans', fields)).then(function (rec) {
            state.editing = null; forget();
            setNote(K.savedNote('Saved “' + name + '”.', function () { if (p) store.update('payPlans', p.id, before); else store['delete']('payPlans', rec.id); }));
            draw();
          }, function (err) {
            save.disabled = false;
            K.showErrors(err, { name: nameF, payCents: payF, frequency: freqF }, formErr);
            K.focusFirstError(card);
          });
        });
        card.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeForm(); });
        card.appendChild(h('h3', { text: p ? 'Change “' + p.name + '”' : 'Split a pay' }));
        card.appendChild(formErr);
        card.appendChild(h('div', { class: 'bu-add-row' }, [nameF.el, payF.el, freqF.el]));
        card.appendChild(rowsEl);
        card.appendChild(h('div', { class: 'fk-actions' }, addBtn));
        card.appendChild(live);
        card.appendChild(h('div', { class: 'fk-actions' }, [save, cancel]));
        if (state.justOpened === state.editing) { state.justOpened = null; state.focus = function () { nameF.input.focus(); }; }
        return card;
      }
    }
  });
})();
