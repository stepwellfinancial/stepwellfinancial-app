/* Stepwell Financial prototype: small SVG chart helpers. No libraries.
   - Drawn at the real pixel width of their container (redrawn on resize),
     so chart text stays 12px or more on phones instead of shrinking.
   - Colours come from CSS classes (f-*, s-*, t-*), so a theme change needs no
     redraw and no inline styles.
   - Each chart has role="img" and an aria-label; screens add a text or table
     alternative next to it. Debts are hatched, never red. */
(function () {
  'use strict';
  var SW = window.SW = window.SW || {};
  var s = function (t, p, k) { return SW.dom.s(t, p, k); };
  var uid = 0;

  function defs(svg, tokens) {
    uid += 1;
    var id = 'c' + uid, d = s('defs');
    var f = s('filter', { id: id + '-glow', x: '-20%', y: '-50%', width: '140%', height: '200%' });
    f.appendChild(s('feGaussianBlur', { stdDeviation: '3.5', result: 'b' }));
    var m = s('feMerge'); m.appendChild(s('feMergeNode', { in: 'b' })); m.appendChild(s('feMergeNode', { in: 'SourceGraphic' }));
    f.appendChild(m); d.appendChild(f);
    (tokens || []).forEach(function (t) {
      var p = s('pattern', { id: id + '-h-' + t, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
      p.appendChild(s('rect', { width: 6, height: 6, class: 'f-' + t, opacity: '.35' }));
      p.appendChild(s('rect', { width: 2.5, height: 6, class: 'f-' + t }));
      d.appendChild(p);
    });
    svg.appendChild(d);
    return id;
  }

  function niceStep(span, maxTicks) {
    var c = [500, 1000, 2000, 2500, 5000, 10000, 15000, 20000, 25000, 50000, 100000, 250000];
    for (var i = 0; i < c.length; i++) if (span / c[i] <= maxTicks) return c[i];
    return c[c.length - 1];
  }

  // Axis labels are money too: four dots while "Hide amounts" is on. Each
  // label is registered with SW.fmt.track, so the shell can repaint it in place.
  function axisLabel(parent, x, y, v, fn) {
    var t = text(parent, x, y, '', 'ax money', 'end');
    SW.fmt.track(t, function () { return (fn || SW.calc.axisMoney)(v); });
    return t;
  }

  function text(parent, x, y, str, cls, anchor) {
    var t = s('text', { x: x, y: y, class: cls || 'ax', 'text-anchor': anchor || 'middle' });
    t.textContent = str;
    parent.appendChild(t);
    return t;
  }

  // Redraw whenever the host's width changes.
  function responsive(host, draw) {
    var lastW = -1, raf = 0;
    function run() { raf = 0; var w = Math.floor(host.clientWidth); if (w > 0 && w !== lastW) { lastW = w; draw(w); } }
    var ro = typeof ResizeObserver === 'function' ? new ResizeObserver(function () { if (!raf) raf = requestAnimationFrame(run); }) : null;
    if (ro) ro.observe(host); else window.addEventListener('resize', run);
    run();
    return {
      redraw: function () { lastW = -1; run(); },
      destroy: function () { if (ro) ro.disconnect(); else window.removeEventListener('resize', run); if (raf) cancelAnimationFrame(raf); }
    };
  }

  /* Stacked monthly bars with a net line and an optional dashed illustration.
     opts: { labels: [..], series: [{token, debt, values}], net: [..],
             illus: [{label, value}], mode: 'breakdown'|'total', height,
             selected, onSelect(i), ariaLabel, money(v) } */
  function stackedBars(host, opts) {
    var svg, sel = opts.selected === undefined ? opts.net.length - 1 : opts.selected, cols = [];

    function draw(W) {
      var mobile = W < 520, H = opts.height || (mobile ? 260 : 300);
      var L = mobile ? 46 : 54, R = 8, T = 24, B = 28;
      var n = opts.net.length, ill = opts.illus || [], total = n + ill.length;
      var breakdown = opts.mode !== 'total';
      var hi = 0, lo = 0;
      for (var i = 0; i < n; i++) {
        var up = 0, dn = 0;
        opts.series.forEach(function (se) { if (se.debt) dn += se.values[i]; else up += se.values[i]; });
        if (breakdown) { hi = Math.max(hi, up); lo = Math.min(lo, dn); }
        hi = Math.max(hi, opts.net[i]); lo = Math.min(lo, opts.net[i]);
      }
      ill.forEach(function (p) { hi = Math.max(hi, p.value); lo = Math.min(lo, p.value); });
      var step = niceStep(hi - lo, mobile ? 4 : 6);
      var top = Math.ceil(hi / step) * step, bot = Math.floor(lo / step) * step;
      if (top === bot) top = bot + step;
      var y = function (v) { return T + (top - v) / (top - bot) * (H - T - B); };
      var cw = (W - L - R) / total, bw = Math.min(cw * 0.62, 46);
      var cx = function (k) { return L + k * cw + cw / 2; };

      var next = s('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opts.ariaLabel, tabindex: '0', class: 'chart' });
      var id = defs(next, opts.series.filter(function (x) { return x.debt; }).map(function (x) { return x.token; }));

      // Illustration band
      if (ill.length) {
        next.appendChild(s('rect', { x: L + n * cw, y: T - 18, width: ill.length * cw, height: H - B - T + 18, rx: 8, class: 'f-band' }));
        text(next, L + (n + ill.length / 2) * cw, T - 4, 'Illustration', 'lbl');
      }
      // Selected column
      var selRect = s('rect', { y: T - 2, width: cw - 2, height: H - T - B + 4, rx: 6, class: 'f-sel' });
      next.appendChild(selRect);
      // Grid
      for (var g = bot; g <= top + 0.5; g += step) {
        next.appendChild(s('line', { x1: L, x2: W - R, y1: y(g), y2: y(g), class: g === 0 ? 's-zero' : 's-grid' }));
        axisLabel(next, L - 8, y(g) + 4, g, opts.axis);
      }
      // Bars
      if (breakdown) {
        for (i = 0; i < n; i++) {
          var u = 0, d = 0, x = cx(i) - bw / 2;
          opts.series.forEach(function (se) {
            var v = se.values[i];
            if (!se.debt) {
              next.appendChild(s('rect', { x: x, y: y(u + v) + 1, width: bw, height: Math.max(0, y(u) - y(u + v) - 2), rx: 3, class: 'f-' + se.token }));
              u += v;
            } else {
              next.appendChild(s('rect', { x: x, y: y(d) + 1, width: bw, height: Math.max(0, y(d + v) - y(d) - 2), rx: 3, fill: 'url(#' + id + '-h-' + se.token + ')' }));
              d += v;
            }
          });
        }
      } else {
        var area = 'M' + cx(0) + ' ' + y(Math.max(0, bot));
        opts.net.forEach(function (v, k) { area += ' L' + cx(k) + ' ' + y(v); });
        area += ' L' + cx(n - 1) + ' ' + y(Math.max(0, bot)) + ' Z';
        next.appendChild(s('path', { d: area, class: 'f-area' }));
      }
      // Net line
      var pts = opts.net.map(function (v, k) { return cx(k) + ',' + y(v); });
      next.appendChild(s('polyline', { points: pts.join(' '), class: 's-net', filter: 'url(#' + id + '-glow)' }));
      if (ill.length) {
        var ip = [pts[n - 1]].concat(ill.map(function (p, k) { return cx(n + k) + ',' + y(p.value); }));
        next.appendChild(s('polyline', { points: ip.join(' '), class: 's-illus' }));
      }
      opts.net.forEach(function (v, k) {
        if (k === n - 1) {
          next.appendChild(s('circle', { cx: cx(k), cy: y(v), r: 9, class: 'f-net-halo' }));
          next.appendChild(s('circle', { cx: cx(k), cy: y(v), r: 4.5, class: 'f-net' }));
        } else if (cw >= 26) {
          next.appendChild(s('circle', { cx: cx(k), cy: y(v), r: 2.6, class: 'f-net-dot' }));
        }
      });
      // Month labels: thin them out when columns are narrow, keep the last real month.
      var every = Math.max(1, Math.ceil(34 / cw));
      var labels = opts.labels.concat(ill.map(function (p) { return p.label; }));
      labels.forEach(function (lab, k) {
        if (Math.abs(n - 1 - k) % every === 0) text(next, cx(k), H - 8, lab, 'ax');
      });
      // Hit areas
      cols = [];
      for (var k2 = 0; k2 < total; k2++) {
        var hit = s('rect', { x: L + k2 * cw, y: 0, width: cw, height: H, class: 'hit' });
        (function (k) {
          hit.addEventListener('pointerenter', function () { select(k); });
          hit.addEventListener('click', function () { select(k); });
        })(k2);
        next.appendChild(hit);
        cols.push(L + k2 * cw + 1);
      }
      next.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          var to = e.key === 'Home' ? 0 : e.key === 'End' ? total - 1 : sel + (e.key === 'ArrowRight' ? 1 : -1);
          select(Math.max(0, Math.min(total - 1, to)));
        }
      });
      function place() { selRect.setAttribute('x', cols[sel] || 0); }
      next._place = place;
      if (svg && svg.parentNode === host) host.replaceChild(next, svg); else host.appendChild(next);
      svg = next;
      if (sel > total - 1) sel = n - 1;
      place();
    }

    function select(k) {
      if (k === sel) return;
      sel = k;
      if (svg && svg._place) svg._place();
      if (opts.onSelect) opts.onSelect(k);
    }

    var r = responsive(host, draw);
    return {
      update: function (o) { Object.keys(o).forEach(function (k) { opts[k] = o[k]; }); if (o.selected !== undefined) sel = o.selected; r.redraw(); },
      destroy: r.destroy
    };
  }

  /* Small trend line at a fixed real size. Decorative: callers give the trend
     in text next to it. opts: { width, height, cls, dot } */
  function sparkline(values, opts) {
    opts = opts || {};
    var W = opts.width || 72, H = opts.height || 24, pad = 3;
    var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values), span = hi - lo || 1;
    var x = function (i) { return pad + i * (W - pad * 2) / (values.length - 1); };
    var y = function (v) { return pad + (hi - v) / span * (H - pad * 2); };
    var svg = s('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, 'aria-hidden': 'true', focusable: 'false', class: 'spark' });
    svg.appendChild(s('polyline', { points: values.map(function (v, i) { return x(i).toFixed(1) + ',' + y(v).toFixed(1); }).join(' '), class: 'spark-line ' + (opts.cls || 's-muted') }));
    if (opts.dot !== false) svg.appendChild(s('circle', { cx: x(values.length - 1), cy: y(values[values.length - 1]), r: 2.4, class: 'spark-dot ' + (opts.dotCls || 'f-muted') }));
    return svg;
  }

  /* Simple line chart. opts: { series: [{values, cls, dashed}], labels, money(v),
     ariaLabel, height } */
  function line(host, opts) {
    var svg;
    function draw(W) {
      var H = opts.height || 220, L = 52, R = 10, T = 12, B = 28;
      var all = [].concat.apply([], opts.series.map(function (x) { return x.values; }));
      var lo = Math.min(0, Math.min.apply(null, all)), hi = Math.max.apply(null, all);
      var step = niceStep(hi - lo, 4), top = Math.ceil(hi / step) * step, bot = Math.floor(lo / step) * step;
      if (top === bot) top = bot + step;
      var n = opts.labels.length, x = function (i) { return L + i * (W - L - R) / Math.max(1, n - 1); };
      var y = function (v) { return T + (top - v) / (top - bot) * (H - T - B); };
      var next = s('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opts.ariaLabel, class: 'chart' });
      var id = defs(next, []);
      for (var g = bot; g <= top + 0.5; g += step) {
        next.appendChild(s('line', { x1: L, x2: W - R, y1: y(g), y2: y(g), class: g === 0 ? 's-zero' : 's-grid' }));
        axisLabel(next, L - 8, y(g) + 4, g, opts.axis);
      }
      opts.series.forEach(function (se) {
        next.appendChild(s('polyline', { points: se.values.map(function (v, i) { return x(i) + ',' + y(v); }).join(' '),
          class: 'line ' + (se.cls || 's-net') + (se.dashed ? ' dashed' : ''), filter: se.glow ? 'url(#' + id + '-glow)' : null }));
      });
      var every = Math.max(1, Math.ceil(40 / ((W - L - R) / Math.max(1, n - 1))));
      opts.labels.forEach(function (lab, i) { if ((n - 1 - i) % every === 0) text(next, x(i), H - 8, lab, 'ax'); });
      if (svg && svg.parentNode === host) host.replaceChild(next, svg); else host.appendChild(next);
      svg = next;
    }
    return responsive(host, draw);
  }

  /* Ring chart at a fixed size. parts: [{value, token}], centre: [big, small] */
  function donut(parts, opts) {
    opts = opts || {};
    var size = opts.size || 150, r = size / 2 - 12, sw = opts.stroke || 16, c = size / 2, a0 = -Math.PI / 2, gap = 0.035;
    var total = parts.reduce(function (t, p) { return t + Math.abs(p.value); }, 0) || 1;
    var svg = s('svg', { width: size, height: size, viewBox: '0 0 ' + size + ' ' + size, role: 'img', 'aria-label': opts.ariaLabel || '', class: 'chart' });
    svg.appendChild(s('circle', { cx: c, cy: c, r: r, class: 'ring-track', 'stroke-width': sw }));
    parts.forEach(function (p) {
      var a1 = a0 + Math.abs(p.value) / total * Math.PI * 2, st = a0 + gap / 2, en = a1 - gap / 2;
      if (en > st) {
        svg.appendChild(s('path', { d: 'M' + (c + r * Math.cos(st)) + ' ' + (c + r * Math.sin(st)) + ' A' + r + ' ' + r + ' 0 ' + (en - st > Math.PI ? 1 : 0) + ' 1 ' + (c + r * Math.cos(en)) + ' ' + (c + r * Math.sin(en)),
          class: 'ring-seg s-' + p.token, 'stroke-width': sw }));
      }
      a0 = a1;
    });
    if (opts.centre) {
      text(svg, c, c - 2, opts.centre[0], 'ring-big money');
      if (opts.centre[1]) text(svg, c, c + 17, opts.centre[1], 'lbl');
    }
    return svg;
  }

  /* Horizontal split bar (HTML). parts: [{value, token, debt, name}] */
  function splitBar(parts, opts) {
    opts = opts || {};
    var sh = SW.calc.shares(parts.map(function (p) { return p.value; }));
    var bar = SW.dom.h('div', { class: 'split' + (opts.cls ? ' ' + opts.cls : ''), role: 'img', 'aria-label': opts.ariaLabel || parts.map(function (p, i) { return p.name + ' ' + sh[i] + '%'; }).join(', ') });
    parts.forEach(function (p, i) {
      var seg = SW.dom.h('span', { class: 'bg-' + p.token + (p.debt ? ' hatch' : '') });
      seg.style.width = sh[i] + '%';
      bar.appendChild(seg);
    });
    return bar;
  }

  SW.charts = { stackedBars: stackedBars, sparkline: sparkline, line: line, donut: donut, splitBar: splitBar, responsive: responsive };
})();
