/* money-flow.js: the "How it fits together" graphic, drawn into a host element.
 * One example month: a $4,000 paycheck, nine places it goes, and an example
 * savings-growth chart. Every figure is an example. Nothing here reads or stores
 * anything, sends anything or links anywhere.
 *
 * The same file, byte for byte, ships on stepwellfinancial.com and in the app
 * (see money-flow.sha256). It needs money-flow-calc.js loaded first and
 * money-flow.css on the page.
 *
 * Built only with createElement, createElementNS and textContent: no HTML
 * strings and no style attributes, so it runs under a strict Content Security
 * Policy (and under Trusted Types, in the app).
 *
 *   MoneyFlow.mount(hostElement, { heading: 'h2' | 'h3' | 'h4', className: '...' })
 *     -> { destroy() }
 *
 * On a page, an element with a data-money-flow attribute is mounted when this
 * script runs (data-heading sets the heading level, default h2). In the app a
 * screen calls mount itself. The diagram is drawn complete before anything
 * moves: the balls only start after the first draw, and not at all when the
 * reader has asked for less motion.
 *
 * Two layouts, one set of data and behaviour. Wider than 640 px the diagram is
 * the arc. At 640 px or narrower it is drawn at 1:1 (the viewBox is as wide as
 * the screen) as a pill, the hub, a trunk line and nine 52 px rows, so text is
 * real size and every target is at least 44 px. It is drawn again when the
 * width crosses 640 px or changes; the selected circle stays selected. */
(function (root) {
  'use strict';
  var C = root.MoneyFlowCalc;
  var NS = 'http://www.w3.org/2000/svg';
  var CX = 360, CY = 215;
  var GROUP = { spend: 'Spending', bank: 'Bank', save: 'Saving' };

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

  var DEFAULT_CAP = { t: 'An example month', d: 'An example $4,000 paycheck lands, and each dollar goes somewhere. Tap a circle to see where.' };

  function mount(host, opts) {
    opts = opts || {};
    var level = /^h[2-4]$/.test(opts.heading) ? opts.heading : 'h2';
    var N = C.NODES, money = C.money, money2 = C.money2;
    var destroyed = false;

    // ---------- The page structure ----------
    clear(host);
    host.classList.add('mf');
    if (opts.className) host.classList.add(opts.className);

    var playBtn = h('button', { type: 'button', 'aria-pressed': 'true', text: 'Pause' });
    var payBtn = h('button', { type: 'button', text: 'Pay day' });
    var resetBtn = h('button', { type: 'button', text: 'Reset example numbers' });
    var svg = sv('svg', {
      'class': 'mf-flow', viewBox: '0 0 720 660', role: 'group',
      'aria-label': 'Diagram: you at the top, Stepwell in the centre, nine places your example month of money goes'
    });
    var capEl = h('div', { 'class': 'mf-cap', 'aria-live': 'polite' });
    // The balance is announced with its label ("Example balance after 10 years: $178,574.62");
    // the label is for screen readers only, so nothing changes on screen.
    var balLabel = h('span', { 'class': 'mf-sr' });
    var balEl = h('div', { 'class': 'mf-big' });
    var balLive = h('div', { 'aria-live': 'polite', 'aria-atomic': 'true' }, [balLabel, balEl]);
    var putEl = h('div', { 'class': 'mf-sm' });
    var chartEl = h('div', { 'class': 'mf-chart' });
    var hz = h('div', { 'class': 'mf-hz', role: 'group', 'aria-label': 'Years' });

    host.appendChild(h('div', { 'class': 'mf-wrap' }, [
      h('header', {}, [
        h(level, { 'class': 'mf-title' }, ['Every dollar, ', h('span', { text: 'mapped.' })]),
        h('p', { 'class': 'mf-lede', text: 'Here is one example month, shown piece by piece. Tap any circle. Every figure on this page is an example.' })
      ]),
      h('section', { 'class': 'mf-stage', 'aria-label': 'Where an example month of money goes' }, [
        h('div', { 'class': 'mf-bar' }, [
          h('div', { 'class': 'mf-key' }, [h('span', { text: 'Gold balls are spending, gray is checking, green is savings. All amounts are examples.' })]),
          h('div', { 'class': 'mf-ctl' }, [playBtn, payBtn, resetBtn])
        ]),
        svg,
        capEl,
        h('p', { 'class': 'mf-note mf-note-a', text: 'The nine pieces add up to $4,000, an example. The lines and balls only illustrate the example: no money moves here, and nothing here is linked to a real account. For education only, not financial advice.' })
      ]),
      h('section', { 'class': 'mf-stage mf-grow', 'aria-label': 'Example savings growth' }, [
        h('div', {}, [
          h(level, { 'class': 'mf-sub', text: 'And the saving can keep adding up.' }),
          h('p', { 'class': 'mf-note', text: 'Illustration: $1,150 a month into the four saving circles, at an example 5% a year, compounded monthly, deposits at the end of each month. Each month the balance earns one twelfth of the yearly rate, then the deposit is added.' }),
          hz,
          balLive,
          putEl,
          h('p', { 'class': 'mf-note mf-note-b', text: 'For education only, not financial advice.' })
        ]),
        chartEl
      ]),
      h('p', { 'class': 'mf-note', text: 'For education only, not financial advice. Every amount, rate and account here is an example, not a forecast. It leaves out taxes, fees and inflation. Account rules and limits differ and change.' })
    ]));

    // ---------- State shared by both layouts ----------
    var AMT = {}, TOT = {}, NG = {}, VAL = {}, COL = { spend: '#c9a45c', bank: '#b9c7c0', save: '#3ccf8e' };
    N.forEach(function (n) { TOT[n.id] = n.amt; VAL[n.id] = n.amt / C.ballCount(n.amt); });
    // Less motion: the reader's system setting, or the app's own Less motion setting.
    var reduce = !!((root.matchMedia && root.matchMedia('(prefers-reduced-motion:reduce)').matches) ||
      document.documentElement.classList.contains('sw-less-motion'));
    var P = [], burst = [], running = !reduce, last = 0, boostUntil = 0, raf = 0, sel = null;
    var mq = root.matchMedia ? root.matchMedia('(max-width:640px)') : null;
    var narrow = false, width = 0;
    var gPaths, gDots, gNodes, payPath, paths, routes, lens, payLen;

    // Text of a circle's amount: its share so far (the saving circles count up).
    function amtText(n) { return money(Math.round(TOT[n.id])); }

    // The nine circles' texts and the four named parts of a node are the same in both layouts.
    function nodeGroup(n) {
      var g = sv('g', { 'class': 'mf-node mf-' + n.k, tabindex: '0', role: 'button', 'aria-label': n.label + ', an example ' + money(n.amt) + ' a month', 'data-id': n.id }, gNodes);
      NG[n.id] = g;
      return g;
    }

    // ---------- The arc, wider than 640 px ----------
    function drawWide() {
      var HUB = { x: CX, y: CY }, YOU = { x: CX, y: 46 };
      svg.setAttribute('viewBox', '0 0 720 660');
      // nine nodes on an arc below the hub
      var pos = N.map(function (n, i) { var a = (168 - i * 19.5) * Math.PI / 180; return { x: CX + 290 * Math.cos(a), y: CY + 330 * Math.sin(a) }; });

      // you -> hub
      payPath = sv('path', { 'class': 'mf-path mf-pay mf-on', d: 'M' + YOU.x + ' ' + (YOU.y + 22) + ' L' + HUB.x + ' ' + (HUB.y - 62) }, gPaths);
      paths = N.map(function (n, i) {
        var p = pos[i], dx = p.x - HUB.x, dy = p.y - HUB.y, L = Math.sqrt(dx * dx + dy * dy), ux = dx / L, uy = dy / L;
        var sx = HUB.x + ux * 58, sy = HUB.y + uy * 58, ex = p.x - ux * 28, ey = p.y - uy * 28;
        var d = 'M' + sx.toFixed(1) + ' ' + sy.toFixed(1) + ' Q ' + ((sx + ex) / 2).toFixed(1) + ' ' + (((sy + ey) / 2) + 22).toFixed(1) + ' ' + ex.toFixed(1) + ' ' + ey.toFixed(1);
        return sv('path', { 'class': 'mf-path mf-' + n.k, d: d, 'data-id': n.id }, gPaths);
      });
      routes = paths;

      // you
      var you = sv('g', { 'class': 'mf-you mf-node', tabindex: '0', role: 'button', 'aria-label': 'You, an example four thousand dollar paycheck', 'data-id': 'you' }, gNodes);
      sv('rect', { 'class': 'mf-hitbox', x: CX - 150, y: 2, width: 300, height: 88 }, you); // a larger invisible tap area
      sv('rect', { x: CX - 150, y: YOU.y - 22, width: 300, height: 44, rx: 22 }, you);
      sv('text', { x: CX, y: YOU.y - 2, text: 'You, the CEO of your money' }, you);
      sv('text', { 'class': 'mf-amt', x: CX, y: YOU.y + 14, text: 'example paycheck $4,000' }, you);

      // hub
      var hub = sv('g', { 'class': 'mf-hub mf-node', tabindex: '0', role: 'button', 'aria-label': 'Stepwell Financial', 'data-id': 'hub' }, gNodes);
      sv('circle', { cx: CX, cy: CY, r: 112, fill: 'none' }, hub);
      var s1 = sv('g', { 'class': 'mf-spin' }, hub); sv('circle', { 'class': 'mf-ring', cx: CX, cy: CY, r: 84 }, s1);
      var s2 = sv('g', { 'class': 'mf-spin2' }, hub); sv('circle', { 'class': 'mf-ring', cx: CX, cy: CY, r: 70, 'stroke-dasharray': '2 8' }, s2);
      sv('circle', { 'class': 'mf-c', cx: CX, cy: CY, r: 56, fill: '#0f1412', stroke: '#3ccf8e', 'stroke-width': 3 }, hub);
      sv('text', { x: CX, y: CY + 2, text: 'Stepwell' }, hub);
      sv('text', { 'class': 'mf-sublabel', x: CX, y: CY + 20, text: 'Financial' }, hub);

      // the nine circles
      N.forEach(function (n, i) {
        var p = pos[i], g = nodeGroup(n);
        sv('rect', { 'class': 'mf-hitbox', x: p.x - 48, y: p.y - 30, width: 96, height: 102 }, g); // a larger invisible tap area
        sv('circle', { 'class': 'mf-c', cx: p.x, cy: p.y, r: 26 }, g);
        sv('text', { x: p.x, y: p.y + 50, text: n.label }, g);
        AMT[n.id] = sv('text', { 'class': 'mf-amt', x: p.x, y: p.y + 67, text: amtText(n) }, g);
        sv('circle', { cx: p.x, cy: p.y, r: 6, fill: COL[n.k] }, g);
      });
    }

    // ---------- The vertical layout, 640 px or narrower, drawn at 1:1 ----------
    function drawNarrow() {
      var W = width, cx = W / 2, hubY = 132, trunkX = 14, junction = 194, rowH = 52, y = 204, lastY = 0;
      var lastKind = null, H;
      payPath = sv('path', { 'class': 'mf-path mf-pay mf-on', d: 'M' + cx + ' 50 L' + cx + ' ' + (hubY - 48) }, gPaths);
      var trunk = sv('path', { 'class': 'mf-path mf-trunk mf-on' }, gPaths);
      paths = []; routes = [];

      // you
      var you = sv('g', { 'class': 'mf-you mf-node', tabindex: '0', role: 'button', 'aria-label': 'You, an example four thousand dollar paycheck', 'data-id': 'you' }, gNodes);
      sv('rect', { 'class': 'mf-hitbox', x: 0, y: 0, width: W, height: 56 }, you);
      sv('rect', { x: 4, y: 6, width: W - 8, height: 44, rx: 22 }, you);
      sv('text', { x: cx, y: 26, text: 'You, the CEO of your money' }, you);
      sv('text', { 'class': 'mf-amt', x: cx, y: 43, text: 'example paycheck $4,000' }, you);

      // hub, 96 px
      var hub = sv('g', { 'class': 'mf-hub mf-node', tabindex: '0', role: 'button', 'aria-label': 'Stepwell Financial', 'data-id': 'hub' }, gNodes);
      var s1 = sv('g', { 'class': 'mf-spin' }, hub); sv('circle', { 'class': 'mf-ring', cx: cx, cy: hubY, r: 66 }, s1);
      var s2 = sv('g', { 'class': 'mf-spin2' }, hub); sv('circle', { 'class': 'mf-ring', cx: cx, cy: hubY, r: 58, 'stroke-dasharray': '2 8' }, s2);
      sv('circle', { 'class': 'mf-c', cx: cx, cy: hubY, r: 48, fill: '#0f1412', stroke: '#3ccf8e', 'stroke-width': 3 }, hub);
      sv('text', { x: cx, y: hubY + 2, text: 'Stepwell' }, hub);
      sv('text', { 'class': 'mf-sublabel', x: cx, y: hubY + 20, text: 'Financial' }, hub);

      // the nine rows, under three group headings
      N.forEach(function (n) {
        if (n.k !== lastKind) { sv('text', { 'class': 'mf-grp', x: trunkX + 12, y: y + 22, text: GROUP[n.k] }, gNodes); y += 32; lastKind = n.k; }
        var cy = y + rowH / 2, g = nodeGroup(n);
        sv('rect', { 'class': 'mf-hitbox', x: 0, y: y, width: W, height: rowH }, g); // the whole row is the target
        sv('rect', { 'class': 'mf-rowbg', x: 2, y: y + 2, width: W - 4, height: rowH - 4, rx: 10 }, g);
        sv('circle', { 'class': 'mf-c', cx: 40, cy: cy, r: 10 }, g);
        sv('circle', { cx: 40, cy: cy, r: 5, fill: COL[n.k] }, g);
        sv('text', { x: 62, y: cy + 6, text: n.label }, g);
        AMT[n.id] = sv('text', { 'class': 'mf-amt', x: W - 12, y: cy + 6, text: amtText(n) }, g);
        paths.push(sv('path', { 'class': 'mf-path mf-' + n.k, d: 'M' + trunkX + ' ' + cy + ' L30 ' + cy, 'data-id': n.id }, gPaths));
        // balls run hub, trunk, branch
        routes.push(sv('path', { 'class': 'mf-route', d: 'M' + cx + ' ' + (hubY + 48) + ' L' + cx + ' ' + junction + ' L' + trunkX + ' ' + junction + ' L' + trunkX + ' ' + cy + ' L30 ' + cy }, gPaths));
        lastY = cy; y += rowH;
      });
      trunk.setAttribute('d', 'M' + cx + ' ' + (hubY + 48) + ' L' + cx + ' ' + junction + ' L' + trunkX + ' ' + junction + ' L' + trunkX + ' ' + lastY);
      H = y + 8;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    }

    // ---------- Drawing, and drawing again when the layout changes ----------
    function mk(cls, path, len, speed, off, r, id) {
      var c = sv('circle', { 'class': 'mf-dot mf-' + cls, r: r }, gDots);
      P.push({ c: c, path: path, len: len, sp: speed, t: off, id: id });
    }
    function place(q) {
      var pt = q.path.getPointAtLength(q.t * q.len);
      q.c.setAttribute('cx', pt.x.toFixed(1)); q.c.setAttribute('cy', pt.y.toFixed(1));
    }
    function layout() {
      burst.forEach(function (b) { b.c.remove(); });
      burst = []; P = [];
      narrow = !!(mq && mq.matches);
      width = Math.max(240, Math.floor(svg.getBoundingClientRect().width) || 320);
      // Drawing again removes the focused circle; remember which one it was and focus its twin.
      var focusId = svg.contains(document.activeElement) ? document.activeElement.getAttribute('data-id') : null;
      clear(svg);
      svg.classList.toggle('mf-narrow', narrow);
      gPaths = sv('g', {}, svg); gDots = sv('g', {}, svg); gNodes = sv('g', {}, svg);
      if (narrow) drawNarrow(); else drawWide();
      lens = routes.map(function (p) { return p.getTotalLength(); });
      payLen = payPath.getTotalLength();
      var i;
      for (i = 0; i < 9; i++) mk('pay', payPath, payLen, 0.0045, i / 9, 4.8, null);
      N.forEach(function (n, j) {
        var cnt = C.ballCount(n.amt);
        for (var q = 0; q < cnt; q++) mk(n.k, routes[j], lens[j], 0.0040, q / cnt, 3.5, n.id);
      });
      P.forEach(place);   // the complete, still picture first
      if (sel) show(sel);
      if (focusId) {
        Array.prototype.forEach.call(svg.querySelectorAll('.mf-node'), function (g) { if (g.getAttribute('data-id') === focusId) g.focus(); });
      }
      last = 0; schedule();   // then the motion, if allowed
    }
    function onResize() {
      if (destroyed) return;
      var now = !!(mq && mq.matches);
      if (now !== narrow || (narrow && Math.abs(Math.floor(svg.getBoundingClientRect().width) - width) >= 2)) layout();
    }

    // ---------- The balls ----------
    // A ball reaching a saving circle adds its share to that circle's example number.
    function arrive(q) {
      if (!q.id) return;
      var n = null, j;
      for (j = 0; j < N.length; j++) if (N[j].id === q.id) n = N[j];
      if (!n || n.k !== 'save') return;
      TOT[q.id] += VAL[q.id];
      AMT[q.id].textContent = money(Math.round(TOT[q.id]));
      var g = NG[q.id];
      g.classList.add('mf-hit');
      setTimeout(function () { g.classList.remove('mf-hit'); }, 160);
    }
    function frame(ts) {
      raf = 0;
      if (destroyed) return;
      if (!last) last = ts;
      var dt = Math.min(40, ts - last) / 16.7, m = ts < boostUntil ? 2.6 : 1;
      last = ts;
      if (running) {
        P.forEach(function (q) { q.t += q.sp * dt * m; if (q.t > 1) { q.t -= 1; arrive(q); } place(q); });
        burst = burst.filter(function (b) {
          b.t += b.sp * dt * m;
          if (b.t >= 1) { arrive(b); b.c.remove(); return false; }
          place(b); return true;
        });
      }
      schedule();
    }
    // The loop only runs while the balls are moving.
    function schedule() { if (!raf && running && !destroyed) raf = requestAnimationFrame(frame); }

    function setPlay(on) { playBtn.setAttribute('aria-pressed', String(on)); playBtn.textContent = on ? 'Pause' : 'Play'; }
    if (reduce) { setPlay(false); playBtn.disabled = true; payBtn.disabled = true; }
    playBtn.addEventListener('click', function () { running = !running; setPlay(running); last = 0; schedule(); });

    // Pay day: a burst of balls down every path.
    payBtn.addEventListener('click', function () {
      if (reduce) return;
      running = true; setPlay(true);
      var j, k;
      for (j = 0; j < 9; j++) {
        burst.push({ c: sv('circle', { 'class': 'mf-dot mf-pay', r: 5 }, gDots), path: payPath, len: payLen, sp: 0.012, t: -j * 0.07 });
      }
      boostUntil = performance.now() + 6000;
      routes.forEach(function (p, a) {
        var nb = 2 * C.ballCount(N[a].amt);
        for (k = 0; k < nb; k++) {
          burst.push({ c: sv('circle', { 'class': 'mf-dot mf-' + N[a].k, r: 4 }, gDots), path: p, len: lens[a], sp: 0.0075, t: -0.3 - k * 0.12, id: N[a].id });
        }
      });
      last = 0; schedule();
    });
    resetBtn.addEventListener('click', function () {
      N.forEach(function (n) { TOT[n.id] = n.amt; AMT[n.id].textContent = money(n.amt); });
      if (sel) show(sel);
    });

    // ---------- Selection and caption ----------
    function setCap(t, d) {
      clear(capEl);
      capEl.appendChild(h('b', { text: t }));
      capEl.appendChild(h('span', { text: d }));
    }
    function show(id) {
      sel = id;
      var info;
      svg.classList.toggle('mf-dim', !!id && id !== 'you' && id !== 'hub');
      Array.prototype.forEach.call(svg.querySelectorAll('.mf-node'), function (g) { g.classList.toggle('mf-sel', g.getAttribute('data-id') === id); });
      paths.forEach(function (p) { p.classList.toggle('mf-on', p.getAttribute('data-id') === id || id === 'hub' || id === 'you' || !id); });
      payPath.classList.add('mf-on');
      if (!id) info = DEFAULT_CAP;
      else if (id === 'you') info = { t: 'You, the CEO of your money', d: 'An example $4,000 paycheck arrives. You decide where each piece goes, and every circle below is one of those decisions.' };
      else if (id === 'hub') info = { t: 'Stepwell Financial', d: 'Stepwell\'s calculators and lessons explain how some of these choices work and show what they do to the numbers. Nothing here is linked to a real account.' };
      else {
        var n = N.filter(function (x) { return x.id === id; })[0];
        info = n.k === 'save'
          ? { t: n.label + ' · example ' + money(Math.round(TOT[id])), d: n.t + ' This number counts up with each ball, by this circle\'s share of the example paycheck.' }
          : { t: n.label + ' · an example ' + money(n.amt) + ' a month', d: n.t };
      }
      setCap(info.t, info.d);
    }
    setCap(DEFAULT_CAP.t, DEFAULT_CAP.d);
    svg.addEventListener('click', function (e) { var g = e.target.closest('.mf-node'); if (g) show(g.getAttribute('data-id')); });
    svg.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        var g = e.target.closest && e.target.closest('.mf-node');
        if (g) { e.preventDefault(); show(g.getAttribute('data-id')); }
      }
    });
    // A click anywhere else clears the selection and the caption.
    function onDocClick(e) {
      if (!e.target.closest || !sel) return;
      if (!e.target.closest('.mf-node') && !e.target.closest('.mf-cap') && !e.target.closest('.mf-ctl')) show(null);
    }
    document.addEventListener('click', onDocClick);
    root.addEventListener('resize', onResize);
    if (mq && mq.addEventListener) mq.addEventListener('change', onResize);

    layout();

    // ---------- Growth chart: example, deposits at the end of each month ----------
    function draw(years) {
      var g = C.growth(years), s = g.series, end = g.end, put = g.put;
      balLabel.textContent = 'Example balance after ' + years + (years === 1 ? ' year' : ' years') + ': ';
      balEl.textContent = money2(end);
      clear(putEl);
      putEl.appendChild(h('span', { text: 'Put in ' }));
      putEl.appendChild(h('b', { text: money2(put) }));
      putEl.appendChild(h('span', { text: ' · example growth ' + money2(end - put) + ' · after ' + years + (years === 1 ? ' year' : ' years') + ' · about ' + money(Math.round(end)) + ' in whole dollars' }));

      var W = 600, H = 230, L = 74, Rr = 14, T = 14, B = 30, pw = W - L - Rr, ph = H - T - B, n = s.length - 1;
      function X(m) { return L + pw * m / n; }
      function Y(v) { return T + ph - ph * v / end; }
      var cs = sv('svg', {
        viewBox: '0 0 ' + W + ' ' + H, role: 'img',
        'aria-label': 'Example savings balance over ' + years + (years === 1 ? ' year' : ' years') + ', from $0 to ' + money2(end) + ', against the total put in, ' + money(put)
      });
      [0, 0.5, 1].forEach(function (f) {
        var y = T + ph - ph * f;
        sv('line', { x1: L, x2: W - Rr, y1: y, y2: y, stroke: '#2a3631', 'stroke-width': 1 }, cs);
        sv('text', { x: L - 8, y: y + 4, 'text-anchor': 'end', text: money(end * f) }, cs);
      });
      var step = Math.max(1, Math.round(years / 5)), yr;
      for (yr = 0; yr <= years; yr += step) sv('text', { x: X(yr * 12), y: H - 8, 'text-anchor': 'middle', text: yr ? yr + 'y' : '0' }, cs);
      var area = 'M' + X(0) + ' ' + Y(0), line = '', m;
      for (m = 0; m <= n; m += Math.max(1, Math.floor(n / 120))) {
        var x = X(m), y2 = Y(s[m]);
        area += ' L' + x.toFixed(1) + ' ' + y2.toFixed(1);
        line += (line ? ' L' : 'M') + x.toFixed(1) + ' ' + y2.toFixed(1);
      }
      area += ' L' + X(n) + ' ' + Y(end) + ' L' + X(n) + ' ' + Y(0) + ' Z';
      line += ' L' + X(n) + ' ' + Y(end);
      sv('path', { d: area, fill: '#3ccf8e', 'fill-opacity': '.14' }, cs);
      sv('line', { x1: X(0), y1: Y(0), x2: X(n), y2: Y(put), stroke: '#7f9a8c', 'stroke-width': 2, 'stroke-dasharray': '6 5' }, cs);
      sv('path', { d: line, fill: 'none', stroke: '#3ccf8e', 'stroke-width': 3, 'stroke-linejoin': 'round' }, cs);
      sv('circle', { cx: X(n), cy: Y(end), r: 5.5, fill: '#3ccf8e' }, cs);
      sv('circle', { cx: X(n), cy: Y(put), r: 4, fill: '#7f9a8c' }, cs);
      clear(chartEl).appendChild(cs);
    }
    var hzb = C.HORIZONS.map(function (y) {
      var b = h('button', { type: 'button', 'data-y': y, 'aria-pressed': y === C.DEFAULT_YEARS ? 'true' : 'false', text: y + (y === 1 ? ' year' : ' years') });
      b.addEventListener('click', function () {
        hzb.forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
        draw(y);
      });
      hz.appendChild(b);
      return b;
    });
    draw(C.DEFAULT_YEARS);

    return {
      destroy: function () {
        destroyed = true;
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        document.removeEventListener('click', onDocClick);
        root.removeEventListener('resize', onResize);
        if (mq && mq.removeEventListener) mq.removeEventListener('change', onResize);
      }
    };
  }

  root.MoneyFlow = { mount: mount };

  // On a page: mount into any element marked data-money-flow.
  var hosts = document.querySelectorAll('[data-money-flow]');
  Array.prototype.forEach.call(hosts, function (el) { mount(el, { heading: el.getAttribute('data-heading') }); });
})(window);
