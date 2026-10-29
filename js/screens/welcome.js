/* Welcome (concept F1) and Calculators (concept F2): the front door and the
   line between the free tools and the app. The positioning lines are brand
   rule S5, word for word. The chart uses the sample household (js/data.js),
   labelled "Sample data"; nothing here reads or stores the reader's data. */
(function () {
  'use strict';
  var SW = window.SW;

  SW.screens.register('welcome', {
    render: function (wrap, ctx) {
      var C = ctx.calc, D = ctx.data, dom = ctx.dom, h = dom.h, F = SW.fmt, st = ctx.store;
      var cleanup = [];
      wrap.appendChild(ctx.app.screenHeader(ctx.route, { title: 'The next-gen wealth monitoring platform.' }));

      wrap.appendChild(h('section', { class: 'card wl-intro', 'aria-label': 'What Stepwell Financial is' }, [
        h('p', { class: 'wl-line', text: 'Control, monitor and enhance your financial life from one place.' }),
        h('p', { class: 'wl-body', text: 'Stepwell brings your whole financial life into one cohesive platform: every account, budget, bill and goal, with your net worth shown month by month. See where your money is, where it’s going and what’s changing, with professional education to understand and elevate your financial life, putting you in the driver’s seat.' })
      ]));

      // Sample chart: month-end net worth of the sample household, Nov 2025 to Oct 2026.
      // Shown only after the reader chose the sample demo: sample figures are opt-in.
      if (ctx.flags.sampleMode && st.status().hasSample) sampleChart();
      function sampleChart() {
      var series = C.netSeries(D), from = 1, last = series.length - 1;
      var idx = []; for (var i = from; i <= last; i++) idx.push(i);
      var card = h('section', { class: 'card wl-demo', 'aria-labelledby': 'wl-demo-h' });
      card.appendChild(h('div', { class: 'card-h' }, [h('h2', { id: 'wl-demo-h', text: 'Sample net worth' }), h('span', { class: 'chip sample', text: 'Sample data' })]));
      var host = h('div', { class: 'chart-host wl-chart' }), readout = h('p', { class: 'readout', 'aria-live': 'polite' });
      card.appendChild(host);
      card.appendChild(readout);
      function money(v) { return F.text(C.money(v)); }
      function setReadout(k) {
        var j = idx[k];
        dom.clear(readout);
        readout.appendChild(h('b', { text: C.monthLong(D.months[j]) + ': ' }));
        readout.appendChild(dom.money(C.money(series[j])));
      }
      var chart = ctx.charts.stackedBars(host, {
        labels: idx.map(function (j) { return C.monthShort(D.months[j]); }), series: [],
        net: idx.map(function (j) { return series[j]; }), illus: [], mode: 'total', selected: idx.length - 1, onSelect: setReadout,
        ariaLabel: 'Sample net worth by month, ' + C.monthLong(D.months[from]) + ' to ' + C.monthLong(D.months[last]) + ', from ' + money(series[from]) + ' to ' + money(series[last]) + '. Use the arrow keys to read each month.'
      });
      setReadout(idx.length - 1);
      cleanup.push(function () { chart.destroy(); });
      card.appendChild(h('p', { class: 'fine body-note' }, ['Sample net worth: ', dom.money(C.money(series[last])), ' on ' + C.dayLong(D.asOf) + ', the sum of the sample household’s accounts. The numbers are made up.']));
      card.appendChild(h('p', { class: 'note', text: 'For education only, not financial advice.' }));
      wrap.appendChild(card);
      }

      // The one ask: look around with sample data, if the app is empty and the demo is offered.
      if (ctx.flags.sampleMode) {
        var msg = h('p', { class: 'fine body-note', role: 'status' });
        var go = h('button', { type: 'button', class: 'btn', text: 'Look around with sample data' });
        go.addEventListener('click', function () {
          var s = st.status();
          if (!s.canLoadSample) { location.hash = '#/overview'; return; }
          go.disabled = true;
          st.loadSample().then(function () { location.hash = '#/overview'; }, function (e) { go.disabled = false; msg.textContent = e.message; });
        });
        wrap.appendChild(h('section', { class: 'card wl-ask', 'aria-label': 'Try it' }, [
          go,
          h('p', { class: 'fine body-note', text: 'The sample uses made-up numbers. You don’t need an account to try it.' }),
          msg
        ]));
      }

      // The line between the tools and the app.
      wrap.appendChild(h('section', { class: 'card wl-line-card', 'aria-label': 'Free tools and the app' }, [
        h('p', { class: 'band-tools' }, ['Free tools run in your browser. What you type is not sent to us. ', h('a', { href: '#/calculators', text: 'Open the calculators' })]),
        h('p', { class: 'band-app' }, [h('span', { class: 'chip device' }, [h('span', { class: 'dot' }), 'On this device only']), ' The app keeps your numbers on this device so you can come back to them.'])
      ]));
      return { destroy: function () { cleanup.forEach(function (f) { f(); }); } };
    }
  });

  SW.screens.register('calculators', {
    render: function (wrap, ctx) {
      var h = ctx.dom.h;
      wrap.appendChild(ctx.app.screenHeader(ctx.route, { title: 'Free calculators' }));
      // Only tools that exist on the calculator site today.
      var tools = [
        ['Compound interest calculator', 'See how money put in can grow at an example rate']
      ];
      var ul = h('ul', { class: 'calc-list', role: 'list' });
      tools.forEach(function (t) {
        ul.appendChild(h('li', { class: 'li calc-row' }, [
          h('span', {}, [t[0], h('span', { class: 'sub', text: t[1] })]),
          h('span', { class: 'fine', text: 'On the calculator site' })
        ]));
      });
      wrap.appendChild(h('section', { class: 'card', 'aria-labelledby': 'calc-h' }, [
        h('h2', { id: 'calc-h', class: 'sr-only', text: 'The calculators' }),
        h('p', { class: 'band-tools', text: 'Runs in your browser. What you type is not sent to us. No account needed.' }),
        ul
      ]));
      wrap.appendChild(h('section', { class: 'card' }, [
        h('p', {}, ['Want to keep your numbers and see them together? The app saves them, only on this device. ', h('a', { href: '#/welcome', text: 'See how the app works' })])
      ]));
      return null;
    }
  });
})();
