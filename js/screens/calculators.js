/* Calculators (concept F2): tools that run in the browser and keep nothing.
   Tonight: the compound interest calculator, ported from the calculator
   website. The maths is js/calc-site.js (the website's calc.js, unchanged) and
   the chart layout is js/chart-axis.js (the website's ChartAxis, unchanged), so
   the figures match the website's. This file only draws them.
   Nothing here is stored or put in the address. Every money figure is built
   with SW.dom.money / SW.fmt.text, so "Hide amounts" shows dots, in the page,
   the chart and the spoken text. No HTML strings: createElement only. */
(function () {
  'use strict';
  var SW = window.SW;
  if (!SW || !SW.screens) return;

  var C = window.CompoundCalc, A = window.ChartAxis;
  var money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  var DEFAULTS = { principal: 10000, monthly: 100, ratePct: '5', years: '10', frequency: 'monthly', timing: 'end' };
  var FREQ_LABELS = [['annually', 'Annually'], ['quarterly', 'Quarterly'], ['monthly', 'Monthly'], ['daily', 'Daily']];

  SW.screens.register('calculators', {
    render: function (wrap, ctx) {
      var dom = ctx.dom, h = dom.h, s = dom.s, F = SW.fmt, K = SW.formKit;
      var last = null;        // { raw, res } for the inputs that can be read, or null
      var chartCtl = null;

      // Money text while amounts are shown, dots while hidden. Works on a whole
      // sentence too: every "$figure" in it becomes the dots.
      // The growth multiples ("1.5×") and percents ("+6.8%") hide the same way, as the Overview's percents do.
      function M(text) {
        return F.hidden ? String(text).replace(/\$[0-9]\S*/g, F.HIDDEN).replace(/\+?[0-9][0-9,]*\.[0-9](?:×|%)/g, F.HIDDEN) : text;
      }
      function mon(v) { return dom.money(money.format(v)); }   // a tracked money span
      // Whole dollars when there are no cents ("$10,000"), cents otherwise.
      function whole(v) { return dom.money(Math.round(v * 100) % 100 === 0 ? money.format(v).replace(/\.00$/, '') : money.format(v)); }

      wrap.appendChild(ctx.app.screenHeader(ctx.route));

      // ---------- The switch: one calculator at a time ----------
      // Both calculators are built at once. The one not chosen is hidden, so it
      // keeps nothing on screen and nothing in the address (no URL state).
      var cbox = h('div', { class: 'cs-calc' });          // the compound interest calculator
      var loan = SW.loanCalculator.create(ctx);           // the loan amortization calculator
      var which = SW.loanCalculator.recall().which === 'loan' ? 'loan' : 'compound';
      var SWITCH = [['compound', 'Compound interest', 'growth'], ['loan', 'Loan amortization', 'house']];
      var switchBtns = {};
      var switchEl = h('div', { class: 'seg cs-switch', role: 'group', 'aria-label': 'Calculator' }, SWITCH.map(function (o) {
        var b = h('button', { type: 'button', 'aria-pressed': 'false' }, [dom.icon(o[2], 'cl-ico'), h('span', { text: o[1] })]);
        b.addEventListener('click', function () { if (which !== o[0]) pick(o[0], true); });
        switchBtns[o[0]] = b;
        return b;
      }));
      wrap.appendChild(h('div', { class: 'cs-switch-row' }, switchEl));
      wrap.appendChild(cbox);
      wrap.appendChild(loan.el);
      function pick(w, user) {
        which = w;
        SW.loanCalculator.remember({ which: w });
        cbox.hidden = w !== 'compound';
        loan.el.hidden = w !== 'loan';
        SWITCH.forEach(function (o) { switchBtns[o[0]].setAttribute('aria-pressed', o[0] === w ? 'true' : 'false'); });
        if (w === 'compound' && chartCtl) chartCtl.redraw(); else if (w === 'loan') loan.shown();
        if (user) ctx.app.announce(w === 'loan' ? 'Loan amortization' : 'Compound interest');
      }

      // ---------- Compound interest ----------
      cbox.appendChild(h('section', { class: 'cs-intro', 'aria-labelledby': 'cs-ci-h' }, [
        h('h2', { id: 'cs-ci-h', class: 'cs-h2' }, [dom.icon('growth', 'cl-ico'), 'Compound interest']),
        h('p', { class: 'cs-lede', text: 'See how money can grow when interest earns interest. Enter a starting amount, a monthly contribution and a rate. Results update as you type.' }),
        h('p', { class: 'cs-lede', text: 'The calculator explains how each result is worked out, so you can check every figure yourself. Stepwell Financial gives education and tools, not personal advice.' })
      ]));

      var grid = h('div', { class: 'cs-grid' });
      cbox.appendChild(grid);

      // Inputs
      var inputsCard = h('section', { class: 'card cs-inputs', 'aria-labelledby': 'cs-in-h' });
      var exampleChip = h('span', { class: 'chip sample', text: 'Example inputs' });
      var fieldsBox = h('div', { class: 'cs-fields' });
      var resetBtn = h('button', { type: 'button', class: 'btn small quiet', text: 'Back to the example inputs' });
      inputsCard.appendChild(h('div', { class: 'card-h' }, [h('h3', { id: 'cs-in-h', class: 'cs-h3', text: 'Your numbers' }), exampleChip]));
      inputsCard.appendChild(fieldsBox);
      inputsCard.appendChild(h('div', { class: 'cs-foot' }, resetBtn));
      inputsCard.appendChild(h('p', { class: 'note', text: 'Nothing you type here is saved.' }));
      grid.appendChild(inputsCard);

      var f = null;           // the form fields
      var timingEnd = null, timingStart = null;
      function buildInputs() {
        dom.clear(fieldsBox);
        // accepts: the form kit tidies a left money field only where the website's reader reads it as a number ("0,500" is not one).
        var readable = function (t) { return C.classifyAmount(t, true) === 'ok'; };
        f = {
          principal: K.field({ label: 'Initial deposit', kind: 'money', value: DEFAULTS.principal * 100, accepts: readable }),
          monthly: K.field({ label: 'Monthly contribution', kind: 'money', value: DEFAULTS.monthly * 100, accepts: readable }),
          ratePct: K.field({ label: 'Annual interest rate (%)', kind: 'text', value: DEFAULTS.ratePct, cap: 'money' }),
          years: K.field({ label: 'Years to grow', kind: 'text', value: DEFAULTS.years, cap: 'money' }),
          frequency: K.field({ label: 'Compounding', kind: 'select', value: DEFAULTS.frequency, options: FREQ_LABELS })
        };
        // The rate gets the decimal keypad on a phone, as on the website; data-plain-number tells the Hide amounts audit
        // (which treats a decimal-keypad field as an amount) that it is not one.
        f.ratePct.input.setAttribute('inputmode', 'decimal');
        f.ratePct.input.setAttribute('data-plain-number', '');
        f.years.input.setAttribute('inputmode', 'numeric');
        f.ratePct.input.setAttribute('spellcheck', 'false');
        f.years.input.setAttribute('spellcheck', 'false');
        // Typing a number (calc-site.js, "Typed numbers"), as on the website: an unfinished number such as "250,"
        // leaves the last result on screen, so no wrong figure and no message flashes between keystrokes; a real
        // mistake still shows its message at once. Leaving a field tidies it ("250000.00" becomes "250,000.00")
        // and runs the numbers, which also shows the message for a number left unfinished.
        ['principal', 'monthly', 'ratePct', 'years'].forEach(function (k) {
          var commas = k !== 'ratePct', field = f[k];
          field.input.addEventListener('input', function () {
            if (C.classifyAmount(field.text(), commas) === 'partial') return;
            update();
          });
          field.input.addEventListener('change', update);
          field.input.addEventListener('blur', function () {
            // A field masked by Hide amounts shows dots, not its text: leave it alone.
            var text = field.text(), tidy = C.formatAmount(text, commas);
            if (tidy !== null && (k === 'principal' || k === 'monthly')) {
              // The money fields tidy to cents, as every money field in the app does (the form kit does this first for what it
              // reads; this covers what only the website's reader accepts, such as "250 000"), so a second blur changes nothing.
              var v = C.parseAmount(text, true), cents = Math.round(v * 100);
              if (Math.abs(v * 100 - cents) < 1e-6 && cents <= 1e12) tidy = K.inputText(cents);
            }
            if (tidy !== null && field.input.value.trim() === text && tidy !== field.input.value) field.input.value = tidy;
            update();
          });
        });
        f.frequency.input.addEventListener('input', update);
        f.frequency.input.addEventListener('change', update);
        ['principal', 'monthly', 'ratePct', 'years', 'frequency'].forEach(function (k) { fieldsBox.appendChild(f[k].el); });
        var gid = dom.id('cs-timing');
        timingEnd = h('input', { type: 'radio', name: gid, value: 'end', checked: true });
        timingStart = h('input', { type: 'radio', name: gid, value: 'start' });
        timingEnd.checked = true;
        [timingEnd, timingStart].forEach(function (r) { r.addEventListener('change', update); });
        fieldsBox.appendChild(h('fieldset', { class: 'cs-timing' }, [
          h('legend', { text: 'Contribute at the' }),
          h('label', {}, [timingEnd, 'End of each month']),
          h('label', {}, [timingStart, 'Start of each month'])
        ]));
      }

      // Results
      var resultCard = h('section', { class: 'card cs-result', 'aria-labelledby': 'cs-res-h' });
      var host = h('div', { class: 'cs-chart', role: 'img', 'aria-label': 'Growth chart comparing compound and simple interest' });
      var floorNote = h('p', { class: 'note cs-floor' });
      floorNote.hidden = true;
      var ddFinal = h('dd'), ddSimple = h('dd'), ddAdds = h('dd');
      // The percent under "Compounding adds", in words; hidden when there is none.
      var ddMore = h('dd', { class: 'cs-more' });
      ddMore.hidden = true;
      var summary = h('p', { class: 'cs-summary', 'aria-live': 'polite' });
      var resultChip = h('span', { class: 'chip sample', text: 'Example inputs' });
      var illusLine = h('p', { class: 'cs-illus' });
      resultCard.appendChild(h('div', { class: 'card-h' }, [
        h('div', {}, [h('p', { class: 'eyebrow', text: 'Illustration' }), h('h3', { id: 'cs-res-h', class: 'cs-h3', text: 'Compound vs simple interest' })]),
        resultChip
      ]));
      resultCard.appendChild(illusLine);
      resultCard.appendChild(host);
      resultCard.appendChild(h('ul', { class: 'legend cs-legend', 'aria-label': 'Chart key' }, [
        h('li', {}, [h('span', { class: 'cs-key cs-key-compound' }), 'Compound interest']),
        h('li', {}, [h('span', { class: 'cs-key cs-key-simple' }), 'Simple interest']),
        h('li', {}, [h('span', { class: 'cs-key cs-key-contrib' }), 'Total deposits'])
      ]));
      resultCard.appendChild(floorNote);
      var tiles = h('dl', { class: 'cs-tiles' }, [
        h('div', { class: 'cs-hi' }, [h('dt', { text: 'Compound interest' }), ddFinal, h('dd', { class: 'cs-more', text: 'final balance' })]),
        h('div', {}, [h('dt', { text: 'Simple interest' }), ddSimple, h('dd', { class: 'cs-more', text: 'final balance' })]),
        h('div', {}, [h('dt', { text: 'Compounding adds' }), ddAdds, ddMore])
      ]);
      resultCard.appendChild(tiles);
      // A figure never breaks inside a number. It is shrunk to fit its tile (css, down to 13px);
      // if it still does not fit, the three tiles stack into one column, each as wide as the card;
      // only if it does not fit even then (the very largest inputs) may it wrap.
      function fitTiles() {
        tiles.classList.remove('cs-stack', 'cs-wrap');
        var over = function () {
          return [].some.call(tiles.querySelectorAll('dd:not(.cs-more)'), function (d) { return d.scrollWidth > d.clientWidth + 1; });
        };
        if (over()) { tiles.classList.add('cs-stack'); if (over()) tiles.classList.add('cs-wrap'); }
      }
      resultCard.appendChild(summary);
      resultCard.appendChild(h('p', { class: 'note body-note', text: 'For education only, not financial advice. This is an illustration, not a prediction. The 5% starting rate is only an example, so choose your own. Real returns vary and are not guaranteed. Taxes, fees and inflation are not included.' }));
      grid.appendChild(resultCard);

      // The year-by-year table: the chart's text version.
      var tbody = h('tbody');
      var tableWrap = h('details', { class: 'more cs-table' }, [
        h('summary', { text: 'Year by year breakdown' }),
        h('div', { class: 'tablewrap' }, h('table', { class: 'numtable' }, [
          h('caption', { class: 'sr-only', text: 'Year by year breakdown, the text version of the chart' }),
          h('thead', {}, h('tr', {}, ['Year', 'Money put in', 'Compound interest earned', 'Compound balance', 'Simple interest balance'].map(function (c) { return h('th', { scope: 'col', text: c }); }))),
          tbody
        ]))
      ]);
      cbox.appendChild(h('section', { class: 'card', 'aria-label': 'Year by year table' }, tableWrap));

      cbox.appendChild(h('section', { class: 'card cs-how', 'aria-labelledby': 'cs-how-h' }, [
        h('h3', { id: 'cs-how-h', class: 'cs-h3', text: 'How this calculator works' }),
        h('p', { class: 'cs-body', text: 'It uses a common convention for savings accounts. Inside each compounding period your money earns simple interest month by month, and at the end of the period that interest is added to your balance and starts earning interest of its own. Your bank may work interest out differently, for example daily on your balance, so its figures can differ slightly from these. With daily compounding it uses the exact daily growth for each month. Contributions at the start of a month earn interest that month; contributions at the end start earning the next month. Every year\'s figure is worked out directly from the formula, so no rounding builds up. The multiple under each end figure is the final balance divided by everything put in (the starting amount plus every contribution), and the percent beside Compounding adds is what compounding adds divided by the simple balance; both are rounded to one decimal place. Everything runs in your browser, and nothing you type is sent to us or stored.' })
      ]));

      // Below the calculators, so the loan chart is on screen without scrolling on a phone.
      wrap.appendChild(h('section', { class: 'card cs-about', 'aria-label': 'About the calculators' }, [
        h('p', { class: 'band-tools', text: 'The calculators run in your browser. What you type is not sent to us. No account needed.' })
      ]));

      wrap.appendChild(h('section', { class: 'card' }, [
        h('p', {}, ['Want to keep your own figures in one place? The app can save them, only on this device. ', h('a', { href: '#/welcome', text: 'See how the app works' })])
      ]));

      // ---------- Reading the inputs ----------
      // -> { raw, errors } ; marks the fields. Every field is read with the website's own
      // parser and every message comes from the website's validate(), exactly as on the
      // website. text() gives the typed value even while a field is masked by Hide amounts.
      function read() {
        var raw = { frequency: f.frequency.input.value, timing: timingStart.checked ? 'start' : 'end' };
        raw.principal = C.parseAmount(f.principal.text(), true);
        raw.monthly = C.parseAmount(f.monthly.text(), true);
        raw.ratePct = C.parseAmount(f.ratePct.text(), false);
        raw.years = C.parseAmount(f.years.text(), true);   // as the website reads years
        var errors = C.validate(raw);
        if (errors.ratePct === 'Enter a number.' && f.ratePct.text().indexOf(',') !== -1) errors.ratePct = 'Use a dot for decimals, like 4.5.';
        ['principal', 'monthly', 'ratePct', 'years'].forEach(function (k) {
          f[k].clear();
          if (errors[k]) f[k].error(errors[k]);
        });
        return { raw: raw, errors: errors };
      }
      function isExample(raw) {
        return raw.principal === DEFAULTS.principal && raw.monthly === DEFAULTS.monthly && raw.ratePct === Number(DEFAULTS.ratePct) &&
          raw.years === Number(DEFAULTS.years) && raw.frequency === DEFAULTS.frequency && raw.timing === DEFAULTS.timing;
      }

      // ---------- Drawing the figures ----------
      function setDd(dd, text) { dom.clear(dd); dd.appendChild(text); }
      // "+6.8% more than the simple balance", or nothing (see addsPercentText in calc-site.js).
      function setMore(pct) {
        ddMore.textContent = pct ? M(pct) + ' more than the simple balance' : '';
        ddMore.hidden = !pct;
      }
      function update() {
        var r = read(), errors = r.errors;
        if (Object.keys(errors).length) {
          // Never leave an old answer on screen as if it still applied.
          resultCard.classList.add('cs-stale');
          [ddFinal, ddSimple, ddAdds].forEach(function (dd) { dom.clear(dd); dd.textContent = '$...'; });
          setMore('');
          dom.clear(tbody);
          last = null;
          summary.textContent = errors.frequency || errors.timing || 'Fix the highlighted field to see results.';
          exampleChip.hidden = true; resultChip.hidden = true;
          dom.clear(illusLine); illusLine.hidden = true;
          redrawChart();
          return;
        }
        resultCard.classList.remove('cs-stale');
        exampleChip.hidden = resultChip.hidden = !isExample(r.raw);
        // The inputs, in words, so the figures below can be checked against them.
        var inp = r.raw, rest = [];
        dom.clear(illusLine); illusLine.hidden = false;
        rest.push('Illustration: ', whole(inp.principal), ' to start, ');
        if (inp.monthly > 0) rest.push(whole(inp.monthly), ' added at the ' + (inp.timing === 'start' ? 'start' : 'end') + ' of each month, ');
        else rest.push('no monthly additions, ');
        rest.push('an annual rate of ' + String(inp.ratePct) + '%, compounded ' + inp.frequency + ', for ' + inp.years + (inp.years === 1 ? ' year' : ' years') + '.');
        rest.forEach(function (n) { illusLine.appendChild(typeof n === 'string' ? document.createTextNode(n) : n); });
        var res = C.calculate(r.raw);
        last = { raw: r.raw, res: res };
        setDd(ddFinal, mon(res.final));
        setDd(ddSimple, mon(res.simpleFinal));
        setDd(ddAdds, mon(res.compoundingAdds));
        setMore(C.addsPercentText(res.compoundingAdds, res.simpleFinal));
        dom.clear(summary);
        summary.appendChild(document.createTextNode('You put in '));
        summary.appendChild(mon(res.contributions));
        summary.appendChild(document.createTextNode('. With compound interest, '));
        summary.appendChild(mon(res.interest));
        summary.appendChild(document.createTextNode(' of the final balance is interest.' + (res.final >= C.EXACT_TO_CENTS_BELOW ? ' Numbers this large are only approximate.' : '')));
        dom.clear(tbody);
        res.yearly.forEach(function (y) {
          tbody.appendChild(h('tr', {}, [
            h('th', { scope: 'row', text: String(y.year) }),
            h('td', {}, mon(y.contributions)), h('td', {}, mon(y.interest)), h('td', {}, mon(y.balance)), h('td', {}, mon(y.simpleBalance))
          ]));
        });
        redrawChart();
      }
      // While the other calculator is showing this one has no width to draw in, so its chart
      // is cleared (no old figure stays in the page, which matters for Hide amounts) and drawn
      // again when it is chosen.
      function redrawChart() {
        if (cbox.hidden) {
          dom.clear(host);
          host.setAttribute('aria-label', 'Growth chart comparing compound and simple interest');
          floorNote.textContent = ''; floorNote.hidden = true;
          return;
        }
        if (chartCtl) chartCtl.redraw(); else chartCtl = SW.charts.responsive(host, draw);
      }

      // Three lines over the years: compound balance, simple interest balance, and
      // total deposits. The gap between the top two is what compounding adds.
      function draw(W) {
        fitTiles();   // the card's width may have changed
        dom.clear(host);
        if (!last) {
          floorNote.hidden = true;
          floorNote.textContent = '';
          host.setAttribute('aria-label', 'No chart: fix the highlighted field.');
          return;
        }
        var inputs = last.raw, yearly = last.res.yearly, adds = last.res.compoundingAdds;
        var pts = [{ year: 0, balance: inputs.principal, simpleBalance: inputs.principal, contributions: inputs.principal }].concat(yearly);
        var top = pts[pts.length - 1], years = pts.length - 1;
        // The end labels show the same figures, formatted the same way, as the tiles.
        var compoundText = money.format(top.balance), simpleText = money.format(top.simpleBalance);
        // Each end figure's growth multiple of everything put in (start plus contributions),
        // and what compounding adds as a percent of the simple balance. Either is left out
        // when it has no meaning (calc-site.js gives '' for zero money in, or a 0.0% gap).
        var mult = { compound: C.multipleText(top.balance, top.contributions), simple: C.multipleText(top.simpleBalance, top.contributions) };
        // Both or neither: one figure with a multiple and the other without would mislead.
        if (!mult.compound || !mult.simple) mult = { compound: '', simple: '' };
        var pct = C.addsPercentText(adds, top.simpleBalance);
        var addsText = 'Compounding adds by year ' + years + ': ' + money.format(adds) + (pct ? ' (' + pct + A.words.pctTail + ')' : '');
        // Drawn at the chart box's own size in CSS pixels, so the text is the same size on
        // every screen. The height comes from the box's aspect-ratio in the stylesheet.
        var bw = Math.round(W), bh = 0;
        var ratio = String(getComputedStyle(host).aspectRatio || '').split('/').map(parseFloat);
        if (ratio.length === 2 && ratio[0] > 0 && ratio[1] > 0) bh = Math.round(bw * ratio[1] / ratio[0]);
        var g = A.frame(pts, compoundText, simpleText, addsText, bw > 200 && bh > 100 ? { W: bw, H: bh } : null, mult);
        var CW = g.W, CH = g.H, L = g.L, R = g.R, T = g.T, pw = g.pw, ph = g.ph, axis = g.axis, x = g.x, y = g.y;
        var svg = s('svg', { class: g.cls || null, viewBox: '0 0 ' + CW + ' ' + CH, 'aria-hidden': 'true', focusable: 'false' });
        function line(key) {
          return pts.map(function (p, idx) { return (idx ? 'L' : 'M') + x(p.year).toFixed(1) + ' ' + y(p[key]).toFixed(1); }).join(' ');
        }
        axis.ticks.forEach(function (v) {
          var gy = y(v).toFixed(1);
          svg.appendChild(s('line', { class: 'cs-gridline', x1: L, x2: CW - R, y1: gy, y2: gy }));
          svg.appendChild(s('text', { class: 'cs-axis', x: L - 8, y: gy, 'text-anchor': 'end', 'dominant-baseline': 'middle' }, M(A.axisLabel(v, g.shortTicks))));
        });
        pts.forEach(function (p) {
          if (p.year % g.every === 0) svg.appendChild(s('text', { class: 'cs-axis', x: x(p.year).toFixed(1), y: CH - 10, 'text-anchor': 'middle' }, String(p.year)));
        });
        // The area between simple and compound is the extra that compounding earns.
        var gap = line('balance') + ' ' + pts.slice().reverse().map(function (p) {
          return 'L' + x(p.year).toFixed(1) + ' ' + y(p.simpleBalance).toFixed(1);
        }).join(' ') + ' Z';
        svg.appendChild(s('path', { class: 'cs-gap', d: gap }));
        svg.appendChild(s('path', { class: 'cs-ln cs-ln-contrib', d: line('contributions') }));
        svg.appendChild(s('path', { class: 'cs-ln cs-ln-simple', d: line('simpleBalance') }));
        svg.appendChild(s('path', { class: 'cs-ln cs-ln-compound', d: line('balance') }));
        svg.appendChild(s('circle', { class: 'cs-dot-compound', cx: x(top.year).toFixed(1), cy: y(top.balance).toFixed(1), r: 4 }));
        svg.appendChild(s('circle', { class: 'cs-dot-simple', cx: x(top.year).toFixed(1), cy: y(top.simpleBalance).toFixed(1), r: 4 }));
        // Each end dot's value, in its line's colour, pushed apart when the dots are close,
        // with a short tick back to its dot when it had to move. When they sit in the band
        // above the plot (long figures on a phone), each follows a dot in its line's colour.
        [['compound', top.balance, g.endCompoundY, compoundText], ['simple', top.simpleBalance, g.endSimpleY, simpleText]].forEach(function (e) {
          var dy = y(e[1]);
          if (g.endsAbove) {
            svg.appendChild(s('circle', { class: 'cs-dot-' + e[0], cx: g.endKeyX, cy: e[2].toFixed(1), r: 4 }));
          } else if (Math.abs(e[2] - dy) > 1) {
            svg.appendChild(s('line', { class: 'cs-lead cs-lead-' + e[0], x1: (x(g.years) + 5).toFixed(1), y1: dy.toFixed(1), x2: (g.endX - 2).toFixed(1), y2: e[2].toFixed(1) }));
          }
          // The growth multiple is the last line under each figure (class cs-end-sub); the full words are in the aria text.
          var tsp = function (t, dy, sub) {
            return s('tspan', { class: sub ? 'cs-end-sub' : null, x: g.endX.toFixed(1), dy: dy }, M(t));
          };
          var words;
          if (g.endsAbove) {
            var ls = g.endLines[e[0]];
            words = ls.map(function (t, i) { return tsp(t, i ? g.adds.lineH : 0, !!g.sub && i === ls.length - 1); });
          } else {
            words = g.sub ? [tsp(e[3], 0, false), tsp(g.sub[e[0]], g.subStep, true)] : M(e[3]);
          }
          svg.appendChild(s('text', { class: 'cs-end cs-end-' + e[0], x: g.endX.toFixed(1), y: e[2].toFixed(1), 'dominant-baseline': 'middle' }, words));
        });
        // Names the shaded area, in a corner the lines do not cross (see ChartAxis.frame). Same figure as the tile.
        svg.appendChild(s('rect', { class: 'cs-gap cs-gap-key', x: g.adds.keyX, y: g.adds.y - 7, width: 14, height: 14, rx: 3 }));
        svg.appendChild(s('text', { class: 'cs-gap-label', x: g.adds.textX, y: g.adds.y, 'dominant-baseline': 'middle' }, g.adds.lines.map(function (t, i) {
          return s('tspan', { x: g.adds.textX, dy: i ? g.adds.lineH : 0 }, M(t));
        })));
        // One invisible column per year so hovering shows that year's numbers.
        var colW = pw / Math.max(1, g.years);
        yearly.forEach(function (p) {
          svg.appendChild(s('rect', { class: 'cs-hit', x: (x(p.year) - colW / 2).toFixed(1), y: T, width: colW.toFixed(1), height: ph },
            s('title', {}, M('Year ' + p.year + ': compound ' + money.format(p.balance) + ', simple ' + money.format(p.simpleBalance) + ', total deposits ' + money.format(p.contributions)))));
        });
        host.appendChild(svg);
        var floorText = axis.floor > 0 ? A.axisLabel(axis.floor) : '';
        floorNote.textContent = floorText ? (F.hidden ? 'Chart starts above zero.' : 'Chart starts at ' + floorText + ', not $0.') : '';
        floorNote.hidden = !floorText;
        // The same figures in words for screen readers, with the multiples and the percent.
        // "1.5×" is read as "1.5 times", so a screen reader does not say the letter x.
        var said = function (m) { return m ? ' (' + M(m).replace('×', ' times') + ' what you put in)' : ''; };
        host.setAttribute('aria-label', 'Illustration over ' + years + (years === 1 ? ' year' : ' years') + ': ' +
          M(money.format(top.balance)) + ' with compound interest' + said(mult.compound) + ', ' + M(money.format(top.simpleBalance)) +
          ' with simple interest' + said(mult.simple) + ', total deposits ' + M(money.format(top.contributions)) +
          '. Compounding adds by year ' + years + ': ' + M(money.format(adds)) + (pct ? ', ' + M(pct).replace('+', '') + ' more than the simple balance' : '') + '.' +
          (floorText ? (F.hidden ? ' The chart starts above zero.' : ' The chart starts at ' + floorText + ', not $0.') : ''));
      }

      resetBtn.addEventListener('click', function () {
        buildInputs(); update(); ctx.app.announce('Example inputs restored');
        f.principal.input.focus();
      });

      buildInputs();
      update();
      pick(which, false);
      return {
        // What was typed is not stored, so a change elsewhere (Hide amounts) redraws the figures in place.
        onStoreChange: function (ev) { if (ev && ev.stores && ev.stores.indexOf('settings') >= 0) { update(); loan.settingsChanged(); } return true; },
        destroy: function () { if (chartCtl) chartCtl.destroy(); loan.destroy(); }
      };
    }
  });
})();
