/* month-flow.js: "The month, day by day", drawn into a host element.
 * The same example month as the "How it fits together" graphic, played out day by
 * day: a day slider, a Play button, nine rows that fill as the month goes, and a
 * step chart of the example checking balance. Every figure is an example. Nothing
 * here reads or stores anything, sends anything or links anywhere. Example figures
 * show whatever the reader's own settings are: they are not the reader's money.
 *
 * Needs money-flow-calc.js and month-flow-calc.js loaded first, and money-flow.css
 * and month-flow.css on the page. Like money-flow.js it uses nothing from the app,
 * so it can ship on the website unchanged.
 *
 * Built only with createElement, createElementNS and textContent: no HTML strings
 * and no style attributes, so it runs under a strict Content Security Policy (and
 * under Trusted Types, in the app).
 *
 *   MonthFlow.mount(hostElement, { heading: 'h2' | 'h3' | 'h4', className: '...' })
 *     -> { destroy() }
 *
 * Less motion (the system setting, or the app's own Less motion setting): Play
 * moves 5 days at a time, slower. destroy() clears every timer and listener. */
(function (root) {
  'use strict';
  var C = root.MoneyFlowCalc, M = root.MonthFlowCalc;
  var NS = 'http://www.w3.org/2000/svg';
  var GROUP = { spend: 'Spending', bank: 'Checking', save: 'Saving' };
  var TICKS = [1, 5, 10, 15, 20, 25, 30];
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
  function reduced() {
    return !!((root.matchMedia && root.matchMedia('(prefers-reduced-motion:reduce)').matches) ||
      document.documentElement.classList.contains('sw-less-motion'));
  }

  function mount(host, opts) {
    opts = opts || {};
    var level = /^h[2-4]$/.test(opts.heading) ? opts.heading : 'h2';
    var N = C.NODES, money = C.money, DAYS = M.DAYS, P = M.PAYCHECK;
    var id = 'mm' + (++uid);
    var day = 1, playing = false, timer = 0, liveTimer = 0, destroyed = false;
    var rows = {};

    clear(host);
    host.classList.add('mf', 'mm');
    if (opts.className) host.classList.add(opts.className);

    // ---------- The page structure ----------
    var slider = h('input', { type: 'range', id: id + '-day', min: 1, max: DAYS, step: 1, value: 1 });
    var out = h('output', { 'for': id + '-day', 'aria-live': 'off', 'class': 'mm-out' });
    var playBtn = h('button', { type: 'button', text: 'Play the month' });
    var todayEl = h('div', { 'class': 'mf-cap mm-today', 'aria-live': 'polite' });
    var rowsEl = h('div', { 'class': 'mm-rows' });
    var chartEl = h('div', { 'class': 'mf-chart mm-chart' });
    var tbody = h('tbody');

    host.appendChild(h('div', { 'class': 'mf-wrap' }, [
      h('header', {}, [
        h(level, { 'class': 'mm-title', text: 'The example month, day by day' }),
        h('p', { 'class': 'mf-lede', text: 'Drag the day to see the same example month play out. The example paycheck lands on day 1, and each piece moves on its own day.' })
      ]),
      h('section', { 'class': 'mf-stage mm-stage', 'aria-label': 'The example month, day by day' }, [
        h('p', { 'class': 'mm-key', text: 'Gold is spending, gray is checking, green is saving. All amounts and days are examples.' }),
        h('div', { 'class': 'mf-bar mm-bar' }, [
          h('div', { 'class': 'mm-day' }, [
            h('label', { 'for': id + '-day', text: 'Day of the month' }),
            h('div', { 'class': 'mm-slide' }, [slider, out])
          ]),
          h('div', { 'class': 'mf-ctl' }, [playBtn])
        ]),
        todayEl,
        h('div', { 'class': 'mm-body' }, [
          rowsEl,
          h('figure', { 'class': 'mm-fig' }, [
            h('figcaption', { 'class': 'mm-cap', text: 'Example checking balance through the month, in dollars' }),
            chartEl,
            h('div', { 'class': 'mf-sr' }, [h('table', {}, [
              h('caption', { text: 'Example checking balance at the end of each day' }),
              h('thead', {}, [h('tr', {}, [h('th', { scope: 'col', text: 'Day' }), h('th', { scope: 'col', text: 'Example checking balance' })])]),
              tbody
            ])])
          ])
        ])
      ]),
      h('p', { 'class': 'mf-note', text: 'Every amount and day is an example. Nothing here is linked to a real account. For education only, not financial advice.' })
    ]));

    // ---------- The nine rows, in the live graphic's order and groups ----------
    var list = null, lastKind = null;
    N.forEach(function (n) {
      if (n.k !== lastKind) {
        var gid = id + '-g-' + n.k;
        rowsEl.appendChild(h('div', { 'class': 'mm-grp', id: gid, text: GROUP[n.k] }));
        list = h('ul', { 'class': 'mm-list', 'aria-labelledby': gid });
        rowsEl.appendChild(list);
        lastKind = n.k;
      }
      var bar = sv('svg', { 'class': 'mm-bar-svg', viewBox: '0 0 1000 12', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
      var fill = sv('rect', { 'class': 'mm-fill mm-' + n.k, x: 0, y: 0, width: 0, height: 12 }, bar);
      var amt = h('span', { 'class': 'mm-amt' });
      list.appendChild(h('li', { 'class': 'mm-row' }, [h('span', { 'class': 'mm-lab', text: n.label }), amt, bar]));
      // The bar is full at the item's month total; checking is against the $4,000 paycheck.
      rows[n.id] = { amt: amt, fill: fill, scale: n.k === 'bank' ? P : M.TOTALS[n.id] };
      if (n.k === 'bank') rowsEl.appendChild(h('p', { 'class': 'mm-key mm-note', text: 'Checking is shown against the example ' + money(P) + ' paycheck.' }));
    });

    function updateRows() {
      var f = M.filledOn(day);
      N.forEach(function (n) {
        var r = rows[n.id];
        r.amt.textContent = money(f[n.id]) + ' of ' + money(r.scale);
        r.fill.setAttribute('width', String(Math.round(1000 * f[n.id] / r.scale)));
      });
    }

    // ---------- The Today line ----------
    function renderToday() {
      var ev = M.eventsOn(day), moves = ev.map(function (e) { return e.label + ' ' + money(e.amt); }).join(', ');
      clear(todayEl);
      if (day === M.PAY_DAY) {
        todayEl.appendChild(h('b', { text: 'Payday: the example ' + money(P) + ' lands in checking.' }));
        if (ev.length) todayEl.appendChild(h('span', { text: 'Today: ' + moves + '.' }));
      } else {
        todayEl.appendChild(h('b', { text: ev.length ? 'Today: ' + moves + '.' : 'No example payments today.' }));
      }
      todayEl.appendChild(h('span', { text: 'Example checking balance after day ' + day + ': ' + money(M.balanceOn(day)) + '.' }));
    }

    // ---------- The step chart, drawn at 1:1 so its text is real size ----------
    var cs, cw = 0, geo, solid, dot, lab;
    function stepPath(upTo) {
      var d = 'M' + geo.X(1).toFixed(1) + ' ' + geo.Y(M.balanceOn(1)).toFixed(1), i;
      for (i = 2; i <= upTo; i++) d += ' H' + geo.X(i).toFixed(1) + ' V' + geo.Y(M.balanceOn(i)).toFixed(1);
      return d;
    }
    // The drawing is as wide as its space (so the text stays real size), from 200 to 720.
    function chartWidth(w) { return Math.min(720, Math.max(200, w)); }
    function buildChart() {
      var W = chartWidth(Math.floor(chartEl.getBoundingClientRect().width) || 320);
      var H = Math.round(Math.min(300, Math.max(210, W * 0.62)));
      var L = 58, Rr = 14, T = 22, B = 32, pw = W - L - Rr, ph = H - T - B, v;
      cw = W;
      geo = {
        X: function (d) { return L + pw * (d - 1) / (DAYS - 1); },
        Y: function (b) { return T + ph - ph * b / P; }
      };
      cs = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
      for (v = 0; v <= P; v += 1000) {
        sv('line', { x1: L, x2: W - Rr, y1: geo.Y(v), y2: geo.Y(v), 'class': 'mm-grid' }, cs);
        sv('text', { x: L - 8, y: geo.Y(v) + 4, 'text-anchor': 'end', text: money(v) }, cs);
      }
      TICKS.forEach(function (d) { sv('text', { x: geo.X(d), y: H - 10, 'text-anchor': 'middle', text: d }, cs); });
      sv('path', { 'class': 'mm-faint', d: stepPath(DAYS) }, cs);
      solid = sv('path', { 'class': 'mm-solid' }, cs);
      dot = sv('circle', { 'class': 'mm-dot', r: 6 }, cs);
      lab = sv('text', { 'class': 'mm-pt' }, cs);
      clear(chartEl).appendChild(cs);
      updateChart();
    }
    function updateChart() {
      var b = M.balanceOn(day), x = geo.X(day), y = geo.Y(b), right = day > 20;
      solid.setAttribute('d', stepPath(day));
      dot.setAttribute('cx', x.toFixed(1)); dot.setAttribute('cy', y.toFixed(1));
      lab.textContent = money(b);
      lab.setAttribute('x', (x + (right ? -10 : 10)).toFixed(1)); lab.setAttribute('y', (y - 12).toFixed(1));
      lab.setAttribute('text-anchor', right ? 'end' : 'start');
      cs.setAttribute('aria-label', 'Step chart of the example checking balance, days 1 to ' + DAYS + '. On day ' + day + ' it is ' + money(b) +
        '. It ends the month at ' + money(M.balanceOn(DAYS)) + '. The daily balances are listed after the chart.');
    }
    function onResize() {
      if (destroyed) return;
      var w = Math.floor(chartEl.getBoundingClientRect().width);
      if (w > 0 && Math.abs(chartWidth(w) - cw) >= 2) buildChart();
    }

    // The 30 balances for screen readers (the chart is a picture).
    var d;
    for (d = 1; d <= DAYS; d++) {
      tbody.appendChild(h('tr', {}, [h('th', { scope: 'row', text: 'Day ' + d }), h('td', { text: money(M.balanceOn(d)) })]));
    }

    // ---------- The day, and playing the month ----------
    function setDay(n) {
      day = M.clampDay(n);
      slider.value = String(day);
      slider.setAttribute('aria-valuetext', 'Day ' + day);
      out.textContent = 'Day ' + day;
      renderToday(); updateRows(); updateChart();
    }
    // While playing, the Today line is not read out on every step; it is read once when play stops.
    // quiet: the reader moved the slider, which writes the Today line itself, so it is not written again.
    function stop(quiet) {
      playing = false;
      if (timer) { clearTimeout(timer); timer = 0; }
      playBtn.textContent = 'Play the month';
      todayEl.setAttribute('aria-live', 'polite');
      if (liveTimer) { clearTimeout(liveTimer); liveTimer = 0; }
      if (!quiet) liveTimer = setTimeout(function () { liveTimer = 0; if (!destroyed) renderToday(); }, 80);
    }
    function step() {
      timer = 0;
      if (destroyed || !playing) return;
      var slow = reduced();
      setDay(slow ? Math.min(DAYS, (Math.floor(day / 5) + 1) * 5) : day + 1);
      if (day >= DAYS) stop(); else timer = setTimeout(step, slow ? 1600 : 550);
    }
    function onPlay() {
      if (playing) { stop(); return; }
      if (day >= DAYS) setDay(1);
      playing = true;
      playBtn.textContent = 'Pause';
      todayEl.setAttribute('aria-live', 'off');
      timer = setTimeout(step, reduced() ? 1600 : 550);
    }
    function onSlide() {
      if (playing) stop(true);
      else if (liveTimer) { clearTimeout(liveTimer); liveTimer = 0; }
      setDay(slider.value);
    }
    slider.addEventListener('input', onSlide);
    playBtn.addEventListener('click', onPlay);
    root.addEventListener('resize', onResize);

    buildChart();
    setDay(1);

    return {
      destroy: function () {
        destroyed = true; playing = false;
        if (timer) { clearTimeout(timer); timer = 0; }
        if (liveTimer) { clearTimeout(liveTimer); liveTimer = 0; }
        slider.removeEventListener('input', onSlide);
        playBtn.removeEventListener('click', onPlay);
        root.removeEventListener('resize', onResize);
      }
    };
  }

  root.MonthFlow = { mount: mount };
})(window);
