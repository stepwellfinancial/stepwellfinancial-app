/* split-flow.js: "What if the example split changed?", drawn into a host element.
 * One slider moves the example amount saved each month ($0 to $1,600, $50 steps).
 * Spending stays at the example $2,400 and checking is what is left. The 10 year
 * figure is worked out again at every step with the same rule as the saving chart
 * in the Money Flow graphic. Every figure is an example. The slider's value lives in
 * this page only: nothing here reads or stores anything, sends anything or links
 * anywhere, and nothing is read from the reader's own numbers. Example figures show
 * whatever the reader's own settings are: they are not the reader's money.
 *
 * Needs money-flow-calc.js and split-flow-calc.js loaded first, and money-flow.css and
 * split-flow.css on the page. Like money-flow.js it uses nothing from the app, so it
 * can ship on the website unchanged.
 *
 * Built only with createElement, createElementNS and textContent: no HTML strings
 * and no style attributes, so it runs under a strict Content Security Policy (and
 * under Trusted Types, in the app). A neutral look: no colour changes with the amount.
 *
 *   SplitFlow.mount(hostElement, { heading: 'h2' | 'h3' | 'h4', className: '...' })
 *     -> { destroy() }
 */
(function (root) {
  'use strict';
  var C = root.MoneyFlowCalc, S = root.SplitFlowCalc;
  var NS = 'http://www.w3.org/2000/svg';
  var uid = 0;

  // ---------- Small DOM helpers ----------
  function h(tag, attrs, kids) {
    var e = document.createElement(tag), k;
    for (k in attrs || {}) {
      if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function sv(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag), k;
    for (k in attrs || {}) {
      if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, String(attrs[k]));
    }
    if (parent) parent.appendChild(e);
    return e;
  }
  function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); return e; }

  function mount(host, opts) {
    opts = opts || {};
    var level = /^h[2-4]$/.test(opts.heading) ? opts.heading : 'h2';
    var money = C.money, money2 = C.money2, YEARS = S.YEARS, MONTHS = S.MONTHS;
    var id = 'sf' + (++uid);
    var saved = S.EXAMPLE, destroyed = false;

    clear(host);
    host.classList.add('mf', 'sf');
    if (opts.className) host.classList.add(opts.className);

    // ---------- The page structure ----------
    var label = h('label', { 'for': id + '-amt', 'class': 'sf-label' });
    var slider = h('input', { type: 'range', id: id + '-amt', min: S.MIN, max: S.MAX, step: S.STEP, value: S.EXAMPLE });
    var resetBtn = h('button', { type: 'button', text: 'Back to the ' + money(S.EXAMPLE) + ' example' });
    var legendEl = h('p', { 'class': 'sf-line' });
    var barSvg = sv('svg', { 'class': 'sf-bar', viewBox: '0 0 1000 28', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
    var bSpend = sv('rect', { 'class': 'sf-seg sf-spend', y: 0, height: 28 }, barSvg);
    var bSave = sv('rect', { 'class': 'sf-seg sf-save', y: 0, height: 28 }, barSvg);
    var bCheck = sv('rect', { 'class': 'sf-seg sf-bank', y: 0, height: 28 }, barSvg);
    var balLabel = h('span', { 'class': 'sf-ballab', text: 'Example balance after ' + YEARS + ' years: ' });
    var balEl = h('div', { 'class': 'mf-big sf-big' });
    var balLive = h('div', { 'aria-live': 'polite', 'aria-atomic': 'true' }, [balLabel, balEl]);
    var subEl = h('p', { 'class': 'sf-line' });
    var chartEl = h('div', { 'class': 'mf-chart sf-chart' });
    var tbody = h('tbody');

    host.appendChild(h('div', { 'class': 'mf-wrap' }, [
      h('header', {}, [
        h(level, { 'class': 'sf-title', text: 'What if the example split changed?' }),
        h('p', { 'class': 'mf-lede', text: 'Move the slider to change the example amount saved each month. The bar shows how the example $4,000 paycheck splits, and the 10 year figure is worked out again with the same rule as the saving chart above.' })
      ]),
      h('section', { 'class': 'mf-stage sf-stage', 'aria-label': 'What if the example split changed?' }, [
        h('p', { 'class': 'sf-key', text: 'Gold is spending, gray is checking, green is saving. All amounts are examples.' }),
        h('div', { 'class': 'sf-slide' }, [label, h('div', { 'class': 'sf-row' }, [slider, h('div', { 'class': 'mf-ctl' }, [resetBtn])])]),
        h('p', { 'class': 'sf-line sf-none', text: 'No amount on this slider is a pick or a target. Each one is an example, and what suits a real person depends on their own situation.' }),
        h('div', { 'class': 'sf-body' }, [
          h('div', { 'class': 'sf-left' }, [
            legendEl,
            barSvg,
            h('p', { 'class': 'sf-line', text: 'Spending stays at the example ' + money(S.SPENDING) + '. Checking is what is left.' }),
            balLive,
            subEl,
            h('p', { 'class': 'sf-line sf-foot', text: 'For education only, not financial advice. Every amount is an example. Nothing here is linked to a real account.' }),
            h('p', { 'class': 'sf-line', text: 'Each month the balance earns one twelfth of the yearly rate, then the deposit is added.' })
          ]),
          h('figure', { 'class': 'sf-fig' }, [
            h('figcaption', { 'class': 'sf-cap', text: 'Example balance over ' + YEARS + ' years, in dollars' }),
            chartEl,
            h('p', { 'class': 'sf-line', text: 'Dashed line: the ' + money(S.EXAMPLE) + ' a month example the slider starts on, for comparison.' }),
            h('div', { 'class': 'mf-sr' }, [h('table', {}, [
              h('caption', { text: 'Example balance at the end of each year, at the chosen example amount' }),
              h('thead', {}, [h('tr', {}, [h('th', { scope: 'col', text: 'Year' }), h('th', { scope: 'col', text: 'Example balance' })])]),
              tbody
            ])])
          ])
        ])
      ])
    ]));

    // The yearly table rows for screen readers
    var cells = [], y;
    for (y = 0; y <= YEARS; y++) {
      var td = h('td');
      cells.push(td);
      tbody.appendChild(h('tr', {}, [h('th', { scope: 'row', text: 'Year ' + y }), td]));
    }

    // ---------- The step chart: a fixed scale, so the line moves and the axis does not ----------
    var ref = S.figures(S.EXAMPLE), top = S.AXIS_TOP;
    var cs, cw = 0, geo, solid, dash, dot;
    function linePath(series) {
      var d = '', m;
      for (m = 0; m <= MONTHS; m++) d += (m ? ' L' : 'M') + geo.X(m).toFixed(1) + ' ' + geo.Y(series[m]).toFixed(1);
      return d;
    }
    function chartWidth() { return Math.min(720, Math.max(240, Math.floor(chartEl.getBoundingClientRect().width) || 320)); }
    function buildChart() {
      var W = chartWidth(), H = Math.round(Math.min(300, Math.max(210, W * 0.62)));
      var L = 74, Rr = 14, T = 16, B = 32, pw = W - L - Rr, ph = H - T - B, v, yr;
      cw = W;
      geo = {
        X: function (m) { return L + pw * m / MONTHS; },
        Y: function (b) { return T + ph - ph * b / top; }
      };
      cs = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
      for (v = 0; v <= top; v += 50000) {
        sv('line', { x1: L, x2: W - Rr, y1: geo.Y(v), y2: geo.Y(v), 'class': 'sf-grid' }, cs);
        sv('text', { x: L - 8, y: geo.Y(v) + 4, 'text-anchor': 'end', text: money(v) }, cs);
      }
      for (yr = 0; yr <= YEARS; yr += 2) sv('text', { x: geo.X(yr * 12), y: H - 10, 'text-anchor': 'middle', text: yr ? yr + 'y' : '0' }, cs);
      dash = sv('path', { 'class': 'sf-ref', d: linePath(ref.series) }, cs);
      solid = sv('path', { 'class': 'sf-line-chosen' }, cs);
      dot = sv('circle', { 'class': 'sf-dot', r: 5.5 }, cs);
      clear(chartEl).appendChild(cs);
      update();
    }
    function onResize() {
      if (destroyed) return;
      var w = Math.floor(chartEl.getBoundingClientRect().width);
      if (w > 0 && Math.abs(Math.min(720, Math.max(240, w)) - cw) >= 2) buildChart();
    }

    // ---------- Everything that follows the slider ----------
    function update() {
      var sp = S.split(saved), f = S.figures(saved), amt = money(sp.saved);
      label.textContent = 'Example saved each month: ' + amt;
      slider.setAttribute('aria-valuetext', 'Example saved each month: ' + amt);
      legendEl.textContent = 'Example month, ' + money(sp.paycheck) + ' paycheck: spending ' + money(sp.spending) + ', saving ' + amt + ', checking ' + money(sp.checking) + '.';
      bSpend.setAttribute('x', '0'); bSpend.setAttribute('width', String(1000 * sp.spending / sp.paycheck));
      bSave.setAttribute('x', String(1000 * sp.spending / sp.paycheck)); bSave.setAttribute('width', String(1000 * sp.saved / sp.paycheck));
      bCheck.setAttribute('x', String(1000 * (sp.spending + sp.saved) / sp.paycheck)); bCheck.setAttribute('width', String(1000 * sp.checking / sp.paycheck));
      balEl.textContent = money2(f.end);
      subEl.textContent = 'Illustration: ' + amt + ' a month for ' + YEARS + ' years, so ' + money(f.put) + ' put in, and example growth of ' + money2(f.interest) +
        '. Example 5% a year, compounded monthly, deposits at the end of each month. Leaves out taxes, fees and inflation. Real results differ and are not guaranteed.';
      cells.forEach(function (td, yr) { td.textContent = money2(f.series[yr * 12]); });
      if (cs) {
        solid.setAttribute('d', linePath(f.series));
        dot.setAttribute('cx', geo.X(MONTHS).toFixed(1)); dot.setAttribute('cy', geo.Y(f.end).toFixed(1));
        cs.setAttribute('aria-label', 'Example balance over ' + YEARS + ' years at ' + amt + ' a month, ending at ' + money2(f.end) +
          '. A dashed line shows the ' + money(S.EXAMPLE) + ' a month example, ending at ' + money2(ref.end) + '. The yearly balances are listed after the chart.');
      }
    }
    function onSlide() { saved = S.clampSaved(slider.value); update(); }
    function onReset() { saved = S.EXAMPLE; slider.value = String(saved); update(); }
    slider.addEventListener('input', onSlide);
    resetBtn.addEventListener('click', onReset);
    root.addEventListener('resize', onResize);

    buildChart();

    return {
      destroy: function () {
        destroyed = true;
        slider.removeEventListener('input', onSlide);
        resetBtn.removeEventListener('click', onReset);
        root.removeEventListener('resize', onResize);
      }
    };
  }

  root.SplitFlow = { mount: mount };
})(window);
