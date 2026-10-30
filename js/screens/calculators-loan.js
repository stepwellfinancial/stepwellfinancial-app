/* Calculators: the loan amortization calculator (the second tool on #/calculators).
   The maths is js/amortize.js (pure). This file only reads the three fields, calls it
   and draws the answer: a stacked bar chart of what is paid each year, the figures in
   words, and a table behind a button.
   Nothing here is stored or put in the address. Every money figure goes through $$(),
   so "Hide amounts" shows dots in the page, the chart, the aria text and the titles.
   What was typed is kept in a variable on this page only, so a repaint of the screen
   (Hide amounts with an error showing) does not lose it; leaving the screen drops it.
   No HTML strings: createElement only. */
(function () {
  'use strict';
  var SW = window.SW;
  if (!SW || !SW.screens) return;
  var Z = window.Amortize;

  var EXAMPLE = { cents: 2500000, rate: '6.5', term: '5' };
  var LIVE_DELAY = 700;

  // ---------- What was typed, kept in memory only ----------
  var mem = null;
  window.addEventListener('hashchange', function () { if (mem && mem.hash !== location.hash) mem = null; });
  function remember(patch) {
    if (!mem || mem.hash !== location.hash) mem = { hash: location.hash };
    Object.keys(patch).forEach(function (k) { mem[k] = patch[k]; });
  }
  function recall() { return mem && mem.hash === location.hash ? mem : {}; }

  var uid = 0;

  function create(ctx) {
    var dom = ctx.dom, h = dom.h, s = dom.s, F = SW.fmt, K = SW.formKit;
    var el = h('div', { class: 'cl-loan' });
    var f = null;                 // the three fields
    var current = null;           // { inp, sch } when the inputs give a schedule, else null
    var sel = 1;                  // the year chosen on the chart
    var chartDirty = false, tableDirty = true, tableMode = 'rows', liveTimer = 0, geo = null;
    var saved = recall();

    // Money text while amounts are shown, dots while hidden.
    function $$(cents) { return F.hidden ? F.HIDDEN : Z.money(cents); }

    // ---------- Results card ----------
    var resultCard = h('section', { class: 'card cl-result', 'aria-labelledby': 'cl-res-h' });
    var chipRes = h('span', { class: 'chip sample', text: 'Example inputs' });
    resultCard.appendChild(h('div', { class: 'card-h' }, [
      h('div', {}, [
        h('p', { class: 'eyebrow', text: 'Illustration' }),
        h('h2', { id: 'cl-res-h', class: 'cs-h3 cl-h' }, [dom.icon('house', 'cl-ico'), 'Loan amortization'])
      ]),
      chipRes
    ]));
    var msg = h('p', { class: 'cl-msg' });
    var body = h('div', { class: 'cl-body' });
    var live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
    resultCard.appendChild(msg);
    resultCard.appendChild(body);
    resultCard.appendChild(live);

    var host = h('div', { class: 'cl-chart' });
    var bars = h('div', { class: 'cl-bars', role: 'group', 'aria-label': 'Paid each year' });
    var readout = h('p', { class: 'cl-readout', 'aria-live': 'polite' });
    var caption = h('p', { class: 'cl-caption' });
    var big = h('p', { class: 'cl-big' });
    var text = h('div', { class: 'cl-text' });
    var howBtn = h('button', { type: 'button', class: 'linkbtn cl-link', text: 'How this works' });
    var howPanel = h('div', { class: 'explainer' }, [
      h('p', { text: 'Each month, interest is the balance x the yearly rate / 12, rounded to the cent. The payment comes off, and what is left is the new balance. The rate stays the same and nothing else is added.' }),
      h('p', { text: 'The monthly payment is the amount borrowed x the monthly rate / (1 - (1 + the monthly rate) raised to minus the number of payments), rounded to the cent. The monthly rate is the yearly rate / 12. At 0%, the payment is the amount borrowed / the number of payments.' }),
      h('p', { text: 'The last payment is the balance left plus that month\'s interest, so the balance reaches zero. Total interest is the sum of the monthly interest, and the total paid is the sum of all payments.' })
    ]);
    dom.disclosure(howBtn, howPanel);
    var tableBtn = h('button', { type: 'button', class: 'linkbtn cl-link', text: 'Show the table' });
    var thead = h('thead'), tbody = h('tbody'), tcap = h('caption', { class: 'sr-only', text: 'Every payment' });
    var tableLive = h('p', { class: 'sr-only', 'aria-live': 'polite' });
    var rowsSwitch = dom.seg('Rows', [{ value: 'rows', label: 'Every payment' }, { value: 'years', label: 'By year' }], 'rows', function (v) {
      tableMode = v;
      drawTable();
      tableLive.textContent = v === 'rows' ? 'Showing every payment, ' + current.sch.rows.length + ' rows.' : 'Showing year by year, ' + current.sch.years.length + ' rows.';
    });
    rowsSwitch.classList.add('cl-seg');
    var tablePanel = h('div', { class: 'cl-tablebox' }, [
      rowsSwitch, tableLive,
      h('div', { class: 'cl-scroll', role: 'region', 'aria-label': 'Payment table', tabindex: '0' },
        h('table', { class: 'numtable cl-table' }, [tcap, thead, tbody]))
    ]);
    dom.disclosure(tableBtn, tablePanel, function () { if (tableDirty) drawTable(); });
    tableBtn.addEventListener('click', function () {
      tableBtn.textContent = tableBtn.getAttribute('aria-expanded') === 'true' ? 'Hide the table' : 'Show the table';
    });

    body.appendChild(h('h3', { class: 'cl-chart-h', text: 'Paid each year' }));
    body.appendChild(h('div', { class: 'cl-chart-wrap' }, [host, bars]));
    body.appendChild(h('ul', { class: 'legend cl-legend', 'aria-label': 'Chart key' }, [
      h('li', {}, [h('span', { class: 'sw cl-sw hatch bg-loan' }), 'Interest']),
      h('li', {}, [h('span', { class: 'sw cl-sw cl-sw-rep' }), 'Loan amount repaid'])
    ]));
    body.appendChild(readout);
    body.appendChild(caption);
    body.appendChild(big);
    body.appendChild(text);
    body.appendChild(h('div', { class: 'cl-foot' }, howBtn));
    body.appendChild(howPanel);
    body.appendChild(h('div', { class: 'cl-foot' }, tableBtn));
    body.appendChild(tablePanel);
    body.appendChild(h('p', { class: 'note body-note', text: 'This is an illustration, not a quote. A lender\'s own figures can differ, for example because of fees, how it counts days or how it rounds. Not a prediction.' }));
    body.appendChild(h('p', { class: 'note body-note cl-disclaimer', text: 'For education only, not financial advice.' }));

    // ---------- Inputs card ----------
    var inputsCard = h('section', { class: 'card cl-inputs', 'aria-labelledby': 'cl-in-h' });
    var chipIn = h('span', { class: 'chip sample', text: 'Example inputs' });
    var fieldsBox = h('div', { class: 'cs-fields' });
    var resetBtn = h('button', { type: 'button', class: 'btn small quiet cl-reset', text: 'Back to the example inputs' });
    inputsCard.appendChild(h('div', { class: 'card-h' }, [h('h2', { id: 'cl-in-h', class: 'cs-h3', text: 'Change the inputs' }), chipIn]));
    inputsCard.appendChild(fieldsBox);
    inputsCard.appendChild(h('div', { class: 'cs-foot' }, resetBtn));
    inputsCard.appendChild(h('p', { class: 'note body-note', text: 'These start as example inputs. Nothing you type here is saved.' }));

    // Results first, then the inputs: beside each other on a wide screen.
    el.appendChild(h('div', { class: 'cl-grid' }, [resultCard, inputsCard]));

    // ---------- Fields ----------
    function termHint(years) { return years === 1 ? '1 year is 12 monthly payments.' : years + ' years is ' + (years * 12) + ' monthly payments.'; }
    function buildFields(from) {
      dom.clear(fieldsBox);
      from = from || {};
      f = {
        amount: K.field({ label: 'Loan amount', kind: 'money', prefix: '$', value: EXAMPLE.cents }),
        rate: K.field({ label: 'Yearly interest rate (%)', kind: 'text', value: EXAMPLE.rate, cap: 'money' }),
        term: K.field({ label: 'Term in years', kind: 'text', value: EXAMPLE.term, cap: 'money', hint: termHint(Number(EXAMPLE.term)) })
      };
      if (from.amount !== undefined) f.amount.input.value = from.amount;
      if (from.rate !== undefined) f.rate.input.value = from.rate;
      if (from.term !== undefined) f.term.input.value = from.term;
      f.term.input.setAttribute('inputmode', 'numeric');
      ['rate', 'term'].forEach(function (k) { f[k].input.setAttribute('spellcheck', 'false'); });
      var parse = { amount: Z.parseAmount, rate: Z.parseRate, term: Z.parseTerm };
      ['amount', 'rate', 'term'].forEach(function (k) {
        var fk = f[k];
        // Typing: a field that shows an error follows what is typed; the rest waits for blur or Enter.
        fk.input.addEventListener('input', function () {
          var r = parse[k](fk.text());
          if (r.ok) fk.clear(); else if (fk.el.classList.contains('fk-bad')) fk.error(r.message);
          refresh(true);
        });
        fk.input.addEventListener('blur', function () { check(k); refresh(false); });
        fk.input.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          ['amount', 'rate', 'term'].forEach(check);
          K.focusFirstError(fieldsBox);
          refresh(false);
        });
        fieldsBox.appendChild(fk.el);
      });
      F.repaint(fieldsBox);   // while Hide amounts is on, a typed amount put back shows as dots at once
      (from.shown || []).forEach(check);   // a message that was showing is shown again
    }
    // Show or clear one field's message.
    function check(k) {
      var r = { amount: Z.parseAmount, rate: Z.parseRate, term: Z.parseTerm }[k](f[k].text());
      f[k].clear();
      if (!r.ok) f[k].error(r.message);
    }
    function readInputs() {
      var a = Z.parseAmount(f.amount.text()), r = Z.parseRate(f.rate.text()), t = Z.parseTerm(f.term.text());
      return { ok: a.ok && r.ok && t.ok, cents: a.cents, milli: r.milli, years: t.years, termOk: t.ok };
    }

    // ---------- Redraw ----------
    // typed: true when the reader changed a field (then the answer is read out after a pause).
    function refresh(typed) {
      var inp = readInputs();
      var hint = f.term.el.querySelector('.fk-hint');
      if (hint) hint.textContent = inp.termOk ? termHint(inp.years) : '';
      remember({ amount: f.amount.text(), rate: f.rate.text(), term: f.term.text(),
        shown: ['amount', 'rate', 'term'].filter(function (k) { return f[k].el.classList.contains('fk-bad'); }) });
      var res = inp.ok ? Z.schedule(inp.cents, inp.milli, inp.years) : null;
      chipRes.hidden = chipIn.hidden = !(inp.ok && inp.cents === EXAMPLE.cents && inp.milli === 6500 && inp.years === 5);
      dom.clear(tbody); dom.clear(thead); tableDirty = true;
      if (!inp.ok || !res.ok) {
        current = null;
        msg.hidden = false; body.hidden = true;
        msg.textContent = !inp.ok ? 'Check the inputs to see the schedule.' : Z.MSG.guard;
        chipRes.hidden = chipIn.hidden = true;
        drawChart();
        speak(typed, msg.textContent);
        return;
      }
      msg.hidden = true; body.hidden = false;
      var sameRun = current && current.inp.cents === inp.cents && current.inp.milli === inp.milli && current.inp.years === inp.years;
      current = { inp: inp, sch: res };
      if (!sameRun || sel > res.years.length) sel = 1;
      drawText();
      drawChart();
      if (tableBtn.getAttribute('aria-expanded') === 'true') drawTable();
      speak(typed, big.textContent + ' ' + text.textContent);
    }
    function speak(typed, words) {
      clearTimeout(liveTimer);
      if (!typed) return;
      liveTimer = setTimeout(function () { live.textContent = words; }, LIVE_DELAY);
    }

    function drawText() {
      var c = current, A = $$(c.inp.cents), r = Z.rateText(c.inp.milli), n = c.inp.years * 12, sch = c.sch;
      dom.clear(caption); dom.clear(text);
      caption.textContent = 'Illustration: a loan of ' + A + ' at a yearly rate of ' + r + '%, repaid in ' + n + ' monthly payments. Each bar is one year of payments.';
      big.textContent = $$(sch.payment) + ' a month';
      var lines = [
        'For a loan of ' + A + ' at a yearly rate of ' + r + '%, repaid in ' + n + ' monthly payments, the monthly payment would be ' + $$(sch.payment) + '.',
        'Interest is worked out each month, and each payment is made at the end of the month.',
        'Interest over ' + Z.yearsText(c.inp.years) + ' would come to ' + $$(sch.totalInterest) + ', and the total paid would be ' + $$(sch.totalPaid) + '.'
      ];
      if (sch.lastPayment !== sch.payment) lines.push('The last payment would be ' + $$(sch.lastPayment) + '. The monthly payment is rounded to the cent, so the last one can differ.');
      lines.push('After payment ' + sch.rows.length + ', the balance would reach ' + $$(0) + '.');
      lines.forEach(function (t) { text.appendChild(h('p', { class: 'cl-sentence', text: t })); });
      readout.textContent = readoutText(sel);   // here too, so it follows Hide amounts while the chart is not drawn
    }

    // ---------- The chart ----------
    function readoutText(y) {
      var d = current.sch.years[y - 1];
      return 'Year ' + y + ': paid ' + $$(d.paid) + ', of which interest ' + $$(d.interest) + ' and loan amount repaid ' + $$(d.repaid) + '. Balance at the end of the year: ' + $$(d.balance) + '.';
    }
    function niceStep(raw) {
      var p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
      return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
    }
    function axisText(v) {
      if (F.hidden) return F.HIDDEN;
      if (v === 0) return '$0';
      if (v >= 1e6) return '$' + Number((v / 1e6).toFixed(2)) + 'm';
      if (v >= 1000) return '$' + Number((v / 1000).toFixed(2)) + 'k';
      return '$' + (Number.isInteger(v) ? v : v.toFixed(2));
    }
    function showYear(y, focus) {
      sel = y;
      readout.textContent = readoutText(y);
      Array.prototype.forEach.call(bars.children, function (b, i) {
        b.setAttribute('aria-pressed', i + 1 === y ? 'true' : 'false');
        b.tabIndex = i + 1 === y ? 0 : -1;
      });
      if (geo && geo.band) { geo.band.setAttribute('x', (geo.L + (y - 1) * geo.cw).toFixed(1)); }
      if (focus && bars.children[y - 1]) bars.children[y - 1].focus();
    }
    // Draws now when the screen is showing, otherwise waits until it is (a hidden box has no width).
    function drawChart() {
      if (!current || el.hidden) {
        dom.clear(host); dom.clear(bars); geo = null;
        if (current) chartDirty = true;
        return;
      }
      chartCtl.redraw();
    }
    function draw(W) {
      var hadFocus = bars.contains(document.activeElement), keepAt = sel;
      dom.clear(host); dom.clear(bars); geo = null;
      if (!current) return;
      var ys = current.sch.years, Y = ys.length;
      var mobile = W < 520, plotH = mobile ? 190 : 240;
      var L = mobile ? 46 : 56, R = 8, T = 10, B = 30, H = plotH + T + B;
      var hi = 0;
      ys.forEach(function (d) { if (d.paid > hi) hi = d.paid; });
      var step = niceStep(hi / 100 / (mobile ? 3.5 : 4.5)), top = Math.max(step, Math.ceil(hi / 100 / step - 1e-9) * step);
      var pw = W - L - R, cw = pw / Y, bw = Math.max(2, Math.min(cw * 0.66, 44));
      var yv = function (dollars) { return T + (1 - dollars / top) * plotH; };
      var pid = 'cl-hatch-' + (++uid);
      var svg = s('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', focusable: 'false', class: 'chart cl-svg' + (bw < 10 ? ' cl-thin' : '') });
      var defs = s('defs');
      var pat = s('pattern', { id: pid, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
      pat.appendChild(s('rect', { width: 6, height: 6, class: 'f-loan', opacity: '.3' }));
      pat.appendChild(s('rect', { width: 2.6, height: 6, class: 'f-loan' }));
      defs.appendChild(pat); svg.appendChild(defs);
      var band = s('rect', { class: 'cl-band', x: (L + (sel - 1) * cw).toFixed(1), y: T - 2, width: cw.toFixed(1), height: plotH + 2, rx: 3 });
      svg.appendChild(band);
      for (var g = 0; g <= top + step / 2; g += step) {
        var gy = yv(g).toFixed(1);
        svg.appendChild(s('line', { x1: L, x2: W - R, y1: gy, y2: gy, class: g === 0 ? 's-zero' : 's-grid' }));
        svg.appendChild(s('text', { x: L - 8, y: Number(gy) + 4, class: 'ax', 'text-anchor': 'end' }, axisText(Number(g.toFixed(6)))));
      }
      ys.forEach(function (d, i) {
        var x = L + i * cw + (cw - bw) / 2, yBase = yv(0), yMid = yv(d.repaid / 100), yTop = yv(d.paid / 100);
        if (d.repaid > 0) svg.appendChild(s('rect', { x: x.toFixed(1), y: yMid.toFixed(1), width: bw.toFixed(1), height: (yBase - yMid).toFixed(1), class: 'cl-rep' }));
        if (d.interest > 0) svg.appendChild(s('rect', { x: x.toFixed(1), y: yTop.toFixed(1), width: bw.toFixed(1), height: Math.max(1, yMid - yTop).toFixed(1), class: 'cl-int', fill: 'url(#' + pid + ')' }));
      });
      // x labels: every year up to 12 bars, then years 1, 5, 10, 15 and so on
      svg.appendChild(s('text', { x: L - 8, y: H - 8, class: 'ax', 'text-anchor': 'end' }, 'Year'));
      ys.forEach(function (d, i) {
        if (Y <= 12 || d.year === 1 || d.year % 5 === 0) svg.appendChild(s('text', { x: (L + i * cw + cw / 2).toFixed(1), y: H - 8, class: 'ax', 'text-anchor': 'middle' }, String(d.year)));
      });
      var label = ys.map(function (d) {
        return 'Year ' + d.year + ': interest ' + $$(d.interest) + ', loan amount repaid ' + $$(d.repaid) + ', balance at the end of the year ' + $$(d.balance) + '.';
      }).join(' ') + ' The full list is in the table.';
      svg.setAttribute('aria-label', label);
      host.appendChild(svg);
      geo = { band: band, L: L, cw: cw };
      // One button per bar, laid over it. They are real buttons so the keyboard and screen readers can reach them.
      ys.forEach(function (d, i) {
        var b = h('button', { type: 'button', class: 'cl-bar', 'aria-label': 'Year ' + d.year, title: 'Year ' + d.year + ': paid ' + $$(d.paid) });
        b.style.left = (L + i * cw).toFixed(1) + 'px';
        b.style.top = T + 'px';
        b.style.width = cw.toFixed(1) + 'px';
        b.style.height = plotH + 'px';
        b.addEventListener('click', function () { showYear(d.year, false); });
        bars.appendChild(b);
      });
      showYear(Math.min(keepAt, Y), hadFocus);
    }
    bars.addEventListener('keydown', function (e) {
      if (!current) return;
      var Y = current.sch.years.length, to = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = sel + 1;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = sel - 1;
      else if (e.key === 'Home') to = 1;
      else if (e.key === 'End') to = Y;
      if (to === null) return;
      e.preventDefault();
      showYear(Math.max(1, Math.min(Y, to)), true);
    });
    var chartCtl = SW.charts.responsive(host, draw);

    // ---------- The table ----------
    function drawTable() {
      tableDirty = false;
      dom.clear(tbody); dom.clear(thead);
      if (!current) return;
      var sch = current.sch, byRow = tableMode === 'rows';
      var cols = byRow ? ['Payment no.', 'Payment', 'Interest', 'Loan amount repaid', 'Balance after'] : ['Year', 'Paid', 'Interest', 'Loan amount repaid', 'Balance at year end'];
      tcap.textContent = byRow ? 'Every payment' : 'By year';
      thead.appendChild(h('tr', {}, cols.map(function (c) { return h('th', { scope: 'col', text: c }); })));
      var frag = document.createDocumentFragment();
      function line(first, a, b, c, d) {
        var tr = document.createElement('tr'), th = document.createElement('th');
        th.scope = 'row'; th.textContent = String(first); tr.appendChild(th);
        [a, b, c, d].forEach(function (v) { var td = document.createElement('td'); td.textContent = v === null ? '' : $$(v); tr.appendChild(td); });
        return tr;
      }
      if (byRow) sch.rows.forEach(function (r) { frag.appendChild(line(r.no, r.payment, r.interest, r.repaid, r.balance)); });
      else sch.years.forEach(function (y) { frag.appendChild(line(y.year, y.paid, y.interest, y.repaid, y.balance)); });
      var tot = line('Total', sch.totalPaid, sch.totalInterest, current.inp.cents, null);
      tot.className = 'cl-total';
      frag.appendChild(tot);
      tbody.appendChild(frag);
    }

    resetBtn.addEventListener('click', function () {
      buildFields(); refresh(false);
      ctx.app.announce('Example inputs restored');
      f.amount.input.focus();
    });

    buildFields({ amount: saved.amount, rate: saved.rate, term: saved.term, shown: saved.shown });
    refresh(false);

    return {
      el: el,
      // The screen shows this calculator: draw what was waiting.
      shown: function () { chartDirty = false; if (current) chartCtl.redraw(); },
      // Hide amounts changed: every figure is built again, the typed text stays.
      settingsChanged: function () { refresh(false); },
      destroy: function () { clearTimeout(liveTimer); chartCtl.destroy(); }
    };
  }

  SW.loanCalculator = { create: create, remember: remember, recall: recall };
})();
