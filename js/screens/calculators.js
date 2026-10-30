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
      function M(text) { return F.hidden ? String(text).replace(/\$[0-9]\S*/g, F.HIDDEN) : text; }
      function mon(v) { return dom.money(money.format(v)); }   // a tracked money span
      // Whole dollars when there are no cents ("$10,000"), cents otherwise.
      function whole(v) { return dom.money(Math.round(v * 100) % 100 === 0 ? money.format(v).replace(/\.00$/, '') : money.format(v)); }

      wrap.appendChild(ctx.app.screenHeader(ctx.route));

      wrap.appendChild(h('section', { class: 'card cs-about', 'aria-label': 'About the calculators' }, [
        h('p', { class: 'band-tools', text: 'The calculators run in your browser. What you type is not sent to us. No account needed.' })
      ]));

      // ---------- Compound interest ----------
      wrap.appendChild(h('section', { class: 'cs-intro', 'aria-labelledby': 'cs-ci-h' }, [
        h('h2', { id: 'cs-ci-h', class: 'cs-h2', text: 'Compound interest' }),
        h('p', { class: 'cs-lede', text: 'See how money can grow when interest earns interest. Enter a starting amount, a monthly contribution and a rate. Results update as you type.' }),
        h('p', { class: 'cs-lede', text: 'The calculator explains how each result is worked out, so you can check every figure yourself. Stepwell Financial gives education and tools, not personal advice.' })
      ]));

      var grid = h('div', { class: 'cs-grid' });
      wrap.appendChild(grid);

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
        f = {
          principal: K.field({ label: 'Initial deposit', kind: 'money', value: DEFAULTS.principal * 100 }),
          monthly: K.field({ label: 'Monthly contribution', kind: 'money', value: DEFAULTS.monthly * 100 }),
          ratePct: K.field({ label: 'Annual interest rate (%)', kind: 'text', value: DEFAULTS.ratePct, cap: 'money' }),
          years: K.field({ label: 'Years to grow', kind: 'text', value: DEFAULTS.years, cap: 'money' }),
          frequency: K.field({ label: 'Compounding', kind: 'select', value: DEFAULTS.frequency, options: FREQ_LABELS })
        };
        // No decimal keypad on the rate: Hide amounts treats any decimal-keypad field as a figure.
        f.years.input.setAttribute('inputmode', 'numeric');
        f.ratePct.input.setAttribute('spellcheck', 'false');
        f.years.input.setAttribute('spellcheck', 'false');
        ['principal', 'monthly', 'ratePct', 'years', 'frequency'].forEach(function (k) {
          f[k].input.addEventListener('input', update);
          f[k].input.addEventListener('change', update);
          fieldsBox.appendChild(f[k].el);
        });
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
      resultCard.appendChild(h('dl', { class: 'cs-tiles' }, [
        h('div', { class: 'cs-hi' }, [h('dt', { text: 'With compound interest' }), ddFinal]),
        h('div', {}, [h('dt', { text: 'With simple interest' }), ddSimple]),
        h('div', {}, [h('dt', { text: 'Compounding adds' }), ddAdds])
      ]));
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
      wrap.appendChild(h('section', { class: 'card', 'aria-label': 'Year by year table' }, tableWrap));

      wrap.appendChild(h('section', { class: 'card cs-how', 'aria-labelledby': 'cs-how-h' }, [
        h('h3', { id: 'cs-how-h', class: 'cs-h3', text: 'How this calculator works' }),
        h('p', { class: 'cs-body', text: 'It uses a common convention for savings accounts. Inside each compounding period your money earns simple interest month by month, and at the end of the period that interest is added to your balance and starts earning interest of its own. Your bank may work interest out differently, for example daily on your balance, so its figures can differ slightly from these. With daily compounding it uses the exact daily growth for each month. Contributions at the start of a month earn interest that month; contributions at the end start earning the next month. Every year\'s figure is worked out directly from the formula, so no rounding builds up. Everything runs in your browser, and nothing you type is sent to us or stored.' })
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
        raw.years = C.parseAmount(f.years.text(), false);
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
      function update() {
        var r = read(), errors = r.errors;
        if (Object.keys(errors).length) {
          // Never leave an old answer on screen as if it still applied.
          resultCard.classList.add('cs-stale');
          [ddFinal, ddSimple, ddAdds].forEach(function (dd) { dom.clear(dd); dd.textContent = '$...'; });
          dom.clear(tbody);
          last = null;
          summary.textContent = errors.frequency || errors.timing || 'Fix the highlighted field to see results.';
          exampleChip.hidden = true; resultChip.hidden = true;
          dom.clear(illusLine); illusLine.hidden = true;
          if (chartCtl) chartCtl.redraw();
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
        if (chartCtl) chartCtl.redraw(); else chartCtl = SW.charts.responsive(host, draw);
      }

      // Three lines over the years: compound balance, simple interest balance, and
      // total deposits. The gap between the top two is what compounding adds.
      function draw(W) {
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
        var addsText = 'Compounding adds by year ' + years + ': ' + money.format(adds);
        // Drawn at the chart box's own size in CSS pixels, so the text is the same size on
        // every screen. The height comes from the box's aspect-ratio in the stylesheet.
        var bw = Math.round(W), bh = 0;
        var ratio = String(getComputedStyle(host).aspectRatio || '').split('/').map(parseFloat);
        if (ratio.length === 2 && ratio[0] > 0 && ratio[1] > 0) bh = Math.round(bw * ratio[1] / ratio[0]);
        var g = A.frame(pts, compoundText, simpleText, addsText, bw > 200 && bh > 100 ? { W: bw, H: bh } : null);
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
          var words = g.endsAbove ? g.endLines[e[0]].map(function (t, i) {
            return s('tspan', { x: g.endX.toFixed(1), dy: i ? g.adds.lineH : 0 }, M(t));
          }) : M(e[3]);
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
        host.setAttribute('aria-label', 'Illustration over ' + years + (years === 1 ? ' year' : ' years') + ': ' +
          M(money.format(top.balance)) + ' with compound interest, ' + M(money.format(top.simpleBalance)) + ' with simple interest, total deposits ' +
          M(money.format(top.contributions)) + '. ' + M(addsText) + '.' +
          (floorText ? (F.hidden ? ' The chart starts above zero.' : ' The chart starts at ' + floorText + ', not $0.') : ''));
      }

      resetBtn.addEventListener('click', function () {
        buildInputs(); update(); ctx.app.announce('Example inputs restored');
        f.principal.input.focus();
      });

      buildInputs();
      update();
      return {
        // What was typed is not stored, so a change elsewhere (Hide amounts) redraws the figures in place.
        onStoreChange: function (ev) { if (ev && ev.stores && ev.stores.indexOf('settings') >= 0) update(); return true; },
        destroy: function () { if (chartCtl) chartCtl.destroy(); }
      };
    }
  });
})();
