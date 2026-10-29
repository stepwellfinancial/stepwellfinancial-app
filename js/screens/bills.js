/* Bills: the reader's own bills, kept on this device. Add, change and
   delete a bill (amount, how often, next due date, a contract or renewal
   date). A calendar for any month from this one on, the month's total, the
   average a month and a pay, and the renewal dates the reader typed. The fee
   x-ray reads the reader's own lines in fee categories over the last 12
   months; a fund cost the reader entered is shown apart, as an illustration.
   It never says to cancel or switch anything.

   PART 1 is pure (no DOM): figures in whole cents from store records with the
   calc module, so the test page can check it alone. Dates come from the
   records and "today" passed in; the clock is never read.
   PART 2 is the screen; it uses the shared form kit, SW.formKit (js/dom.js). */
(function (root) {
  'use strict';
  var SW = root.SW = root.SW || {};
  var STEP_MONTHS = { monthly: 1, quarterly: 3, yearly: 12 };
  var STEP_DAYS = { weekly: 7, biweekly: 14 };
  var DAY = 86400000;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function daysIn(month) { return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate(); }
  function ms(date) { return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))); }
  function iso(t) { var d = new Date(t); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  function monthsBetween(a, b) { return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7)); }

  // The dates a bill falls due in a month: the next due date the reader
  // entered and its repeats after it, never a date before it (a day that
  // doesn't exist in a month moves to the month's last day).
  function datesIn(bill, month) {
    var out = [];
    if (STEP_MONTHS[bill.frequency]) {
      var diff = monthsBetween(bill.nextDue.slice(0, 7), month);
      if (diff >= 0 && diff % STEP_MONTHS[bill.frequency] === 0) out.push(month + '-' + pad2(Math.min(Number(bill.nextDue.slice(8, 10)), daysIn(month))));
      return out;
    }
    var step = STEP_DAYS[bill.frequency] * DAY, start = ms(month + '-01'), end = ms(month + '-' + pad2(daysIn(month))), anchor = ms(bill.nextDue);
    var k = Math.max(0, Math.ceil((start - anchor) / step));
    for (var t = anchor + k * step; t <= end; t += step) out.push(iso(t));
    return out;
  }

  // billsModel({ bills, month, today, payFrequency, transactions, categories, accounts, balances })
  function billsModel(o) {
    var C = root.SWCalc, month = o.month, nowMonth = o.today.slice(0, 7);
    var past = month < nowMonth;
    // A next due date before today is not moved on: the bill stays off the
    // calendar and asks the reader to update the date.
    var overdue = o.bills.filter(function (b) { return b.nextDue < o.today; })
      .sort(function (a, b) { return a.nextDue < b.nextDue ? -1 : a.nextDue > b.nextDue ? 1 : a.name.localeCompare(b.name); });
    var occ = [];
    if (!past) {
      o.bills.forEach(function (b) {
        if (b.nextDue < o.today) return;
        datesIn(b, month).forEach(function (d) { occ.push({ bill: b, date: d, day: Number(d.slice(8, 10)) }); });
      });
    }
    occ.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.bill.name.localeCompare(b.bill.name); });
    var firstDow = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)).getUTCDay();
    var days = daysIn(month), weeks = [], week = [];
    for (var i = 0; i < firstDow; i++) week.push(null);
    for (var d = 1; d <= days; d++) {
      week.push({ day: d, date: month + '-' + pad2(d), items: occ.filter(function (x) { return x.day === d; }) });
      if (week.length === 7) { weeks.push(week); week = []; }
    }
    if (week.length) { while (week.length < 7) week.push(null); weeks.push(week); }

    var PER_YEAR = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, yearly: 1 };
    var avg = C.perMonthAndPay(o.bills.map(function (b) { return { cents: b.cents, frequency: b.frequency }; }), o.payFrequency || 'monthly');
    var yearly = o.bills.map(function (b) { return { bill: b, times: PER_YEAR[b.frequency], yearCents: b.cents * PER_YEAR[b.frequency] }; })
      .sort(function (a, b) { return b.yearCents - a.yearCents || a.bill.name.localeCompare(b.bill.name); });
    var renewals = o.bills.filter(function (b) { return b.endsOn; }).sort(function (a, b) { return a.endsOn < b.endsOn ? -1 : a.endsOn > b.endsOn ? 1 : 0; });

    // Fee x-ray: parts in fee categories, dated in the 12 months to today.
    var fromExcl = (Number(o.today.slice(0, 4)) - 1) + o.today.slice(4);
    var feeCats = {}; o.categories.forEach(function (c) { if (c.isFee) feeCats[c.id] = c; });
    var acctName = {}; (o.accounts || []).forEach(function (a) { acctName[a.id] = a.name; });
    var feeLines = [];
    o.transactions.forEach(function (t) {
      if (!(t.date > fromExcl && t.date <= o.today)) return;
      var c = C.partsOf(t).filter(function (p) { return feeCats[p.categoryId]; }).reduce(function (s, p) { return s + p.cents; }, 0);
      if (C.partsOf(t).some(function (p) { return feeCats[p.categoryId]; })) feeLines.push({ id: t.id, date: t.date, payee: t.payee, accountId: t.accountId, cents: -c });
    });
    feeLines.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    var groups = {}, order = [];
    feeLines.forEach(function (f) {
      var k = f.accountId || '';
      if (!groups[k]) { groups[k] = { accountId: f.accountId, name: acctName[f.accountId] || 'No account', cents: 0, lines: [] }; order.push(k); }
      groups[k].cents += f.cents; groups[k].lines.push(f);
    });
    var feeGroups = order.map(function (k) { return groups[k]; }).sort(function (a, b) { return b.cents - a.cents; });

    // Fund costs: a rate the reader entered on an account, applied to today's balance (an illustration).
    var funds = [];
    var withRate = (o.accounts || []).filter(function (a) { return a.fundCostBps; });
    if (withRate.length) {
      var tot = C.totalsOn(o.accounts, o.balances || [], o.today);
      tot.rows.forEach(function (r) {
        if (!r.account.fundCostBps) return;
        funds.push({ account: r.account, bps: r.account.fundCostBps, balanceCents: r.cents, entry: r.entry,
          yearCents: C.divRound(r.cents * r.account.fundCostBps, 10000), per1000Cents: C.divRound(100000 * r.account.fundCostBps, 10000) });
      });
    }

    return {
      month: month, past: past, today: o.today, firstDow: firstDow, days: days, weeks: weeks, occurrences: occ,
      monthCents: occ.reduce(function (s, x) { return s + x.bill.cents; }, 0),
      overdue: overdue,
      perMonthCents: avg.perMonthCents, perPayCents: avg.perPayCents, perYearCents: avg.perYearCents, payFrequency: o.payFrequency || 'monthly',
      yearly: yearly, renewals: renewals,
      feeFrom: fromExcl, feeLines: feeLines, feeGroups: feeGroups, feesCents: feeLines.reduce(function (s, f) { return s + f.cents; }, 0),
      hasFeeCategory: Object.keys(feeCats).length > 0, funds: funds
    };
  }

  SW.models = SW.models || {};
  SW.models.bills = billsModel;
  SW.models.billDates = datesIn;
})(this);

/* PART 2: the screen. */
(function () {
  'use strict';
  var SW = window.SW;
  if (!SW || !SW.screens) return;

  var FREQ = [['weekly', 'Every week'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Every month'], ['quarterly', 'Every 3 months'], ['yearly', 'Every year']];
  var FREQ_LABEL = {}; FREQ.forEach(function (f) { FREQ_LABEL[f[0]] = f[1]; });
  var PAY_LABEL = { weekly: 'every week', biweekly: 'every 2 weeks', semimonthly: 'twice a month', monthly: 'every month' };
  var PAY_PER_YEAR = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };
  var DOW = [['S', 'Sun', 'Sunday'], ['M', 'Mon', 'Monday'], ['T', 'Tue', 'Tuesday'], ['W', 'Wed', 'Wednesday'], ['T', 'Thu', 'Thursday'], ['F', 'Fri', 'Friday'], ['S', 'Sat', 'Saturday']];

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

  SW.screens.register('bills', {
    render: function (wrap, ctx) {
      var store = ctx.store, C = ctx.calc, dom = ctx.dom, h = dom.h, K = SW.formKit;
      var M = function (c, o) { return dom.moneyCents(c, o); };
      var T = function (c, o) { return SW.fmt.money(c, o); };
      var state = keep && keep.hash === location.hash ? keep.state : { month: monthFromHash(store.today()), editing: null, confirm: null, note: null, draft: null, focus: null };
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

      function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
      function monthName(m) { return C.monthLong(m).split(' ')[0]; }
      function link(m) { return '#/bills?month=' + m; }
      function setNote(el) {
        state.note = el; clearTimeout(noteTimer);
        noteTimer = setTimeout(function () { state.note = null; var n = wrap.querySelector('.bi-note'); if (n) dom.clear(n); }, 12000);
      }
      function fail(e) { setNote(h('p', { class: 'fk-formerr', role: 'alert', text: e.message })); draw(); }

      function draw() {
        var y = window.scrollY;
        snapshot();
        reg = [];
        dom.clear(wrap);
        var st = store.status(), settings = store.settings() || {};
        var bills = store.list('bills');
        var B = SW.models.bills({ bills: bills, month: state.month, today: store.today(), payFrequency: settings.payFrequency,
          transactions: store.list('transactions'), categories: store.list('categories'), accounts: store.list('accounts'), balances: store.list('balances') });
        wrap.appendChild(ctx.app.screenHeader(ctx.route, { eyebrow: C.monthLong(state.month) + (st.hasSample ? ' · Sample data' : '') }));
        wrap.appendChild(h('div', { class: 'bi-note' }, state.note));
        var left = h('div', { class: 'bi-col' }), right = h('div', { class: 'bi-col' });
        wrap.appendChild(h('div', { class: 'bi-grid' }, [left, right]));
        left.appendChild(calendarCard(B, bills));
        left.appendChild(listCard(bills, B));
        right.appendChild(totalsCard(B, bills));
        if (B.renewals.length) right.appendChild(renewalsCard(B));
        right.appendChild(feesCard(B));
        if (B.funds.length) right.appendChild(fundCard(B));
        state.draft = null;
        window.scrollTo(0, y);
        if (state.focus) { var f = state.focus; state.focus = null; f(); }
      }

      // ---------- Calendar ----------
      function calendarCard(B, bills) {
        var now = store.today().slice(0, 7);
        var card = h('section', { class: 'card bi-cal-card', 'aria-labelledby': 'bi-c-h' });
        card.appendChild(h('div', { class: 'card-h' }, [
          h('h2', { id: 'bi-c-h', text: 'Bills in ' + C.monthLong(B.month) }),
          h('div', { class: 'bi-mnav', role: 'group', 'aria-label': 'Choose a month' }, [
            h('a', { class: 'btn small quiet', href: link(C.addMonths(B.month, -1)), 'aria-label': 'Previous month, ' + C.monthLong(C.addMonths(B.month, -1)), text: '←' }),
            B.month !== now ? h('a', { class: 'btn small quiet', href: link(now), text: 'This month' }) : null,
            h('a', { class: 'btn small quiet', href: link(C.addMonths(B.month, 1)), 'aria-label': 'Next month, ' + C.monthLong(C.addMonths(B.month, 1)), text: '→' })
          ])
        ]));
        if (!bills.length) {
          card.appendChild(h('p', { class: 'bi-read', text: 'No bills yet. Add one below and it shows here on the day it is due, every time it comes round.' }));
          return card;
        }
        if (B.past) {
          card.appendChild(h('p', { class: 'bi-read', text: 'The calendar shows bills from this month on. Your transactions show what was paid in earlier months.' }));
          return card;
        }
        var table = h('table', { class: 'bi-cal' }, [
          h('caption', { class: 'sr-only', text: 'Calendar of bills in ' + C.monthLong(B.month) + '. Each day lists the bills due that day.' }),
          h('thead', {}, h('tr', {}, DOW.map(function (d) {
            return h('th', { scope: 'col', abbr: d[2] }, [h('span', { class: 'bi-dow-s', 'aria-hidden': 'true', text: d[0] }), h('span', { class: 'bi-dow-l', text: d[1] })]);
          }))),
          h('tbody', {}, B.weeks.map(function (w) {
            return h('tr', {}, w.map(function (cell) {
              if (!cell) return h('td', { class: 'bi-empty' });
              var has = cell.items.length > 0, today = cell.date === B.today;
              return h('td', { class: (has ? 'bi-has' : '') + (today ? ' bi-today' : '') }, [
                h('span', { class: 'bi-day' }, [String(cell.day), today ? h('span', { class: 'bi-today-l', text: ' today' }) : null]),
                has ? h('span', { class: 'bi-marks', 'aria-hidden': 'true' }, cell.items.map(function () { return h('span', { class: 'bi-mark' }); })) : null,
                has ? h('ul', { class: 'bi-names', role: 'list' }, cell.items.map(function (x) { return h('li', { text: x.bill.name }); })) : null
              ]);
            }));
          }))
        ]);
        card.appendChild(h('div', { class: 'bi-cal-wrap' }, table));
        card.appendChild(h('p', { class: 'fine bi-cal-key', text: 'On a narrow screen each dot is one bill; the list below names them.' }));
        var ul = h('ul', { class: 'bi-list', role: 'list' });
        B.occurrences.forEach(function (x) {
          ul.appendChild(h('li', { class: 'li' }, [
            h('span', {}, [x.bill.name, h('span', { class: 'sub', text: C.dayLong(x.date) + ' · ' + FREQ_LABEL[x.bill.frequency].toLowerCase() })]),
            h('span', { class: 'amt' }, M(x.bill.cents))
          ]));
        });
        if (!B.occurrences.length) ul.appendChild(h('li', { class: 'li' }, h('span', { text: 'None of your bills falls due in ' + C.monthLong(B.month) + '.' })));
        card.appendChild(ul);
        card.appendChild(h('p', { class: 'bi-total' }, [h('span', { text: 'Total for ' + monthName(B.month) }), M(B.monthCents)]));
        if (B.overdue.length) {
          card.appendChild(h('p', { class: 'bi-split body-note' }, [plural(B.overdue.length, 'bill is', 'bills are') + ' not on the calendar, because the next due date you entered has passed: ' +
            B.overdue.map(function (b) { return b.name + ' (' + C.dayLong(b.nextDue) + ')'; }).join(', ') + '. Change the date under Your bills to put ' + (B.overdue.length === 1 ? 'it' : 'them') + ' back.']));
        }
        card.appendChild(h('p', { class: 'note', text: 'Amounts and dates you entered for each bill. For education only, not financial advice.' }));
        return card;
      }

      // ---------- Your bills: add, change, delete ----------
      function listCard(bills, B) {
        var card = h('section', { class: 'card bi-yours', 'aria-labelledby': 'bi-y-h' });
        card.appendChild(h('div', { class: 'card-h' }, [h('h2', { id: 'bi-y-h', text: 'Your bills' }),
          state.editing === 'new' ? null : h('button', { type: 'button', class: 'btn small', text: 'Add a bill', on: { click: function () { state.editing = 'new'; state.draft = null; state.justOpened = 'new'; draw(); } } })]));
        card.querySelector('h2').setAttribute('tabindex', '-1');
        if (state.editing === 'new') card.appendChild(billForm(null));
        var sorted = bills.slice().sort(function (a, b) { return a.nextDue < b.nextDue ? -1 : a.nextDue > b.nextDue ? 1 : a.name.localeCompare(b.name); });
        var ul = h('ul', { class: 'bi-list', role: 'list' });
        sorted.forEach(function (b) {
          if (state.editing === b.id) { ul.appendChild(h('li', {}, billForm(b))); return; }
          var passed = b.nextDue < store.today();
          var sub = 'Next due ' + C.dayLong(b.nextDue) + ' · ' + FREQ_LABEL[b.frequency].toLowerCase() + (b.endsOn ? ' · renews ' + C.dayLong(b.endsOn) : '');
          ul.appendChild(h('li', { class: 'li bi-row' }, [
            h('span', {}, [b.name, h('span', { class: 'sub', text: sub }),
              passed ? h('span', { class: 'bi-passed', text: 'The next due date you entered, ' + C.dayLong(b.nextDue) + ', has passed. Change it to keep the calendar right.' }) : null]),
            h('span', { class: 'amt' }, M(b.cents)),
            h('span', { class: 'bi-btns' }, [
              h('button', { type: 'button', class: 'linkbtn', text: 'Change', 'aria-label': 'Change ' + b.name, on: { click: function () { state.editing = b.id; state.draft = null; state.justOpened = b.id; draw(); } } }),
              h('button', { type: 'button', class: 'linkbtn', text: 'Delete', 'aria-label': 'Delete ' + b.name, on: { click: function () { state.confirm = b.id; draw(); } } })
            ])
          ]));
          if (state.confirm === b.id) {
            var box = K.confirmBox({ title: 'Delete “' + b.name + '”?', text: 'This removes the bill from this device. Your transactions stay as they are. You can’t undo this unless you have a backup.',
              yes: 'Delete bill', no: 'Keep it',
              onYes: function () { store['delete']('bills', b.id).then(function () { state.confirm = null; focusAfter('#bi-y-h', '#view-title'); setNote(h('p', { class: 'fk-saved', role: 'status', text: 'Deleted “' + b.name + '”.' })); draw(); }, function (e) { state.confirm = null; fail(e); }); },
              onNo: function () { state.confirm = null; focusAfter('[aria-label="Delete ' + cssq(b.name) + '"]', '#bi-y-h'); draw(); } });
            ul.appendChild(h('li', {}, box.el));
            state.focus = box.focus;
          }
        });
        if (!bills.length && state.editing !== 'new') card.appendChild(h('p', { class: 'bi-read', text: 'Add the bills you pay, such as rent, a phone or insurance, with how often each one comes round.' }));
        card.appendChild(ul);
        return card;
      }
      function billForm(b) {
        var box = h('div', { class: 'bi-form' });
        var formErr = h('p', { class: 'fk-formerr', role: 'alert' }); formErr.hidden = true;
        var cats = store.list('categories').filter(function (c) { return c.kind === 'expense'; }).sort(function (x, y) { return x.name.localeCompare(y.name); });
        var accts = store.list('accounts').slice().sort(function (x, y) { return x.name.localeCompare(y.name); });
        var f = {
          name: F('bill.name', { label: 'Name', kind: 'text', value: b ? b.name : '' }),
          cents: F('bill.cents', { label: 'Amount', kind: 'money', value: b ? b.cents : null }),
          frequency: F('bill.frequency', { label: 'How often', kind: 'select', value: b ? b.frequency : 'monthly', options: FREQ }),
          nextDue: F('bill.nextDue', { label: 'Next due', kind: 'date', value: b ? b.nextDue : '' }),
          endsOn: F('bill.endsOn', { label: 'Contract or renewal date', kind: 'date', value: b && b.endsOn ? b.endsOn : '', optional: true, hint: 'We show this date on the bills list. We don’t send reminders by email.' }),
          categoryId: F('bill.categoryId', { label: 'Category', kind: 'select', optional: true, value: b && b.categoryId ? b.categoryId : '', options: [['', 'None']].concat(cats.map(function (c) { return [c.id, c.name]; })) }),
          accountId: F('bill.accountId', { label: 'Paid from', kind: 'select', optional: true, value: b && b.accountId ? b.accountId : '', options: [['', 'Not set']].concat(accts.map(function (a) { return [a.id, a.name]; })) })
        };
        var back = function () { focusAfter(b ? '[aria-label="Change ' + cssq(b.name) + '"]' : '#bi-y-h', '#bi-y-h'); closeForm(); };
        var save = h('button', { type: 'button', class: 'btn small', text: 'Save bill' });
        var cancel = h('button', { type: 'button', class: 'btn small quiet', text: 'Cancel', on: { click: back } });
        save.addEventListener('click', function () {
          formErr.hidden = true; Object.keys(f).forEach(function (k) { f[k].clear(); });
          var bad = false, name = f.name.text(), amt = f.cents.money(), due = f.nextDue.input.value, ends = f.endsOn.input.value;
          if (!name) { f.name.error('Enter a name.'); bad = true; }
          if (!amt.ok) { f.cents.error(amt.message); bad = true; } else if (amt.cents <= 0) { f.cents.error('Use an amount above $0.00.'); bad = true; }
          if (!due) { f.nextDue.error('Choose the next date it is due.'); bad = true; } else if (!window.SWSchema.isDate(due)) { f.nextDue.error('That date doesn’t exist. Check the day and month.'); bad = true; }
          if (ends && !window.SWSchema.isDate(ends)) { f.endsOn.error('That date doesn’t exist. Check the day and month.'); bad = true; }
          if (bad) { K.focusFirstError(box); return; }
          var fields = { name: name, cents: amt.cents, frequency: f.frequency.input.value, nextDue: due, endsOn: ends || null,
            categoryId: f.categoryId.input.value || null, accountId: f.accountId.input.value || null };
          var before = b ? { name: b.name, cents: b.cents, frequency: b.frequency, nextDue: b.nextDue, endsOn: b.endsOn, categoryId: b.categoryId, accountId: b.accountId } : null;
          save.disabled = true;
          (b ? store.update('bills', b.id, fields) : store.add('bills', fields)).then(function (rec) {
            state.editing = null; reg = []; state.draft = null;
            focusAfter('[aria-label="Change ' + cssq(name) + '"]', '#bi-y-h');
            setNote(K.savedNote('Saved “' + name + '”. The calendar is up to date.', function () {
              (b ? store.update('bills', b.id, before) : store['delete']('bills', rec.id)).catch(fail);
            }));
            draw();
          }, function (err) { save.disabled = false; K.showErrors(err, f, formErr); K.focusFirstError(box); });
        });
        box.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') back();
          if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save.click(); }
        });
        box.appendChild(h('h3', { text: b ? 'Change “' + b.name + '”' : 'Add a bill' }));
        box.appendChild(formErr);
        box.appendChild(h('div', { class: 'bi-form-grid' }, [f.name.el, f.cents.el, f.frequency.el, f.nextDue.el, f.endsOn.el, f.categoryId.el, f.accountId.el]));
        box.appendChild(h('div', { class: 'fk-actions' }, [save, cancel]));
        if (state.justOpened === state.editing) { state.justOpened = null; state.focus = function () { f.name.input.focus(); }; }
        return box;
      }

      // ---------- A month and a pay, on average ----------
      function totalsCard(B, bills) {
        var card = h('section', { class: 'card bi-avg', 'aria-labelledby': 'bi-a-h' });
        card.appendChild(h('h2', { id: 'bi-a-h', text: 'A month and a pay, on average' }));
        if (!bills.length) { card.appendChild(h('p', { class: 'bi-read', text: 'Once you add bills, this shows what they come to in a year, a month and a pay.' })); return card; }
        var pf = B.payFrequency;
        card.appendChild(h('p', { class: 'bi-big' }, [M(B.perMonthCents), h('span', { class: 'bi-big-sub', text: ' a month' })]));
        card.appendChild(h('p', { class: 'bi-read' }, pf === 'monthly'
          ? ['Your bills add to ', M(B.perYearCents), ' a year. That is ', M(B.perMonthCents), ' a month, which is also a pay, as you are paid every month.']
          : ['Your bills add to ', M(B.perYearCents), ' a year. That is ', M(B.perMonthCents), ' a month, and ', M(B.perPayCents), ' a pay, as you are paid ' + PAY_LABEL[pf] + '.']));
        var btn = h('button', { type: 'button', class: 'explain', text: 'What makes this up?' });
        var panel = h('div', { class: 'explainer' }, [
          h('h3', { text: 'Each bill over a year' }),
          h('div', {}, B.yearly.map(function (y) {
            return h('div', { class: 'li' }, [h('span', {}, [y.bill.name, h('span', { class: 'sub' }, [T(y.bill.cents) + ' × ' + y.times + ' (' + FREQ_LABEL[y.bill.frequency].toLowerCase() + ')'])]), h('span', { class: 'amt' }, M(y.yearCents))]);
          })),
          h('p', { class: 'bi-sum' }, ['A year ', M(B.perYearCents)]),
          h('p', { class: 'fine body-note' }, ['A month = ', M(B.perYearCents), ' ÷ 12 = ', M(B.perMonthCents), '. A pay = ', M(B.perYearCents), ' ÷ ' + PAY_PER_YEAR[pf] + ' = ', M(B.perPayCents),
            '. Each is rounded once, half up to the cent. How often you are paid is set in Settings.'])
        ]);
        dom.disclosure(btn, panel);
        card.appendChild(h('div', { class: 'bi-foot' }, btn));
        card.appendChild(panel);
        card.appendChild(h('p', { class: 'note', text: 'Sums of the bills you entered. For education only, not financial advice.' }));
        return card;
      }

      // ---------- Contract and renewal dates ----------
      function renewalsCard(B) {
        var card = h('section', { class: 'card bi-renew', 'aria-labelledby': 'bi-r-h' });
        card.appendChild(h('h2', { id: 'bi-r-h', text: 'Contract and renewal dates' }));
        card.appendChild(h('ul', { class: 'bi-list', role: 'list' }, B.renewals.map(function (b) {
          return h('li', { class: 'li' }, [h('span', {}, [b.name, h('span', { class: 'sub', text: 'Renews ' + C.dayLong(b.endsOn) })]), h('span', { class: 'amt' }, M(b.cents))]);
        })));
        card.appendChild(h('p', { class: 'note body-note', text: 'The dates you typed. We don’t send reminders.' }));
        return card;
      }

      // ---------- Fee x-ray ----------
      function feesCard(B) {
        var card = h('section', { class: 'card bi-fees', 'aria-labelledby': 'bi-f-h' });
        card.appendChild(h('div', {}, [h('h2', { id: 'bi-f-h', text: 'Fee x-ray' }), h('p', { class: 'eyebrow', text: 'Fees in your transactions in the 12 months to ' + C.dayLong(B.today) })]));
        if (!B.feeLines.length) {
          card.appendChild(h('p', { class: 'bi-read', text: B.hasFeeCategory
            ? 'No fees found in your transactions in the last 12 months. Lines in a fee category, such as Fees, show here.'
            : 'No category is marked as fees, so no fees can be found.' }));
          return card;
        }
        card.appendChild(h('p', { class: 'bi-fee-line' }, ['Fees found in your transactions: ', M(B.feesCents)]));
        var ul = h('ul', { class: 'bi-list', role: 'list' });
        B.feeGroups.forEach(function (g) {
          var btn = h('button', { type: 'button', class: 'linkbtn', text: 'Show the parts', 'aria-label': 'Show the parts of fees from ' + g.name });
          var panel = h('div', { class: 'explainer' }, [
            h('h3', { text: 'Fees from ' + g.name }),
            h('div', {}, g.lines.map(function (l) { return h('div', { class: 'li' }, [h('span', {}, [l.payee, h('span', { class: 'sub', text: C.dayLong(l.date) })]), h('span', { class: 'amt' }, M(l.cents))]); })),
            h('p', { class: 'bi-sum' }, [plural(g.lines.length, 'line', 'lines') + ', total ', M(g.cents)])
          ]);
          dom.disclosure(btn, panel);
          ul.appendChild(h('li', { class: 'bi-fgroup' }, [
            h('div', { class: 'li' }, [h('span', {}, [g.name, h('span', { class: 'sub', text: plural(g.lines.length, 'fee', 'fees') })]), h('span', { class: 'amt' }, M(g.cents))]),
            btn, panel
          ]));
        });
        card.appendChild(ul);
        card.appendChild(h('p', { class: 'bi-total' }, [h('span', { text: 'Total' }), M(B.feesCents)]));
        card.appendChild(h('p', { class: 'note', text: 'Lines you entered or imported in a fee category. For education only, not financial advice.' }));
        return card;
      }

      // ---------- Fund costs: an illustration ----------
      function fundCard(B) {
        var card = h('section', { class: 'card bi-fund', 'aria-labelledby': 'bi-u-h' });
        card.appendChild(h('h2', { id: 'bi-u-h', text: 'Fund costs, an illustration' }));
        B.funds.forEach(function (f) {
          var pct = (f.bps / 100).toFixed(2) + '%';
          card.appendChild(h('p', { class: 'bi-read' }, ['Illustration: ' + pct + ' a year of ', M(f.balanceCents), ' would be ', M(f.yearCents),
            ' for one year, if the balance of ' + f.account.name + ' stayed the same. That is ', M(f.per1000Cents), ' for every ', M(100000), '.']));
          card.appendChild(h('p', { class: 'fine body-note' }, ['How this works: the balance you entered' + (f.entry ? ' for ' + C.dayLong(f.entry.date) : '') + ', ', M(f.balanceCents), ', × the yearly rate you entered, ' + pct + ', rounded half up to the cent. Funds take this cost out of the fund itself, so it isn’t a line in your transactions and isn’t in the fees total. Not a prediction.']));
        });
        card.appendChild(h('p', { class: 'note', text: 'For education only, not financial advice.' }));
        return card;
      }
    }
  });
})();
