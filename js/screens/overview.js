/* Overview (concept screen A2): net worth now, what changed since the end of
   last month, the month-end picture with a dashed illustration, assets and
   debts, accounts, recent lines, and (with sample data only) the Markets card.
   Every figure comes from the store (ctx.store) and is worked out in
   js/calc.js; this file only lays them out. Money text goes through
   SW.fmt / SW.dom.moneyCents, so "Hide amounts" shows dots everywhere. */
(function () {
  'use strict';
  var SW = window.SW;

  SW.screens.register('overview', {
    render: function (wrap, ctx) {
      var C = ctx.calc, dom = ctx.dom, h = dom.h, st = ctx.store, F = SW.fmt, S = window.SWSchema;
      var status = st.status(), today = st.today(), month = C.monthOf(today);
      var A = st.list('accounts'), B = st.list('balances'), T = st.list('transactions'), CA = st.list('categories');
      var idx = C.balanceIndex(B), cats = C.indexById(CA), cleanup = [];
      var sample = status.hasSample;
      function m(c, o) { return dom.moneyCents(c, o); }
      function mt(c, o) { return F.money(c, o); }
      // A debt shows as a minus: it takes away from net worth.
      function shown(row) { return row.debt ? -row.cents : row.cents; }

      wrap.appendChild(ctx.app.screenHeader(ctx.route, { eyebrow: C.dateLong(today) + (sample ? ' · Sample data' : '') }));

      if (!A.length) {
        wrap.appendChild(emptyCard());
        return null;
      }

      var now = C.totalsOn(A, idx, today);
      var left = h('div', { class: 'ov-col' }), right = h('div', { class: 'ov-col' });
      wrap.appendChild(h('div', { class: 'ov-grid' }, [left, right]));
      left.appendChild(netWorthCard());
      left.appendChild(accountsCard());
      right.appendChild(assetsDebtsCard());
      right.appendChild(budgetCard());
      if (sample && ctx.flags.markets) right.appendChild(marketsCard());
      right.appendChild(recentCard());
      return { destroy: function () { cleanup.forEach(function (f) { f(); }); } };

      // ---------- Nothing yet ----------
      function emptyCard() {
        var msg = h('p', { class: 'fine body-note', role: 'status' });
        var kids = [
          h('h2', { id: 'ov-empty-h', text: 'Net worth' }),
          h('p', { text: 'There’s nothing here yet. Add your first account and its balance to see your net worth.' }),
          h('p', { class: 'ov-actions' }, [h('a', { class: 'btn', href: '#/accounts', text: 'Add an account' })])
        ];
        if (status.canLoadSample) {
          var trySample = h('button', { type: 'button', class: 'linkbtn', text: 'Look around with sample data' });
          trySample.addEventListener('click', function () {
            trySample.disabled = true;
            st.loadSample().then(function () { ctx.app.announce('Sample data added. Every figure is made up.'); },
              function (e) { trySample.disabled = false; msg.textContent = e.message; });
          });
          kids.push(h('p', {}, [trySample]));
        }
        kids.push(msg);
        return h('section', { class: 'card ov-empty', 'aria-labelledby': 'ov-empty-h' }, kids);
      }

      // ---------- Net worth ----------
      function netWorthCard() {
        var prevEnd = C.monthEnd(C.addMonths(month, -1)), since = C.dayShort(prevEnd);
        var ch = C.changeBetweenDates(A, idx, prevEnd, today);
        var dir = ch.amountCents > 0 ? 'Up' : ch.amountCents < 0 ? 'Down' : 'No change';

        // Month-end figures, from the first month that has a balance.
        var rows = C.netWorthByMonth(A, idx, C.monthsEnding(month, 13), today);
        var first = 0;
        while (first < rows.length - 1 && !C.hasBalanceOn(A, idx, rows[first].date)) first += 1;
        rows = rows.slice(first);
        var last = rows.length - 1;

        // The illustration needs a net worth from 6 months ago.
        var sixEnd = C.monthEnd(C.addMonths(month, -6)), illus = null;
        if (C.hasBalanceOn(A, idx, sixEnd)) {
          var then = C.totalsOn(A, idx, sixEnd).netCents;
          var step = C.averageChangeCents(now.netCents, then, 6);
          illus = { then: then, thenMonth: C.addMonths(month, -6), step: step, keys: [1, 2, 3].map(function (k) { return C.addMonths(month, k); }), vals: C.illustrateCents(now.netCents, step, 3) };
        }
        var state = { range: Math.min(12, rows.length), mode: 'breakdown' };
        var card = h('section', { class: 'card ov-nw', 'aria-labelledby': 'nw-h' });

        // What changed?
        var changeBtn = h('button', { type: 'button', class: 'explain', text: 'What changed?' });
        var changePanel = h('div', { class: 'explainer' }, [
          h('h3', { text: 'What changed since ' + since }),
          ch.items.length ? h('div', {}, ch.items.map(function (it) {
            var note = it.debt ? (it.changeCents > 0 ? 'You owe less' : 'You owe more') : null;
            return h('div', { class: 'li' }, [
              h('span', {}, [it.name, note ? h('span', { class: 'sub', text: note }) : null]),
              h('span', { class: 'amt' }, m(it.changeCents, { sign: true }))
            ]);
          })) : h('p', { text: 'No balance has changed since ' + since + '.' }),
          h('p', { class: 'fine body-note' }, ['Total: ', m(ch.itemsTotalCents, { sign: true }),
            '. Each line is the change in a balance you entered.'])
        ]);
        dom.disclosure(changeBtn, changePanel);

        var delta = [dir + ' ', m(Math.abs(ch.amountCents))];
        if (ch.pct !== null && ch.amountCents !== 0) delta.push(' · ' + (F.hidden ? F.HIDDEN : C.pct(Math.abs(ch.pct), 1)));
        delta.push(' since ' + since);
        var controls = [dom.seg('Chart view', [{ value: 'breakdown', label: 'Breakdown' }, { value: 'total', label: 'Net worth only' }], state.mode, function (v) { state.mode = v; redraw(); })];
        if (rows.length > 6) controls.push(dom.seg('Time range', [{ value: 6, label: '6M', aria: 'Last 6 months' }, { value: Math.min(12, rows.length), label: '1Y', aria: 'Last 12 months' }], state.range, function (v) { state.range = v; redraw(); }));
        card.appendChild(h('div', { class: 'nw-head' }, [
          h('div', { class: 'nw-hero' }, [
            h('p', { class: 'eyebrow', id: 'nw-h', text: 'Net worth' }),
            h('p', { class: 'hero-num' }, m(now.netCents)),
            h('div', { class: 'nw-delta' }, [h('span', { class: 'delta' }, delta), changeBtn])
          ]),
          h('div', { class: 'nw-controls' }, controls)
        ]));
        card.appendChild(changePanel);

        // Chart
        var host = h('div', { class: 'chart-host nw-chart' });
        var readout = h('p', { class: 'readout', 'aria-live': 'polite' });
        var legend = h('ul', { class: 'legend', 'aria-label': 'Chart key' });
        card.appendChild(h('h2', { class: 'sr-only', text: 'Net worth by month' }));
        card.appendChild(host); card.appendChild(readout); card.appendChild(legend);
        var groupsUsed = S.GROUPS.filter(function (g) { return now.groups[g.id].accounts.length; });
        var chart = null;
        function slice() { return rows.slice(Math.max(0, rows.length - state.range)); }
        function setReadout(k) {
          var r = slice();
          dom.clear(readout);
          if (k < r.length) {
            var x = r[k];
            readout.appendChild(h('b', { text: C.monthLong(x.month) + (x.month === month ? ', today' : '') + ': ' }));
            readout.appendChild(document.createTextNode('assets '));
            readout.appendChild(m(x.assetsCents));
            readout.appendChild(document.createTextNode(', debts '));
            readout.appendChild(m(x.debtsCents));
            readout.appendChild(document.createTextNode(', net worth '));
            readout.appendChild(m(x.netCents));
          } else if (illus) {
            var j = k - r.length;
            readout.appendChild(h('b', { text: C.monthLong(illus.keys[j]) + ', illustration: ' }));
            readout.appendChild(m(illus.vals[j]));
            readout.appendChild(document.createTextNode('. Not a prediction.'));
          }
        }
        function ariaLabel(r) {
          var s = 'Net worth by month, ' + C.monthLong(r[0].month) + ' to ' + C.monthLong(r[r.length - 1].month) + '. ' +
            (state.mode === 'breakdown' ? 'Bars stack your asset groups above zero, and hatched debts below zero. ' : '') +
            'The net worth line goes from ' + mt(r[0].netCents) + ' to ' + mt(r[r.length - 1].netCents);
          if (illus) s += ', then a dashed three-month illustration reaches ' + mt(illus.vals[2]) + ' in ' + C.monthLong(illus.keys[2]);
          return s + '. Use the arrow keys to read each month.';
        }
        function drawLegend() {
          dom.clear(legend);
          if (state.mode === 'breakdown') groupsUsed.forEach(function (g) {
            legend.appendChild(h('li', {}, [h('span', { class: 'sw bg-' + g.token + (g.kind === 'debt' ? ' hatch' : '') }), g.name + (g.kind === 'debt' ? ', below zero' : '')]));
          });
          legend.appendChild(h('li', {}, [h('span', { class: 'sw line' }), 'Net worth']));
          if (illus) legend.appendChild(h('li', {}, [h('span', { class: 'sw dash' }), 'Illustration']));
        }
        function opts() {
          var r = slice();
          return {
            labels: r.map(function (x) { return C.monthShort(x.month); }),
            series: groupsUsed.map(function (g) {
              return { token: g.token, debt: g.kind === 'debt', values: r.map(function (x) { return (g.kind === 'debt' ? -x.groups[g.id] : x.groups[g.id]) / 100; }) };
            }),
            net: r.map(function (x) { return x.netCents / 100; }),
            illus: illus ? illus.keys.map(function (k, j) { return { label: C.monthShort(k), value: illus.vals[j] / 100 }; }) : [],
            mode: state.mode, selected: r.length - 1, ariaLabel: ariaLabel(r), onSelect: setReadout
          };
        }
        function redraw() {
          var o = opts();
          if (chart) chart.update(o); else chart = ctx.charts.stackedBars(host, o);
          setReadout(o.net.length - 1);
          drawLegend();
        }
        redraw();
        cleanup.push(function () { if (chart) chart.destroy(); });

        // The illustration: every input and the method in the same card (C8.6).
        if (illus) {
          card.appendChild(h('div', { class: 'well illus' }, [
            h('p', {}, [
              'The dashed part is an illustration, not a prediction. Starting from today’s ', m(now.netCents),
              ', it adds your average monthly change over the last 6 months, rounded to the cent, ', m(illus.step, { sign: true }),
              ' (from ', m(illus.then), ' at the end of ', C.monthLong(illus.thenMonth).split(' ')[0], ' to ', m(now.netCents), ' on ', C.dayShort(today),
              '), once for each of the next 3 months: '
            ].concat([].concat.apply([], illus.keys.map(function (k, j) {
              // The separator sits outside the no-wrap part, so the line can break there.
              return [h('span', { class: 'nowrap' }, [C.monthLong(k) + ', ', m(illus.vals[j])]), j < 2 ? '; ' : '.'];
            }))).concat([' Real months differ, and balances can go up or down.'])),
            h('p', { class: 'fine' }, [h('a', { href: '#/what-if', text: 'Change the inputs in What if' })])
          ]));
        }

        // How this works, with the numbers by month.
        var howBtn = h('button', { type: 'button', class: 'linkbtn', text: 'How this works' });
        var table = rows.map(function (x) {
          return h('tr', {}, [h('th', { scope: 'row', text: C.monthLong(x.month) + (x.month === month ? ', today' : '') }),
            h('td', {}, m(x.assetsCents)), h('td', {}, m(x.debtsCents)), h('td', {}, m(x.netCents))]);
        }).concat(illus ? illus.keys.map(function (k, j) {
          return h('tr', { class: 'illus-row' }, [h('th', { scope: 'row', text: C.monthLong(k) + ', illustration' }), h('td', { text: '' }), h('td', { text: '' }), h('td', {}, m(illus.vals[j]))]);
        }) : []);
        var howPanel = h('div', { class: 'explainer' }, [
          h('h3', { text: 'How this works' }),
          h('p', { text: 'Each bar adds up the balances you entered for the last day of that month. This month uses each account’s latest balance up to today. Assets sit above zero. Debts sit below zero, hatched.' }),
          h('p', {}, ['The line is assets minus debts. Today: ', m(now.assetsCents), ' − ', m(now.debtsCents), ' = ', m(now.netCents), '.']),
          h('p', {}, ['The change since ' + since + ' is today’s net worth minus the net worth on ' + since + ' (', m(ch.fromCents), ').',
            ch.pct !== null ? ' The percentage is that change divided by the ' + since + ' figure.' : ' No percentage is shown, because the ' + since + ' figure is not above $0.']),
          h('details', { class: 'more' }, [
            h('summary', { text: 'Show the numbers by month' }),
            h('div', { class: 'tablewrap' }, h('table', { class: 'numtable' }, [
              h('caption', { class: 'sr-only', text: 'Assets, debts and net worth by month' }),
              h('thead', {}, h('tr', {}, [h('th', { scope: 'col', text: 'Month' }), h('th', { scope: 'col', text: 'Assets' }), h('th', { scope: 'col', text: 'Debts' }), h('th', { scope: 'col', text: 'Net worth' })])),
              h('tbody', {}, table)
            ]))
          ])
        ]);
        dom.disclosure(howBtn, howPanel);
        card.appendChild(h('div', { class: 'card-foot' }, [howBtn]));
        card.appendChild(howPanel);
        card.appendChild(h('p', { class: 'note', text: 'Sums of the balances you entered, on ' + C.dayLong(today) + '. For education only, not financial advice.' }));
        return card;
      }

      // ---------- Assets and debts ----------
      function assetsDebtsCard() {
        var mode = 'totals';
        var card = h('section', { class: 'card ov-al', 'aria-labelledby': 'al-h' });
        var body = h('div');
        card.appendChild(h('div', { class: 'card-h' }, [
          h('h2', { id: 'al-h', text: 'Assets and debts' }),
          dom.seg('Show as', [{ value: 'totals', label: 'Totals' }, { value: 'percent', label: 'Percent' }], mode, function (v) { mode = v; fill(); })
        ]));
        card.appendChild(body);
        function block(title, kind) {
          var groups = S.GROUPS.filter(function (g) { return g.kind === kind && now.groups[g.id].accounts.length; });
          if (!groups.length) return [h('div', { class: 'al-total' }, [h('span', { text: title }), h('b', {}, m(0))])];
          var vals = groups.map(function (g) { return now.groups[g.id].cents; });
          var total = vals.reduce(function (s, v) { return s + v; }, 0), sh = C.sharesCents(vals);
          var out = [
            h('div', { class: 'al-total' }, [h('span', { text: title }), h('b', {}, m(kind === 'debt' ? -total : total))]),
            ctx.charts.splitBar(groups.map(function (g, i) { return { value: vals[i] / 100, token: g.token, debt: kind === 'debt', name: g.name }; }),
              { ariaLabel: title + ': ' + groups.map(function (g, i) { return g.name + ' ' + sh[i] + '%'; }).join(', ') })
          ];
          groups.forEach(function (g, i) {
            out.push(h('div', { class: 'li al-row' }, [
              h('span', { class: 'al-name' }, [h('span', { class: 'sw bg-' + g.token + (kind === 'debt' ? ' hatch' : '') }), g.name]),
              h('span', { class: 'amt' }, mode === 'percent' ? h('span', { text: sh[i].toFixed(1) + '%' }) : m(kind === 'debt' ? -vals[i] : vals[i]))
            ]));
          });
          return out;
        }
        function fill() {
          dom.clear(body);
          block('Assets', 'asset').forEach(function (n) { body.appendChild(n); });
          block('Debts', 'debt').forEach(function (n) { body.appendChild(n); });
          body.appendChild(h('p', { class: 'al-eq' }, ['Net worth: ', m(now.assetsCents), ' − ', m(now.debtsCents), ' = ', m(now.netCents)]));
        }
        fill();
        card.appendChild(h('p', { class: 'note body-note', text: 'Sums of the balances you entered. Percentages are each group’s share of its total. For education only, not financial advice.' }));
        return card;
      }

      // ---------- This month's budget ----------
      // The reader's own targets against the month's lines, with the parts
      // behind "Show the parts". No judgement: direction words in ink.
      function budgetCard() {
        var card = h('section', { class: 'card ov-bu', 'aria-labelledby': 'bu-h' });
        var monthName = C.monthLong(month);
        card.appendChild(h('div', { class: 'card-h' }, [h('h2', { id: 'bu-h', text: 'Budget, ' + monthName }), h('a', { class: 'small-link', href: '#/budget', text: 'Budget' })]));
        var budget = st.budgetFor(month);
        if (!budget || (!budget.lines.length && !budget.plannedIncomeCents)) {
          card.appendChild(h('p', {}, ['No budget for ' + monthName + ' yet. ', h('a', { href: '#/budget', text: 'Set your budget' })]));
          return card;
        }
        var b = C.budgetMonth(budget, T, CA, month);
        var spentOnLines = b.lines.reduce(function (s, l) { return s + l.actualCents; }, 0);
        var job = b.notYetGivenAJobCents;
        card.appendChild(h('div', { class: 'li' }, [h('span', { text: 'Income you planned' }), h('span', { class: 'amt' }, m(b.plannedIncomeCents))]));
        card.appendChild(h('div', { class: 'li' }, [h('span', { text: 'Your targets' }), h('span', { class: 'amt' }, m(b.targetsCents))]));
        card.appendChild(h('div', { class: 'li' }, [
          h('span', { text: 'Not yet given a job' }),
          h('span', { class: 'amt' }, job >= 0 ? m(job) : [m(-job), ' more than the income you entered'])
        ]));
        card.appendChild(h('div', { class: 'li' }, [h('span', { text: 'Spent so far in these categories' }), h('span', { class: 'amt' }, m(spentOnLines))]));
        var partsBtn = h('button', { type: 'button', class: 'explain', text: 'Show the parts' });
        var parts = h('div', { class: 'explainer' }, [
          h('h3', { text: 'Your targets and the lines so far' }),
          h('div', {}, b.lines.map(function (l) {
            var word = l.direction === 'over' ? ' over' : ' under';
            return h('div', { class: 'li' }, [
              h('span', {}, [l.name, h('span', { class: 'sub' }, ['Target ', m(l.targetCents), ', spent ', m(l.actualCents)])]),
              h('span', { class: 'amt' }, l.direction === 'on' ? 'Same as the target' : [m(Math.abs(l.leftCents)), word])
            ]);
          })),
          h('p', { class: 'fine body-note' }, ['Targets add up to ', m(b.targetsCents), '. Not yet given a job is the income you planned minus your targets: ',
            m(b.plannedIncomeCents), ' − ', m(b.targetsCents), ' = ', job >= 0 ? m(job) : [C.MINUS, m(-job)], '.'])
        ]);
        dom.disclosure(partsBtn, parts);
        card.appendChild(h('div', { class: 'card-foot' }, [partsBtn]));
        card.appendChild(parts);
        card.appendChild(h('p', { class: 'note', text: 'Sums of the targets you set and the lines you entered, 1 to ' + Number(today.slice(8, 10)) + ' ' + monthName.split(' ')[0] + '. For education only, not financial advice.' }));
        return card;
      }

      // ---------- Accounts ----------
      function accountsCard() {
        var card = h('section', { class: 'card ov-acc', 'aria-labelledby': 'ac-h' });
        card.appendChild(h('div', { class: 'card-h' }, [
          h('h2', { id: 'ac-h', text: 'Accounts' }),
          h('a', { class: 'btn small', href: '#/accounts', text: 'Add account' })
        ]));
        var months = C.monthsEnding(month, 13).map(function (k) { var e = C.monthEnd(k); return e > today ? today : e; });
        S.GROUPS.forEach(function (g) {
          var grp = now.groups[g.id];
          if (!grp.accounts.length) return;
          card.appendChild(h('h3', { class: 'grouphead' }, [h('span', { class: 'tx-' + g.token, text: g.name }), m(g.kind === 'debt' ? -grp.cents : grp.cents)]));
          var ul = h('ul', { class: 'acct-list', role: 'list' });
          grp.accounts.forEach(function (row) {
            var a = row.account, e = row.entry;
            var sub = !e ? 'No balance yet' : (e.source === 'sample' ? 'Sample balance, ' : 'Updated by you on ') + C.dayShort(e.date);
            var hist = months.map(function (d) { var x = C.entryOn(idx[a.id], d); return x ? x.cents : null; }).filter(function (v) { return v !== null; });
            var spark = hist.length >= 2 ? h('span', { class: 'acct-spark' }, [
              ctx.charts.sparkline(hist.map(function (c) { return c / 100; }), { width: 64, height: 24, cls: 's-' + g.token, dotCls: 'f-' + g.token }),
              h('span', { class: 'sr-only', text: 'Trend over ' + hist.length + ' months: from ' + mt(row.debt ? -hist[0] : hist[0]) + ' to ' + mt(shown(row)) + '.' })
            ]) : h('span', { class: 'acct-spark' });
            ul.appendChild(h('li', { class: 'li acct' }, [
              h('span', { class: 'acct-ico tint-' + g.token, 'aria-hidden': 'true', text: g.abbr }),
              h('span', {}, [a.name + (a.last4 && a.name.indexOf(a.last4) < 0 ? ' ····' + a.last4 : ''), h('span', { class: 'sub', text: sub })]),
              spark,
              h('span', { class: 'amt' }, m(shown(row)))
            ]));
          });
          card.appendChild(ul);
        });
        card.appendChild(h('p', { class: 'note', text: 'Group totals add up the balances you entered. For education only, not financial advice.' }));
        return card;
      }

      // ---------- Recent ----------
      function recentCard() {
        var card = h('section', { class: 'card ov-rec', 'aria-labelledby': 'tx-h' });
        card.appendChild(h('div', { class: 'card-h' }, [h('h2', { id: 'tx-h', text: 'Recent' }), h('a', { class: 'small-link', href: '#/transactions', text: 'All transactions' })]));
        var lines = T.filter(function (t) { return t.date <= today; }).sort(function (a, b) {
          return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);
        }).slice(0, 8);
        if (!lines.length) {
          card.appendChild(h('p', {}, ['No lines yet. ', h('a', { href: '#/transactions', text: 'Add a line' })]));
          return card;
        }
        var E = window.SWEngA;
        var ul = h('ul', { class: 'tx-list', role: 'list' });
        lines.forEach(function (t) {
          var cat = t.splits.length ? 'Split' : t.categoryId && cats[t.categoryId] ? cats[t.categoryId].name : 'Uncategorised';
          var sub = [cat + ' · ' + C.dayShort(t.date)];
          if (E && E.explainLine(t.payee)) sub.push(' · ', h('a', { href: '#/transactions', text: 'What is this?' }));
          ul.appendChild(h('li', { class: 'li' }, [
            h('span', {}, [t.payee, h('span', { class: 'sub' }, sub)]),
            h('span', { class: 'amt' }, m(t.cents, { sign: true }))
          ]));
        });
        card.appendChild(ul);
        card.appendChild(h('p', { class: 'note', text: 'The latest lines you entered or imported.' }));
        return card;
      }

      // ---------- Markets (sample data only) ----------
      // Shown only while sample data is present. Real index names in the
      // sample file are swapped for generic example names (brand rule W2),
      // and a volatility index is left out.
      function loadMarkets() {
        var mk = C.cleanMarkets(window.STEPWELL_MARKETS);
        if (!mk) return null;
        var GENERIC = {
          '^GSPC': 'US large-company stocks index (example)', '^DJI': 'US 30 large companies index (example)',
          '^IXIC': 'US tech-heavy stocks index (example)', '^RUT': 'US small-company stocks index (example)', '^VIX': null
        };
        mk.indices = mk.indices.filter(function (x) { return GENERIC[x.symbol] !== null; }).map(function (x) { x.name = GENERIC[x.symbol] || 'Stock market index (example)'; return x; });
        return mk.indices.length ? mk : null;
      }
      function marketsCard() {
        var card = h('section', { class: 'card ov-mk', 'aria-labelledby': 'mk-h' });
        var asOf = window.SWData ? C.dayLong(window.SWData.asOf) : '';
        card.appendChild(h('div', { class: 'card-h' }, [h('h2', { id: 'mk-h', text: 'Markets' }), h('span', { class: 'chip sample', text: 'Sample data, not live' })]));
        card.appendChild(h('p', { class: 'mk-intro', text: 'An index tracks a group of stocks to show how that part of the market moved.' }));
        card.appendChild(h('p', { class: 'fine body-note', text: 'Change on one example trading day, from the previous close. Example values as of ' + asOf + '.' }));
        var mk = loadMarkets();
        if (!mk) card.appendChild(h('p', { class: 'mk-none', text: 'The market examples could not be read. Nothing else on this screen is affected.' }));
        else {
          var ul = h('ul', { class: 'mk-list', role: 'list' });
          mk.indices.forEach(function (x) {
            var d = C.direction(x.change);
            var changeText = d === 'no change' ? 'No change (0.00%, example)' : (d === 'up' ? 'Up ' : 'Down ') + C.number(Math.abs(x.change)) + ' (' + C.pct(x.changePct, 2, { sign: true }) + ', example)';
            ul.appendChild(h('li', { class: 'mk-row' }, [
              h('div', { class: 'mk-text' }, [
                h('p', { class: 'mk-name', text: x.name }),
                h('p', { class: 'mk-val' }, [h('b', { class: 'num', text: C.number(x.last) }), h('span', { class: 'fine', text: ' points' })]),
                h('p', { class: 'mk-chg num', text: changeText })
              ]),
              ctx.charts.sparkline(x.spark, { width: 72, height: 28, cls: 's-muted', dotCls: 'f-muted' })
            ]));
          });
          card.appendChild(ul);
        }
        var whatBtn = h('button', { type: 'button', class: 'linkbtn', text: 'What is this?' });
        var whatPanel = h('div', { class: 'explainer' }, [
          h('h3', { text: 'What an index is' }),
          h('p', { text: 'An index is a number, in points rather than dollars. It follows the prices of a group of stocks, so it shows how that part of the market moved, not how any one investment did.' }),
          h('p', { text: 'Each change compares the example value with the previous close, in points and as a percentage. The small line shows the example values through the day.' }),
          h('p', { text: 'These are made-up values, not live prices. Past moves don’t show what comes next.' })
        ]);
        dom.disclosure(whatBtn, whatPanel);
        card.appendChild(h('div', { class: 'card-foot' }, [whatBtn]));
        card.appendChild(whatPanel);
        card.appendChild(h('p', { class: 'note', text: 'These figures are made up to show how the card works. For education only, not financial advice.' }));
        return card;
      }
    }
  });
})();
