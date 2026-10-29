/* Cash flow: where a month's money came in and went out, from the reader's
   own lines in the on-device store. Flows go from money in to each spending
   group, labelled in text, with the lines behind every flow, and a hide-
   amounts view for sharing. Every figure comes from SWCalc.cashFlowMonth and
   js/data-ext/eng-a.js (flowPlan); every money text goes through the shared
   money helper, so Hide amounts shows dots in text, labels and the chart. */
(function () {
  'use strict';
  var SW = window.SW;

  // Kept between renders (the shell renders again when Hide amounts changes).
  var keep = { month: null, open: {} };

  SW.screens.register('cash-flow', {
    render: function (wrap, ctx) {
      var store = ctx.store, dom = ctx.dom, h = dom.h, C = ctx.calc, A = window.SWEngA, F = SW.fmt;
      var charts = [], dead = false;
      function m(cents, opts, cls) { return dom.moneyCents(cents, opts, cls); }
      function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

      paint();
      return {
        onStoreChange: function () { paint(); return true; },
        destroy: function () { dead = true; charts.forEach(function (c) { c.destroy(); }); }
      };

      function paint() {
        if (dead) return;
        charts.forEach(function (c) { c.destroy(); });
        charts = [];
        var st = store.status();
        dom.clear(wrap);
        wrap.appendChild(ctx.app.screenHeader(ctx.route, { eyebrow: st.hasSample ? 'Sample data' : '' }));
        if (st.locked) return;
        var lines = store.list('transactions'), cats = store.list('categories');
        var months = A.monthsWithLines(lines), today = store.today();
        if (!months.length) { wrap.appendChild(emptyCard(st)); return; }
        if (keep.month === null || months.indexOf(keep.month) < 0) keep.month = months.indexOf(today.slice(0, 7)) >= 0 ? today.slice(0, 7) : months[0];
        var month = keep.month;
        var cf = C.cashFlowMonth(lines, cats, month), plan = A.flowPlan(cf);
        var isNow = month === today.slice(0, 7);
        var period = C.monthLong(month) + (isNow ? ', to ' + C.dayShort(today) : '');
        var flows = plan.flows.map(function (f) { return f; });
        if (plan.notSpentCents > 0) flows.push({ id: 'none', name: 'Not spent', cents: plan.notSpentCents, token: 'none', parts: [] });
        var sh = C.sharesCents(flows.map(function (f) { return f.cents; }));
        flows.forEach(function (f, i) { f.share = sh[i]; });
        var ctxData = { lines: lines, month: month, cf: cf, plan: plan, flows: flows, period: period };

        wrap.appendChild(monthBar(months));
        var grid = h('div', { class: 'cf-grid' }, [summaryCard(ctxData, st), flowCard(ctxData)]);
        wrap.appendChild(grid);
      }

      function emptyCard(st) {
        var kids = [
          h('h2', { id: 'cf-empty-h', text: 'No lines yet' }),
          h('p', { class: 'cf-body', text: 'Cash flow adds up the lines you add or import in Transactions, month by month. Once there are lines, you can see where each month’s money came in and went out.' }),
          h('div', { class: 'cf-actions' }, [h('a', { class: 'btn', href: '#/transactions', text: 'Go to Transactions' })])
        ];
        if (st.canLoadSample) {
          var b = h('button', { type: 'button', class: 'btn quiet', text: 'Look around with sample data' });
          b.addEventListener('click', function () { b.disabled = true; store.loadSample().then(function () { keep.month = null; paint(); }, function (e) { b.disabled = false; ctx.app.announce(e.message); }); });
          kids[2].appendChild(b);
        }
        return h('section', { class: 'card cf-empty', 'aria-labelledby': 'cf-empty-h' }, kids);
      }

      function monthBar(months) {
        var f = SW.formKit.field({ label: 'Month', kind: 'select', value: keep.month, options: months.map(function (x) { return [x, C.monthLong(x)]; }) });
        f.input.addEventListener('change', function () { keep.month = f.input.value; keep.open = {}; paint(); var s = wrap.querySelector('.cf-month select'); if (s) s.focus(); });
        return h('div', { class: 'card cf-month' }, [f.el]);
      }

      function swatch(f) { return h('span', { class: 'sw cf-sw cf-bg-' + f.token, 'aria-hidden': 'true' }); }

      function lineList(items) {
        return h('ul', { class: 'cf-lines', role: 'list' }, items.map(function (x) {
          return h('li', { class: 'li' }, [h('span', {}, [x.t.payee, h('span', { class: 'sub', text: C.dayShort(x.t.date) + (x.t.splits && x.t.splits.length ? ' · part of a split line' : '') })]),
            h('span', { class: 'amt' }, m(x.cents, { sign: true }))]);
        }));
      }

      // ---------- In, out and not spent ----------
      function summaryCard(d, st) {
        var cf = d.cf, card = h('section', { class: 'card cf-sum', 'aria-labelledby': 'cf-sum-h' });
        card.appendChild(h('div', { class: 'card-h' }, [h('h2', { id: 'cf-sum-h', text: C.monthLong(d.month) }), h('span', { class: 'fine', text: d.period })]));

        var inBtn = h('button', { type: 'button', class: 'explain', text: 'What makes this up?', 'aria-label': 'What makes up money in?' });
        var inPanel = h('div', { class: 'explainer' }, [h('h3', { text: 'Money in, ' + d.period })].concat(cf.income.length ? cf.income.map(function (c) {
          return h('div', {}, [h('h4', { class: 'cf-sub' }, [h('span', { text: c.name }), m(c.cents)]), lineList(A.partsIn(d.lines, c.categoryId, d.month))]);
        }) : [h('p', { text: 'No lines in a money-in category this month.' })]).concat([h('p', { class: 'fine' }, ['Together: ', m(cf.inCents), '.'])]));
        dom.disclosure(inBtn, inPanel);

        var outBtn = h('button', { type: 'button', class: 'explain', text: 'What makes this up?', 'aria-label': 'What makes up money out?' });
        var outPanel = h('div', { class: 'explainer' }, [h('h3', { text: 'Money out, ' + d.period }),
          h('div', {}, cf.expense.map(function (c) { return h('div', { class: 'li' }, [h('span', { text: c.name }), h('span', { class: 'amt' }, m(c.cents))]); })),
          h('p', { class: 'fine' }, ['Together: ', m(cf.outCents), '. A refund in a spending category lowers it.'])]);
        dom.disclosure(outBtn, outPanel);

        var diff = cf.diffCents;
        card.appendChild(h('div', { class: 'cf-stats' }, [
          h('div', { class: 'cf-stat' }, [h('p', { class: 'eyebrow', text: 'Money in' }), h('p', { class: 'cf-num' }, m(cf.inCents)), inBtn]),
          h('div', { class: 'cf-stat' }, [h('p', { class: 'eyebrow', text: 'Money out' }), h('p', { class: 'cf-num' }, m(cf.outCents)), outBtn]),
          h('div', { class: 'cf-stat' }, [h('p', { class: 'eyebrow', text: diff >= 0 ? 'Not spent' : 'Out, more than in' }),
            h('p', { class: 'cf-num' }, m(Math.abs(diff))),
            h('p', { class: 'fine' }, [m(cf.inCents), ' in, minus ', m(cf.outCents), ' out.'])])
        ]));
        card.appendChild(inPanel);
        card.appendChild(outPanel);
        card.appendChild(h('p', { class: 'cf-body cf-words', text: diff >= 0
          ? '“Not spent” means it didn’t go out in this month’s lines. It doesn’t say where the money is now.'
          : 'More went out than came in, in this month’s lines. That can happen when a bill or a big cost lands in one month.' }));
        var apart = [];
        if (cf.uncategorised.count) apart.push(plural(cf.uncategorised.count, 'line or part has', 'lines or parts have') + ' no category');
        if (cf.transfer.count) apart.push(plural(cf.transfer.count, 'line is a transfer', 'lines are transfers') + ' between your accounts');
        if (apart.length) {
          card.appendChild(h('p', { class: 'fine body-note cf-apart' }, [apart.join(', and ') + ', so ' + (apart.length > 1 || cf.uncategorised.count + cf.transfer.count > 1 ? 'they aren’t' : 'it isn’t') + ' in money in or out. ',
            h('a', { href: '#/transactions', text: 'See them in Transactions' })]));
        }

        // Share view: the app-wide Hide amounts setting.
        var on = !!F.hidden;
        var hide = h('button', { type: 'button', class: 'btn small quiet', 'aria-pressed': on ? 'true' : 'false', text: on ? 'Show amounts' : 'Hide amounts to share' });
        hide.addEventListener('click', function () {
          hide.disabled = true;
          store.setSettings({ hideAmounts: !F.hidden }).then(null, function (e) { hide.disabled = false; ctx.app.announce(e.message); });
        });
        card.appendChild(h('div', { class: 'well cf-share' }, [
          h('h3', { text: 'Share the shape, not the sums' }),
          h('p', { class: 'cf-body', text: 'Hiding amounts swaps every dollar figure for dots, on every screen. Each flow keeps its share, so the picture still makes sense. The chart names no accounts.' }),
          h('div', { class: 'cf-actions' }, [hide])
        ]));
        card.appendChild(h('p', { class: 'note', text: 'From the lines you entered or imported, ' + d.period + '. For education only, not financial advice.' }));
        return card;
      }

      // ---------- The flows ----------
      function flowCard(d) {
        var card = h('section', { class: 'card cf-flow', 'aria-labelledby': 'cf-flow-h' });
        var ofWhat = d.plan.basis === 'in' ? 'money in' : 'money out';
        card.appendChild(h('div', { class: 'card-h' }, [h('h2', { id: 'cf-flow-h', text: 'Where the money went' }), h('span', { class: 'fine', text: d.period })]));
        card.appendChild(h('p', { class: 'cf-shared', text: 'Shared view: amounts are hidden. Each share is of ' + ofWhat + '.' }));
        if (!d.flows.length) {
          card.appendChild(h('p', { class: 'cf-body', text: 'No money in or spending lines this month, so there is nothing to draw.' }));
          return card;
        }
        var host = h('div', { class: 'chart-host cf-chart' });
        card.appendChild(host);
        card.appendChild(h('p', { class: 'fine cf-hint', text: 'Select a flow, or a group below, to see the lines behind it.' }));
        var rowsById = {};
        var ul = h('ul', { class: 'cf-list', role: 'list' });
        d.flows.forEach(function (f) { ul.appendChild(flowRow(f, d, rowsById, host)); });
        card.appendChild(ul);
        if (d.plan.basis === 'out') card.appendChild(h('p', { class: 'fine' }, ['The flows add up to ', m(d.plan.flowsCents), ' out, more than the ', m(d.cf.inCents), ' that came in, so there is no “Not spent” band.']));
        else card.appendChild(h('p', { class: 'fine body-note cf-total' }, ['All flows: ', m(d.plan.leftCents), ', the same as money in. Shares add up to 100.0%.']));
        if (d.plan.undrawn.length) card.appendChild(h('p', { class: 'fine', text: 'Not drawn: ' + d.plan.undrawn.map(function (c) { return c.name; }).join(', ') + ', where money back is as large as the spending.' }));
        card.appendChild(h('p', { class: 'note body-note', text: 'Each flow adds up the lines behind it, ' + d.period + '. Shares are of ' + ofWhat + '. For education only, not financial advice.' }));
        charts.push(flowChart(host, d, rowsById));
        mark(host, rowsById, d);
        return card;
      }

      function flowRow(f, d, rowsById, host) {
        var li = h('li', { class: 'cf-item' });
        var btn = h('button', { type: 'button', class: 'cf-row' }, [
          h('span', { class: 'cf-name' }, [swatch(f), h('span', { text: f.name })]),
          h('span', { class: 'cf-val' }, [m(f.cents), h('span', { class: 'cf-pct' }, [f.share.toFixed(1) + '%', h('span', { class: 'sr-only', text: ' of ' + (d.plan.basis === 'in' ? 'money in' : 'money out') + '. Show the parts.' })])])
        ]);
        var panel = h('div', { class: 'explainer cf-panel' });
        dom.disclosure(btn, panel);
        btn.addEventListener('click', function () {
          if (btn.getAttribute('aria-expanded') === 'true') keep.open[f.id] = true; else delete keep.open[f.id];
          mark(host, rowsById, d);
        });
        fillPanel(panel, f, d);
        if (keep.open[f.id]) { btn.setAttribute('aria-expanded', 'true'); panel.hidden = false; }
        rowsById[f.id] = btn;
        li.appendChild(btn);
        li.appendChild(panel);
        return li;
      }

      function fillPanel(panel, f, d) {
        if (f.id === 'none') {
          panel.appendChild(h('h3', { text: 'Not spent, ' + d.period }));
          panel.appendChild(h('p', {}, ['Money in ', m(d.cf.inCents), ' minus the flows ', m(d.plan.flowsCents), ' = ', m(f.cents), '.']));
          panel.appendChild(h('p', { class: 'fine', text: 'It is what is left after this month’s lines. It isn’t a balance in any one account.' }));
          return;
        }
        var count = f.parts.reduce(function (n, c) { return n + c.count; }, 0);
        panel.appendChild(h('h3', { text: f.name + ', ' + plural(count, 'line', 'lines') }));
        if (f.parts.length > 1) {
          f.parts.forEach(function (c) {
            panel.appendChild(h('h4', { class: 'cf-sub' }, [h('span', { text: c.name }), m(c.cents)]));
            panel.appendChild(lineList(A.partsIn(d.lines, c.categoryId, d.month)));
          });
          panel.appendChild(h('p', { class: 'fine' }, ['These ' + f.parts.length + ' categories share one colour here. Together: ', m(f.cents), '.']));
        } else {
          panel.appendChild(lineList(A.partsIn(d.lines, f.parts[0].categoryId, d.month)));
          panel.appendChild(h('p', { class: 'fine' }, ['Together: ', m(f.cents), '. Money out shows as minus; a refund as plus.']));
        }
        panel.appendChild(h('p', { class: 'fine' }, [h('a', { href: '#/transactions', text: 'See every line in Transactions' })]));
      }

      // Highlight the flows whose groups are open.
      function mark(host, rowsById, d) {
        var open = d.flows.filter(function (f) { return rowsById[f.id] && rowsById[f.id].getAttribute('aria-expanded') === 'true'; }).map(function (f) { return f.id; });
        host.classList.toggle('has-sel', open.length > 0);
        Array.prototype.forEach.call(host.querySelectorAll('[data-flow]'), function (el) {
          el.classList.toggle('on', open.indexOf(el.getAttribute('data-flow')) >= 0);
        });
      }

      // Flows from the left bar (money in, or money out when out is more) to
      // each group, labelled in text beside each node.
      function flowChart(hostEl, d, rowsById) {
        var s = dom.s, svg = null, flows = d.flows, total = d.plan.leftCents;
        var leftName = d.plan.basis === 'in' ? 'Money in' : 'Money out';
        var aria = leftName + ', ' + F.money(total) + ', ' + d.period + ', in ' + plural(flows.length, 'flow', 'flows') + ': ' +
          flows.map(function (f) { return f.name + ' ' + F.money(f.cents) + ', ' + f.share.toFixed(1) + '%'; }).join('; ') + '.';
        function draw(W) {
          var narrow = W < 560, T = 30, B = 8, gap = narrow ? 16 : 20;
          var H = Math.max(narrow ? 480 : 440, T + B + flows.length * 44);
          var LW = narrow ? Math.min(180, Math.round(W * 0.52)) : 260, bar = 12, nodeW = 10;
          var x1 = bar, nx = W - LW - nodeW;
          var usable = H - T - B - gap * (flows.length - 1), full = H - T - B;
          var next = s('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', class: 'chart cf-svg', 'aria-label': aria });
          var head = s('text', { x: 0, y: 16, class: 'cf-lbl-in' });
          head.appendChild(document.createTextNode(leftName + ' '));
          var hv = s('tspan', { class: 'cf-lbl-amt' }); hv.textContent = F.money(total);
          head.appendChild(hv);
          next.appendChild(head);
          next.appendChild(s('rect', { x: 0, y: T, width: bar, height: full, rx: 3, class: 'f-ink cf-in' }));
          var ly = T, ry = T, nodes = [];
          flows.forEach(function (f) {
            var hl = f.cents / total * full, hr = Math.max(1.5, f.cents / total * usable), c = (x1 + nx) / 2;
            var dd = 'M' + x1 + ' ' + ly + ' C' + c + ' ' + ly + ' ' + c + ' ' + ry + ' ' + nx + ' ' + ry +
              ' L' + nx + ' ' + (ry + hr) + ' C' + c + ' ' + (ry + hr) + ' ' + c + ' ' + (ly + hl) + ' ' + x1 + ' ' + (ly + hl) + ' Z';
            var path = s('path', { d: dd, class: 'cf-band cf-f-' + f.token, 'data-flow': f.id });
            var node = s('rect', { x: nx, y: ry, width: nodeW, height: hr, rx: 2, class: 'cf-node cf-n-' + f.token, 'data-flow': f.id });
            [path, node].forEach(function (el) {
              el.addEventListener('click', function () { var b = rowsById[f.id]; if (b) { b.click(); b.scrollIntoView({ block: 'nearest' }); } });
              next.appendChild(el);
            });
            nodes.push({ f: f, mid: ry + hr / 2 });
            ly += hl; ry += hr + gap;
          });
          // Labels beside each node, pushed apart so none overlap. Long group
          // names are cut to fit; the full name is in the list below.
          var lh = 40, ys = nodes.map(function (n) { return n.mid; });
          for (var i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + lh);
          var maxY = H - B - lh / 2 + 4;
          if (ys.length && ys[ys.length - 1] > maxY) {
            ys[ys.length - 1] = maxY;
            for (i = ys.length - 2; i >= 0; i--) ys[i] = Math.min(ys[i], ys[i + 1] - lh);
          }
          // About 7px a character at 13px semibold; the room is what is left right of the nodes.
          var maxChars = Math.max(8, Math.floor((W - (nx + nodeW + 8) - 4) / 7));
          nodes.forEach(function (n, k) {
            var lx = nx + nodeW + 8, y = ys[k];
            if (Math.abs(y - n.mid) > 3) next.appendChild(s('polyline', { points: (nx + nodeW + 1) + ',' + n.mid + ' ' + (lx - 2) + ',' + y, class: 'cf-leader' }));
            var name = n.f.name;
            if (name.length > maxChars && n.f.id === 'else') name = 'Everything else, ' + n.f.parts.length + ' categories';
            if (name.length > maxChars && n.f.id === 'else') name = 'Everything else (' + n.f.parts.length + ')';
            if (name.length > maxChars) name = name.slice(0, maxChars - 1) + '…';
            var t1 = s('text', { x: lx, y: y - 3, class: 'cf-lbl' }); t1.textContent = name;
            var t2 = s('text', { x: lx, y: y + 14, class: 'cf-lbl2' });
            var amt = s('tspan', {}); amt.textContent = F.money(n.f.cents);
            t2.appendChild(amt);
            t2.appendChild(document.createTextNode(' · ' + n.f.share.toFixed(1) + '%'));
            next.appendChild(t1);
            next.appendChild(t2);
          });
          if (svg && svg.parentNode === hostEl) hostEl.replaceChild(next, svg); else hostEl.appendChild(next);
          svg = next;
          mark(hostEl, rowsById, d);
        }
        return ctx.charts.responsive(hostEl, draw);
      }
    }
  });
})();
