/* What if: the planner you drive. Three tabs, each an illustration:
   savings at an example rate, a loan (or card) balance reaching zero, and a
   home loan with equal payments. Each says it is not a prediction. Every rate the reader did not
   type, or bring from their own account, is labelled "example".

   PART 1 is pure (no DOM), so the test page can check it alone.
   - Savings: the compound interest calculator's method, SWCalc.compoundSavings
     (monthly compounding, money added at the end of each month, rounded only
     at the end). Check: 2,400 to start, 150 a month, example 5%, 10 years =
     27,245.16; 20 years = 68,165.39; at 0% exactly the money put in.
   - Loan, in whole cents (build supplement E5): each month interest is the
     balance x the yearly rate / 12, rounded half up to the cent, then the
     payment comes off; the last payment is what is left. An extra amount each
     month, or a one-off amount in a given month, is only ever the reader's own
     input. Check: 8,400.00 at 6.9%, 310.00 a month = 30 payments, the last
     167.90, interest 757.90.
   - Home loan: equal payments P = L i / (1 - (1 + i)^-n), i = r / 12;
     interest = the exact payment x n - L, rounded only at the end. */
(function (root) {
  'use strict';
  var SW = root.SW = root.SW || {};
  var MAX_MONTHS = 600; // 50 years

  function round2(v) { return root.SWCalc.round2(v); }

  function savings(inp) { return root.SWCalc.compoundSavings(inp); }

  // loan({ balanceCents, rateBps, paymentCents, extraCents, lumpCents, lumpMonth })
  //   rateBps: the yearly rate in hundredths of a percent (6.9% = 690).
  //   -> { months, interestCents, totalPaidCents, lastPaymentCents, firstInterestCents, points, interestPoints }
  //      or { never: true, firstInterestCents } or { tooLong: true }
  function loan(inp) {
    var C = root.SWCalc, b = inp.balanceCents, bps = inp.rateBps;
    var regular = inp.paymentCents + (inp.extraCents || 0), lump = inp.lumpCents || 0, lumpMonth = inp.lumpMonth || 1;
    var interest = 0, m = 0, last = 0, points = [b], intPts = [0];
    var first = C.divRound(b * bps, 120000);
    while (b > 0 && m < MAX_MONTHS) {
      m += 1;
      var it = C.divRound(b * bps, 120000);
      b += it; interest += it;
      var pay = regular + (m === lumpMonth ? lump : 0);
      if (pay >= b) { last = b; b = 0; }
      else {
        b -= pay;
        if (m > lumpMonth && it >= regular) break; // the payment no longer covers the interest
      }
      points.push(b); intPts.push(interest);
    }
    if (b > 0) return m >= MAX_MONTHS ? { tooLong: true, firstInterestCents: first } : { never: true, firstInterestCents: first };
    return { months: m, interestCents: interest, totalPaidCents: inp.balanceCents + interest, lastPaymentCents: last,
      firstInterestCents: first, points: points, interestPoints: intPts };
  }

  // home({ amount, ratePct, years }) in dollars
  function home(inp) {
    var i = inp.ratePct / 100 / 12, lg = inp.ratePct === 0 ? 0 : Math.log1p(i), n = inp.years * 12, L = inp.amount;
    var pay = i === 0 ? L / n : L * i / -Math.expm1(-n * lg);
    function owed(k) { return i === 0 ? L - pay * k : L * Math.exp(k * lg) - pay * Math.expm1(k * lg) / i; }
    var points = [], interestSoFar = [];
    for (var k = 0; k <= n; k++) {
      var left = k === n ? 0 : Math.max(0, owed(k));
      points.push(left);
      interestSoFar.push(Math.max(0, pay * k - (L - left)));
    }
    return { months: n, payment: round2(pay), exactPayment: pay, interest: round2(pay * n - L), points: points, interestPoints: interestSoFar };
  }

  SW.models = SW.models || {};
  SW.models.whatIf = { savings: savings, loan: loan, home: home, MAX_MONTHS: MAX_MONTHS };
})(this);

/* PART 2: the screen. */
(function () {
  'use strict';
  var SW = window.SW;
  if (!SW || !SW.screens) return; // the test page loads only the pure part

  var SAVINGS = { start: 2400, monthly: 150, ratePct: 5, years: 10 };
  var HOME = { amount: 240000, ratePct: 6.5, years: 30 };
  var LOAN = { balanceCents: 480000, rateBps: 2200, paymentCents: 20000, extraCents: null, lumpCents: null, lumpMonth: 1 };
  var SLIDERS = {
    savings: [
      { key: 'start', label: 'Starting amount', min: 0, max: 20000, step: 100, kind: 'money' },
      { key: 'monthly', label: 'Added at the end of each month', min: 0, max: 1000, step: 25, kind: 'money' },
      { key: 'ratePct', label: 'Example rate a year', min: 0, max: 12, step: 0.5, kind: 'rate' },
      { key: 'years', label: 'Years', min: 1, max: 40, step: 1, kind: 'years' }
    ],
    home: [
      { key: 'amount', label: 'Amount borrowed', min: 50000, max: 1000000, step: 5000, kind: 'money' },
      { key: 'ratePct', label: 'Example rate a year', min: 0, max: 12, step: 0.25, kind: 'rate' },
      { key: 'years', label: 'Years to repay', min: 5, max: 40, step: 5, kind: 'years' }
    ]
  };

  function copy(o) { var r = {}; Object.keys(o).forEach(function (k) { r[k] = o[k]; }); return r; }
  function rateText(v) { return String(Number(v)) + '%'; }
  function bpsText(b) { return String(Number((b / 100).toFixed(2))) + '%'; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function span(m) {
    var y = Math.floor(m / 12), r = m % 12, parts = [];
    if (y) parts.push(plural(y, 'year', 'years'));
    if (r) parts.push(plural(r, 'month', 'months'));
    return parts.join(' and ');
  }
  function $d(dollars) { return SW.fmt.money(Math.round(dollars * 100)); } // dollars -> money text (dots while hidden)

  // ---------- Chart: lines over months, drawn at the host's real width ----------
  function niceStep(raw) {
    if (raw <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function axisLabel(v) {
    if (SW.fmt.hidden) return '••••';
    if (v === 0) return '$0';
    if (v >= 1e6) return '$' + Number((v / 1e6).toFixed(2)) + 'm';
    if (v >= 1000) return '$' + Number((v / 1000).toFixed(1)) + 'k';
    return '$' + v;
  }
  var chartUid = 0;
  function chart(host, getSpec, SWr) {
    var s = SWr.dom.s, svg = null;
    function draw(W) {
      var spec = getSpec(), mobile = W < 520;
      var H = mobile ? 220 : 260, L = mobile ? 48 : 56, R = 14, T = 12, B = 30;
      var hi = 0;
      spec.series.forEach(function (se) { se.values.forEach(function (v) { if (v > hi) hi = v; }); });
      var step = niceStep(hi / (mobile ? 4 : 5)), top = Math.max(step, Math.ceil(hi / step) * step);
      var n = spec.months;
      var x = function (m) { return L + (n ? m / n : 0) * (W - L - R); };
      var y = function (v) { return T + (1 - v / top) * (H - T - B); };
      var next = s('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': spec.ariaLabel, class: 'chart wi-svg' });
      chartUid += 1;
      var id = 'wi' + chartUid, defs = s('defs');
      var glow = s('filter', { id: id + '-glow', x: '-20%', y: '-50%', width: '140%', height: '200%' });
      glow.appendChild(s('feGaussianBlur', { stdDeviation: '3', result: 'b' }));
      var mg = s('feMerge'); mg.appendChild(s('feMergeNode', { in: 'b' })); mg.appendChild(s('feMergeNode', { in: 'SourceGraphic' }));
      glow.appendChild(mg); defs.appendChild(glow);
      spec.series.forEach(function (se, k) {
        if (!se.hatch) return;
        var p = s('pattern', { id: id + '-h' + k, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
        p.appendChild(s('rect', { width: 2.5, height: 6, class: 'f-' + se.hatch }));
        defs.appendChild(p);
      });
      next.appendChild(defs);
      for (var g = 0; g <= top + step / 2; g += step) {
        next.appendChild(s('line', { x1: L, x2: W - R, y1: y(g), y2: y(g), class: g === 0 ? 's-zero' : 's-grid' }));
        var t = s('text', { x: L - 8, y: y(g) + 4, class: 'ax money', 'text-anchor': 'end' }); t.textContent = axisLabel(g); next.appendChild(t);
      }
      var useYears = n > 36, unit = useYears ? 12 : 1, choices = useYears ? [1, 2, 5, 10] : [1, 3, 6, 12];
      var every = choices[choices.length - 1];
      for (var c = 0; c < choices.length; c++) if (choices[c] * unit / Math.max(1, n) * (W - L - R) >= 44) { every = choices[c]; break; }
      for (var m = 0; m <= n; m += every * unit) {
        if (m > 0 && x(m) > W - R - 22) continue;
        var lab = m === 0 ? 'Now' : (m / unit) + (useYears ? ' yr' : ' mo');
        var tt = s('text', { x: m === 0 ? L : x(m), y: H - 8, class: 'ax', 'text-anchor': m === 0 ? 'start' : 'middle' }); tt.textContent = lab; next.appendChild(tt);
      }
      spec.series.forEach(function (se, k) {
        var pts = se.values.map(function (v, j) { return x(j).toFixed(1) + ',' + y(v).toFixed(1); });
        if (se.hatch) next.appendChild(s('path', { d: 'M' + x(0) + ' ' + y(0) + ' L' + pts.join(' L') + ' L' + x(se.values.length - 1) + ' ' + y(0) + ' Z', fill: 'url(#' + id + '-h' + k + ')', class: 'wi-area' }));
        next.appendChild(s('polyline', { points: pts.join(' '), class: 'wi-line ' + se.cls + (se.dashed ? ' wi-dashed' : ''), filter: se.glow ? 'url(#' + id + '-glow)' : null }));
        if (se.dot) { var last = se.values.length - 1; next.appendChild(s('circle', { cx: x(last), cy: y(se.values[last]), r: 4.5, class: se.dot })); }
      });
      if (svg && svg.parentNode === host) host.replaceChild(next, svg); else host.appendChild(next);
      svg = next;
    }
    return SWr.charts.responsive(host, draw);
  }

  // The tab and what the reader typed outlive a repaint of this screen, whoever
  // repaints it; moving to another screen starts fresh.
  var keep = null;
  window.addEventListener('hashchange', function () { if (keep && keep.hash !== location.hash) keep = null; });

  SW.screens.register('what-if', {
    render: function (wrap, ctx) {
      var store = ctx.store, C = ctx.calc, dom = ctx.dom, h = dom.h, K = SW.formKit, W = SW.models.whatIf;
      var MC = function (c, o) { return dom.moneyCents(c, o); };
      var TC = function (c, o) { return SW.fmt.money(c, o); };
      var MD = function (d) { return h('span', { class: 'money', text: $d(d) }); };
      var state = keep && keep.hash === location.hash ? keep.state : { tab: 'savings', savings: copy(SAVINGS), home: copy(HOME), loan: copy(LOAN), loanFrom: null, rateFrom: 'example' };
      keep = { hash: location.hash, state: state };
      var result = null, chartCtl = null, liveTimer = 0;

      var st = store.status();
      wrap.appendChild(ctx.app.screenHeader(ctx.route, { eyebrow: 'Example inputs' + (st.hasSample ? ' · Sample data' : '') }));
      var grid = h('div', { class: 'wi-grid' });
      wrap.appendChild(grid);

      var chartCard = h('section', { class: 'card wi-chart-card', 'aria-labelledby': 'wi-chart-h' });
      var legend = h('ul', { class: 'legend wi-legend', 'aria-label': 'Chart key' });
      var host = h('div', { class: 'chart-host wi-chart' });
      var sub = h('p', { class: 'fine' });
      chartCard.appendChild(h('div', { class: 'card-h' }, [
        h('div', {}, [h('h2', { id: 'wi-chart-h', text: 'Illustration' }), sub]),
        dom.seg('Scenario', [{ value: 'savings', label: 'Savings' }, { value: 'loan', label: 'Loan' }, { value: 'home', label: 'Home' }], state.tab,
          function (v) { state.tab = v; buildInputs(); update(); ctx.app.announce(v === 'savings' ? 'Savings illustration' : v === 'loan' ? 'Loan illustration' : 'Home loan illustration'); })
      ]));
      chartCard.appendChild(host);
      chartCard.appendChild(legend);
      chartCard.appendChild(h('p', { class: 'note', text: 'An illustration, not a prediction. For education only, not financial advice.' }));

      var resultCard = h('section', { class: 'card wi-result', 'aria-labelledby': 'wi-res-h' });
      var resBody = h('div', { class: 'wi-res-body' });
      var howBtn = h('button', { type: 'button', class: 'linkbtn', text: 'How this works' });
      var howPanel = h('div', { class: 'explainer' });
      var tableWrap = h('details', { class: 'more' });
      dom.disclosure(howBtn, howPanel);
      var live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
      resultCard.appendChild(h('p', { class: 'eyebrow', id: 'wi-res-h', text: 'Illustration' }));
      [resBody, h('div', { class: 'wi-foot' }, howBtn), howPanel, tableWrap, h('p', { class: 'note body-note', text: 'This is an illustration, not a prediction. Real rates vary, and money can also fall in value. For education only, not financial advice.' }), live]
        .forEach(function (n) { resultCard.appendChild(n); });

      var inputsCard = h('section', { class: 'card wi-inputs', 'aria-labelledby': 'wi-in-h' });
      var inputsBody = h('div', { class: 'wi-fields', role: 'group', 'aria-labelledby': 'wi-in-h' });
      var resetBtn = h('button', { type: 'button', class: 'btn small quiet', text: 'Back to the example inputs' });
      resetBtn.addEventListener('click', function () {
        if (state.tab === 'loan') { state.loan = copy(LOAN); state.loanFrom = null; state.rateFrom = 'example'; }
        else state[state.tab] = copy(state.tab === 'savings' ? SAVINGS : HOME);
        buildInputs(); update(); ctx.app.announce('Example inputs restored');
      });
      var inNote = h('p', { class: 'note body-note' });
      inputsCard.appendChild(h('div', { class: 'card-h' }, [h('h2', { id: 'wi-in-h', text: 'Change the inputs' }), h('span', { class: 'chip sample', text: 'Example inputs' })]));
      inputsCard.appendChild(inputsBody);
      inputsCard.appendChild(h('div', { class: 'wi-foot' }, resetBtn));
      inputsCard.appendChild(inNote);

      grid.appendChild(h('div', { class: 'wi-col' }, [chartCard, resultCard]));
      grid.appendChild(h('div', { class: 'wi-col' }, inputsCard));

      function speak() { clearTimeout(liveTimer); liveTimer = setTimeout(function () { live.textContent = resBody.textContent; }, 700); }

      // ---------- Inputs ----------
      function fmtSlider(f, v) { return f.kind === 'money' ? $d(v) : f.kind === 'rate' ? rateText(v) + ' a year' : plural(v, 'year', 'years'); }
      function buildInputs() {
        dom.clear(inputsBody);
        if (state.tab === 'loan') { buildLoanInputs(); return; }
        inNote.textContent = 'Each rate here is an example, not a rate from any product. The figures redraw as you move a slider. Nothing you change is saved.';
        SLIDERS[state.tab].forEach(function (f) {
          var id = 'wi-' + state.tab + '-' + f.key, val = state[state.tab][f.key];
          var out = h('output', { for: id, class: f.kind === 'money' ? 'money wi-val' : 'wi-val', text: fmtSlider(f, val) });
          var input = h('input', { id: id, type: 'range', min: f.min, max: f.max, step: f.step, value: val, 'aria-valuetext': fmtSlider(f, val) });
          input.addEventListener('input', function () {
            var v = Number(input.value);
            state[state.tab][f.key] = v;
            out.textContent = fmtSlider(f, v);
            input.setAttribute('aria-valuetext', fmtSlider(f, v));
            update(); speak();
          });
          inputsBody.appendChild(h('div', { class: 'field wi-field' }, [
            h('div', { class: 'wi-lab' }, [h('label', { for: id, text: f.label }), out]), input,
            h('div', { class: 'wi-range', 'aria-hidden': 'true' }, [h('span', { text: fmtSlider(f, f.min) }), h('span', { text: fmtSlider(f, f.max) })])
          ]));
        });
      }
      function debtAccounts() {
        var accts = store.list('accounts').filter(function (a) { return C.isDebtType(a.type); });
        if (!accts.length) return [];
        var t = C.totalsOn(accts, store.list('balances'), store.today());
        return t.rows.filter(function (r) { return r.cents > 0; }).map(function (r) { return { account: r.account, cents: r.cents, entry: r.entry }; });
      }
      var loanFields = null;
      function buildLoanInputs() {
        var L = state.loan, debts = debtAccounts();
        inNote.textContent = 'Type your own figures, or start from one of your debts. A rate you didn’t type or bring from your account is an example. The extra amounts are only ever yours to try. Nothing you change is saved.';
        if (debts.length) {
          var from = K.field({ label: 'Start from one of your debts', kind: 'select', value: state.loanFrom || '', optional: true,
            options: [['', 'Example inputs']].concat(debts.map(function (d) { return [d.account.id, d.account.name + ' · ' + TC(d.cents) + ' owed']; })) });
          from.input.addEventListener('change', function () {
            var d = debts.filter(function (x) { return x.account.id === from.input.value; })[0];
            if (!d) { state.loan = copy(LOAN); state.loanFrom = null; state.rateFrom = 'example'; }
            else {
              state.loanFrom = d.account.id; state.loan.balanceCents = d.cents;
              if (d.account.aprBps !== null && d.account.aprBps !== undefined) { state.loan.rateBps = d.account.aprBps; state.rateFrom = 'account'; }
              else state.rateFrom = 'example';
            }
            buildInputs(); update(); speak();
            var s = inputsBody.querySelector('select'); if (s) s.focus();
          });
          inputsBody.appendChild(from.el);
        }
        var acct = state.loanFrom ? store.get('accounts', state.loanFrom) : null;
        var rateHint = state.rateFrom === 'account' ? 'The rate you entered for ' + acct.name + '.' : state.rateFrom === 'typed' ? 'The rate you typed.' : 'An example rate. Type the rate on your statement to use your own.';
        loanFields = {
          balance: K.field({ label: 'Balance owed', kind: 'money', value: L.balanceCents, hint: acct ? 'From the balance you entered for ' + acct.name + '.' : null }),
          rate: K.field({ label: 'Yearly rate (%)', kind: 'text', value: bpsText(L.rateBps).replace('%', ''), hint: rateHint }),
          payment: K.field({ label: 'Paid at the end of each month', kind: 'money', value: L.paymentCents }),
          extra: K.field({ label: 'Extra each month', kind: 'money', value: L.extraCents, optional: true }),
          lump: K.field({ label: 'A one-off extra amount', kind: 'money', value: L.lumpCents, optional: true }),
          lumpMonth: K.field({ label: 'Paid with payment number', kind: 'text', value: String(L.lumpMonth || 1), optional: true })
        };
        loanFields.rate.input.setAttribute('inputmode', 'decimal');
        loanFields.lumpMonth.input.setAttribute('inputmode', 'numeric');
        loanFields.rate.input.addEventListener('input', function () {
          state.rateFrom = 'typed';
          var hint = loanFields.rate.el.querySelector('.fk-hint'); if (hint) hint.textContent = 'The rate you typed.';
        });
        Object.keys(loanFields).forEach(function (k) {
          loanFields[k].input.addEventListener('input', function () { readLoan(); update(); speak(); });
          inputsBody.appendChild(loanFields[k].el);
        });
      }
      // Reads the loan fields into state; marks bad ones. -> true when all can be used.
      function readLoan() {
        var f = loanFields, L = state.loan, ok = true;
        Object.keys(f).forEach(function (k) { f[k].clear(); });
        var b = f.balance.money();
        if (!b.ok) { f.balance.error(b.message); ok = false; } else if (b.cents <= 0) { f.balance.error('Use an amount above $0.00.'); ok = false; } else L.balanceCents = b.cents;
        var r = window.SWSchema.parseMoney(f.rate.input.value.replace('%', ''));
        if (!f.rate.input.value.trim()) { f.rate.error('Enter a rate, such as 6.9.'); ok = false; }
        else if (!r.ok) { f.rate.error(r.message === 'Use at most 2 decimal places.' ? r.message : 'Enter a rate, such as 6.9.'); ok = false; }
        else if (r.cents < 0 || r.cents > 10000) { f.rate.error('Use a rate from 0 to 100.'); ok = false; } else L.rateBps = r.cents;
        var p = f.payment.money();
        if (!p.ok) { f.payment.error(p.message); ok = false; } else if (p.cents <= 0) { f.payment.error('Use an amount above $0.00.'); ok = false; } else L.paymentCents = p.cents;
        var e = f.extra.money();
        if (!e.ok) { f.extra.error(e.message); ok = false; } else if (e.cents !== null && e.cents < 0) { f.extra.error('Use an amount of $0.00 or more.'); ok = false; } else L.extraCents = e.cents;
        var l = f.lump.money();
        if (!l.ok) { f.lump.error(l.message); ok = false; } else if (l.cents !== null && l.cents < 0) { f.lump.error('Use an amount of $0.00 or more.'); ok = false; } else L.lumpCents = l.cents;
        var lm = f.lumpMonth.text();
        if (lm && !/^[0-9]{1,3}$/.test(lm)) { f.lumpMonth.error('Use a whole number, such as 1 for the first payment.'); ok = false; }
        else L.lumpMonth = lm ? Math.max(1, Number(lm)) : 1;
        state.loanOk = ok;
        return ok;
      }

      // ---------- Results ----------
      function setHow(nodes) { dom.clear(howPanel); howPanel.appendChild(h('h3', { text: 'How this works' })); nodes.forEach(function (n) { n.classList.add('body-note'); howPanel.appendChild(n); }); }
      function setTable(summary, cols, rows) {
        dom.clear(tableWrap);
        tableWrap.hidden = !summary;
        if (!summary) return;
        tableWrap.appendChild(h('summary', { text: summary }));
        tableWrap.appendChild(h('div', { class: 'tablewrap' }, h('table', { class: 'numtable' }, [
          h('caption', { class: 'sr-only', text: 'Illustration by year' }),
          h('thead', {}, h('tr', {}, cols.map(function (c) { return h('th', { scope: 'col', text: c }); }))),
          h('tbody', {}, rows.map(function (r) { return h('tr', {}, [h('th', { scope: 'row', text: r[0] })].concat(r.slice(1).map(function (v) { return h('td', {}, h('span', { class: 'money', text: v })); }))); }))
        ])));
      }

      function renderSavings() {
        var inp = state.savings, r = W.savings(inp);
        result = { months: r.months, series: [
          { name: 'Balance at the example rate', values: r.points, cls: 's-ledger wi-main', glow: true, dot: 'f-net', sw: 'wi-sw-main' },
          { name: 'Money put in', values: r.putInPoints, cls: 'wi-contrib', dashed: true, sw: 'wi-sw-contrib' }
        ], ariaLabel: 'Illustration over ' + plural(inp.years, 'year', 'years') + ': the balance at an example ' + rateText(inp.ratePct) + ' a year rises from ' + $d(inp.start) + ' to ' + $d(r.final) + ', against ' + $d(r.putIn) + ' of money put in, shown dashed.' };
        sub.textContent = 'Savings at an example rate of ' + rateText(inp.ratePct) + ' a year';
        dom.clear(resBody);
        resBody.appendChild(h('p', { class: 'wi-big' }, MD(r.final)));
        resBody.appendChild(h('p', { class: 'wi-sentence' }, ['Say you put in ', MD(inp.start), ' to start, and add ', MD(inp.monthly),
          ' at the end of each month. At an example rate of ' + rateText(inp.ratePct) + ' a year, compounded monthly, the balance after ' + plural(inp.years, 'year', 'years') + ' would be ',
          MD(r.final), '. You’d have put in ', MD(r.putIn), ', and ', MD(r.interest), ' would be interest at the example rate.']));
        setHow([
          h('p', { text: 'Each month the balance earns the example yearly rate divided by 12, and that interest is added to the balance: interest compounds monthly. The amount you add goes in at the end of each month.' }),
          h('p', { text: 'The balance is worked out in one go for each month: the starting amount times (1 + monthly rate) raised to the number of months, plus the monthly amount times ((1 + monthly rate) raised to the number of months, minus 1) divided by the monthly rate. At 0% it is exactly the money put in.' }),
          h('p', { text: 'Only the final figure is rounded, half up to the cent. This is the compound interest calculator’s method.' })
        ]);
        setTable('Show the numbers by year', ['Year', 'Money put in', 'Balance, illustration'], r.yearly.map(function (y) { return [y.year === 0 ? 'Start' : 'Year ' + y.year, $d(y.putIn), $d(y.balance)]; }));
      }

      function renderLoan() {
        var L = state.loan, ok = loanFields ? state.loanOk !== false : true;
        var acct = state.loanFrom ? store.get('accounts', state.loanFrom) : null;
        var hatch = acct && acct.type === 'credit_card' ? 'card' : 'loan';
        var rateWords = state.rateFrom === 'account' ? 'the yearly rate you entered (' + bpsText(L.rateBps) + ')' : state.rateFrom === 'typed' ? 'a yearly rate of ' + bpsText(L.rateBps) : 'an example yearly rate of ' + bpsText(L.rateBps);
        sub.textContent = (acct ? acct.name : 'A loan') + (state.rateFrom === 'example' ? ' at an example rate of ' : ' at ') + bpsText(L.rateBps) + ' a year';
        dom.clear(resBody);
        if (!ok) {
          result = { months: 1, series: [], ariaLabel: 'No illustration until every input can be read.' };
          resBody.appendChild(h('p', { class: 'wi-sentence', text: 'Check the inputs marked in the form. The illustration redraws when each one can be read.' }));
          setHow([]); setTable(null); return;
        }
        var base = W.loan({ balanceCents: L.balanceCents, rateBps: L.rateBps, paymentCents: L.paymentCents });
        var extra = (L.extraCents || 0) > 0 || (L.lumpCents || 0) > 0;
        var withX = extra ? W.loan(L) : null;
        if (base.never || base.tooLong) {
          result = { months: 1, series: [{ name: 'Balance owed', values: [L.balanceCents / 100, L.balanceCents / 100], cls: 's-' + hatch, hatch: hatch, sw: 'wi-sw-' + hatch }], ariaLabel: 'No illustration: at these inputs the balance would not reach zero.' };
          resBody.appendChild(h('p', { class: 'wi-big', text: base.never ? 'Would not reach zero' : 'More than 50 years' }));
          resBody.appendChild(h('p', { class: 'wi-sentence' }, base.never
            ? ['At these inputs the balance would not reach zero: the first month’s interest, ', MC(base.firstInterestCents), ', is as much as the ', MC(L.paymentCents), ' paid each month, or more.']
            : ['At these inputs the balance would take more than 50 years to reach zero, so no figure is shown.']));
        } else {
          result = { months: Math.max(base.months, withX && withX.months ? withX.months : 0), series: [
            { name: 'Balance owed', values: base.points.map(function (c) { return c / 100; }), cls: 's-' + hatch + ' wi-main', hatch: hatch, dot: 'f-' + hatch, sw: 'wi-sw-' + hatch }
          ], ariaLabel: 'Illustration: a balance of ' + TC(L.balanceCents) + ' at ' + bpsText(L.rateBps) + ' a year, with ' + TC(L.paymentCents) + ' paid each month, reaches zero with the ' + ordinal(base.months) + ' payment.' };
          if (withX && withX.months) {
            result.series.push({ name: 'With the extra amounts you typed', values: withX.points.map(function (c) { return c / 100; }), cls: 's-ink', dashed: true, sw: 'wi-sw-ink' });
            result.ariaLabel += ' With the extra amounts you typed, the dashed line reaches zero with the ' + ordinal(withX.months) + ' payment.';
          }
          resBody.appendChild(h('p', { class: 'wi-big' }, [plural(base.months, 'payment', 'payments'), h('span', { class: 'wi-big-sub' }, [' · ', MC(base.interestCents), ' interest'])]));
          resBody.appendChild(h('p', { class: 'wi-sentence' }, ['With a balance of ', MC(L.balanceCents), ', ' + rateWords + ' and ', MC(L.paymentCents),
            ' paid at the end of each month, the balance would reach zero with the ' + ordinal(base.months) + ' payment' + (base.months >= 12 ? ' (' + span(base.months) + ')' : '') + ', which would be ',
            MC(base.lastPaymentCents), '. Interest over that time would come to ', MC(base.interestCents), '.']));
          if (withX) {
            var parts = [];
            if ((L.extraCents || 0) > 0) parts.push(TC(L.extraCents) + ' more each month');
            if ((L.lumpCents || 0) > 0) parts.push('a one-off ' + TC(L.lumpCents) + ' with the ' + ordinal(L.lumpMonth) + ' payment');
            var box = h('div', { class: 'well wi-with' });
            box.appendChild(h('p', { class: 'wi-with-h', text: 'With the extra amounts you typed: ' + parts.join(' and ') }));
            if (withX.months) {
              var dm = base.months - withX.months, di = base.interestCents - withX.interestCents;
              box.appendChild(h('p', { class: 'wi-sentence' }, ['The balance would reach zero with the ' + ordinal(withX.months) + ' payment, which would be ', MC(withX.lastPaymentCents),
                '. Interest would come to ', MC(withX.interestCents), '. That is ' + plural(dm, 'payment', 'payments') + ' fewer and ', MC(di), ' less interest than without the extra amounts.']));
            } else {
              box.appendChild(h('p', { class: 'wi-sentence', text: 'With these amounts the balance would not reach zero within 50 years either.' }));
            }
            resBody.appendChild(box);
          }
        }
        setHow([
          h('p', { text: 'How this works: each month, interest is the balance × ' + bpsText(L.rateBps) + ' ÷ 12, rounded to the cent, then the payment comes off. The last payment is what is left. The rate stays the same and nothing else is added. Not a prediction.' }),
          h('p', { text: 'Interest is the interest of every month added up. The extra amounts, if you typed any, come off with the regular payment. This shows time and interest only. It does not say which debt to repay first, or compare repaying with saving.' })
        ]);
        if (base.never || base.tooLong) { setTable(null); return; }
        var rows = [['Start', TC(L.balanceCents), TC(0)]];
        for (var k = 12; k < base.months; k += 12) rows.push(['After payment ' + k, TC(base.points[k]), TC(base.interestPoints[k])]);
        rows.push(['After payment ' + base.months, TC(0), TC(base.interestCents)]);
        setTable('Show the numbers by year', ['', 'Still owed, illustration', 'Interest so far'], rows);
      }

      function renderHome() {
        var inp = state.home, r = W.home(inp);
        result = { months: r.months, series: [
          { name: 'Home loan owed', values: r.points, cls: 's-loan wi-main', hatch: 'loan', sw: 'wi-sw-loan' },
          { name: 'Interest paid so far', values: r.interestPoints, cls: 's-ink', dashed: true, dot: 'f-ink', sw: 'wi-sw-ink' }
        ], ariaLabel: 'Illustration: a home loan of ' + $d(inp.amount) + ' at an example ' + rateText(inp.ratePct) + ' a year, repaid in equal monthly payments over ' + plural(inp.years, 'year', 'years') + '. The dashed line shows interest paid so far, reaching ' + $d(r.interest) + '.' };
        sub.textContent = 'A home loan at an example rate of ' + rateText(inp.ratePct) + ' a year';
        dom.clear(resBody);
        resBody.appendChild(h('p', { class: 'wi-big' }, [MD(r.payment), h('span', { class: 'wi-big-sub', text: ' a month' })]));
        resBody.appendChild(h('p', { class: 'wi-sentence' }, ['If you borrow ', MD(inp.amount), ' at an example rate of ' + rateText(inp.ratePct) + ' a year, with interest worked out monthly, and repay it in equal payments at the end of each month for ' + plural(inp.years, 'year', 'years') + ' (' + (inp.years * 12) + ' payments), each payment would be ',
          MD(r.payment), '. Interest over the ' + plural(inp.years, 'year', 'years') + ' would be ', MD(r.interest), '.']));
        setHow([
          h('p', { text: 'The payment is the one equal amount that brings what is owed to zero after the last month: the amount borrowed times the monthly rate, divided by (1 minus (1 + monthly rate) raised to minus the number of payments). The monthly rate is the example yearly rate divided by 12.' }),
          h('p', { text: 'Interest is the exact payment times the number of payments, minus the amount borrowed. Only the final figures are rounded, half up to the cent, so the rounded payment times ' + (inp.years * 12) + ' can differ a little from the amount borrowed plus that interest.' }),
          h('p', { text: 'It leaves out taxes, insurance and fees, which a real home loan payment can include.' })
        ]);
        var rows = [['Start', $d(inp.amount), $d(0)]];
        for (var y = 1; y <= inp.years; y++) rows.push(['Year ' + y, $d(r.points[y * 12]), $d(y === inp.years ? r.interest : r.interestPoints[y * 12])]);
        setTable('Show the numbers by year', ['After', 'Still owed, illustration', 'Interest so far'], rows);
      }

      function drawLegend() {
        dom.clear(legend);
        result.series.forEach(function (se) {
          legend.appendChild(h('li', {}, [h('span', { class: 'sw ' + se.sw + (se.hatch ? ' hatch bg-' + se.hatch : '') }), se.name + (se.dashed ? ', dashed' : '')]));
        });
      }
      function update() {
        if (state.tab === 'savings') renderSavings(); else if (state.tab === 'loan') renderLoan(); else renderHome();
        drawLegend();
        if (chartCtl) chartCtl.redraw(); else chartCtl = chart(host, function () { return result; }, { dom: dom, charts: ctx.charts });
      }

      buildInputs();
      update();
      return {
        // Inputs here are not stored, so keep what the reader typed; a settings change
        // (Hide amounts) redraws the figures in place.
        onStoreChange: function (ev) { if (ev && ev.stores && ev.stores.indexOf('settings') >= 0) { buildInputs(); update(); } return true; },
        destroy: function () { clearTimeout(liveTimer); if (chartCtl) chartCtl.destroy(); }
      };
    }
  });
})();
