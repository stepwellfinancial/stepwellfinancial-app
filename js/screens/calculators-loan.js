/* Calculators: the loan amortization calculator (the second tool on #/calculators).
   The maths is js/amortize.js (pure). This file only reads the three fields, calls it
   and draws the answer. Top to bottom: the results (chart of what is paid each year,
   the figures in words) beside the inputs; the what-ifs (round the payment up, or one
   extra payment a year, each with a balance-over-time graphic); the payment table,
   large and directly under; and last the explanation.
   Nothing here is stored or put in the address. Every money figure goes through $$(),
   so "Hide amounts" shows dots in the page, the chart, the aria text and the titles.
   What was typed and which what-if is chosen are kept in a variable on this page only, so
   a repaint of the screen (Hide amounts with an error showing) does not lose them;
   leaving the screen drops them.
   Every new visible string is in STRINGS, so the wording can be edited in one place.
   No HTML strings: createElement only. */
(function () {
  'use strict';
  var SW = window.SW;
  if (!SW || !SW.screens) return;
  var Z = window.Amortize;

  var LIVE_DELAY = 700;
  var CHECK_INPUTS = 'Check the inputs to see the schedule.';

  // ---------- Wording for the new material (release 2). {x} marks a figure filled in by fill(). ----------
  var STRINGS = {
    // The what-if card
    whatIfHeading: 'What if the payments were higher?',
    whatIfLead: 'Illustration: a loan of {A} at a yearly rate of {r}%, repaid in {n} monthly payments, with a monthly payment of {p}. Choose one what-if to compare it with that payment.',
    whatIfAssume: 'These what-ifs assume every extra amount goes straight to the loan balance and that nothing else changes. Real loans can differ: some limit or charge for extra payments, or apply them in another way. The extra money paid is not compared with any other use of that money.',
    optsLegend: 'Choose a what-if',
    optNone: 'None, show the monthly payment above only',
    optR500: 'Round my payment up to the next $500',
    optR1000: 'Round my payment up to the next $1,000',
    optYearly: 'One extra payment a year',
    nonePicked: 'Nothing is chosen, so only the monthly payment above is shown.',
    headRound: 'Rounding the payment up to the next {step}',
    headYearly: 'What if you made one extra payment a year?',
    // Sentences
    roundIntro: 'If the monthly payment of {p} were rounded up to the next {step}, it would be {r}. In this model, the extra {e} a month is taken off the loan balance: each month, interest is worked out first, then the regular payment comes off, then the extra amount comes off the balance as well.',
    roundSame: 'The monthly payment of {p} is already a multiple of {step}, so rounding it up to a multiple of {step} gives the same payment and the same schedule. Nothing is shown as saved.',
    yearlyIntro: 'If one extra payment, equal to the monthly payment of {p}, were made each year with the 12th regular payment, and again with the 24th, the 36th and so on, the payments in those months would each total {pp}. In this model, each extra payment is taken off the loan balance after that month\'s interest.',
    yearlyNone: 'With a term of 1 year, the 12th payment is the last one, so an extra payment that month changes nothing. Nothing is shown as saved.',
    result: 'With this, the balance would reach {zero} after payment {m}, which is {mt}, instead of after payment {pm}, which is {pmt}. Total interest would be {ti} instead of {pti}.',
    lastPay: 'The last payment would be {l}, because the balance left is smaller than a full payment.',
    // Figures
    tRounded: 'Rounded payment',
    tExtra: 'Extra payment',
    tEnds: 'Time to a {zero} balance',
    tInterest: 'Total interest',
    tIntSaved: 'Interest saved',
    tTimeSaved: 'Time saved',
    perMonth: '{x} a month',
    subRounded: 'Calculated payment: {x}',
    subExtra: 'once a year, with every 12th payment',
    subEnds: 'At the calculated payment: {x}',
    subInterest: 'At the calculated payment: {x}',
    subIntSaved: 'compared with the calculated payment',
    subTimeSaved: '{n} fewer payments',
    subTimeSavedOne: '1 fewer payment',
    subTimeSavedSame: 'Same number of payments',
    howLink: 'How this works',
    // The graphic
    chartHeading: 'Balance over time',
    seriesPlain: 'Payment as calculated',
    seriesRound: 'Payment rounded up to {r}',
    seriesYearly: 'One extra payment a year',
    axisYears: 'Years',
    chartLabel: 'Balance over time. {a} reaches {zero} after {at}. {b} reaches {zero} after {bt}.',
    chartLabelAt: 'End of year {y}: {a}, {x}; {b}, {z}.',
    chartLabelEnd: 'The balances at the end of each year are in the table under the chart.',
    // The balances table
    balancesShow: 'Show the balances by year',
    balancesHide: 'Hide the balances by year',
    balancesCaption: 'Balance at the end of each year, as calculated and with the what-if: the text version of the chart',
    balancesYear: 'Year',
    balancesColPlain: 'As calculated',
    balancesColRound: 'Rounded up',
    balancesColYearly: 'One extra a year',
    // Spoken when a what-if is chosen
    liveChange: '{h}: interest saved {i}, time saved {t}.',
    liveNone: 'No what-if chosen.',
    liveSame: '{h}: no change, nothing saved.',
    // The disclaimer under the what-ifs (the same line as under the results)
    whatIfNote: 'This is an illustration, not a quote. A lender\'s own figures can differ, for example because of fees, how it counts days or how it rounds. Not a prediction.',
    // The table card
    tableHeading: 'Payment table',
    staleNote: 'These figures are for the previous inputs. They update when the entry can be read.',
    tableInputs:'A loan of {A} at a yearly rate of {r}%, repaid in {n} monthly payments, with a monthly payment of {p}.',
    tableLead:'Every payment, or one row per year, for the monthly payment in the results above. The what-ifs are not in this table.',
    // The explanation, now below the table
    howHeading: 'How this works',
    how1: 'Each month, interest is the balance x the yearly rate / 12, rounded to the cent. The payment comes off, and what is left is the new balance. The rate stays the same and nothing else is added.',
    how2: 'The monthly payment is the amount borrowed x the monthly rate / (1 - (1 + the monthly rate) raised to minus the number of payments), rounded to the cent. The monthly rate is the yearly rate / 12. At 0%, the payment is the amount borrowed / the number of payments.',
    how3: 'The last payment is the balance left plus that month\'s interest, so the balance reaches zero. Total interest is the sum of the monthly interest, and the total paid is the sum of all payments.',
    how4: 'In the what-ifs, an extra amount is added in the same order: interest first, then the regular payment, then the extra amount comes off the balance. Rounding up adds the difference between the rounded payment and the calculated payment every month. One extra payment a year adds one more regular payment with the 12th payment, then with the 24th, and so on. Interest saved and time saved compare each what-if with the calculated payment, for the same loan amount, rate and term.'
  };
  function fill(str, map) { return str.replace(/\{(\w+)\}/g, function (m, k) { return map[k] === undefined ? m : map[k]; }); }

  var WHATS = ['none', 'r500', 'r1000', 'yearly'];

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
    var dom = ctx.dom, h = dom.h, s = dom.s, F = SW.fmt, K = SW.formKit, D = Z.DEFAULTS;
    var el = h('div', { class: 'cl-loan' });
    var f = null;                 // the three fields
    var current = null;           // { inp, sch } when the inputs give a schedule, else null
    var sel = 1;                  // the year chosen on the chart
    var chartDirty = false, tableDirty = true, tableMode = 'rows', liveTimer = 0, geo = null;
    var saved = recall();
    var what = WHATS.indexOf(saved.what) >= 0 ? saved.what : 'none';
    var wiData = null;            // the what-if figures for the chart and its table

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
    // Not a live region itself: it is rewritten on every keystroke while typing, and each rewrite would be read out. Choosing a year
    // says it through `live` (showYear, say), once.
    var readout = h('p', { class: 'cl-readout' });
    var caption = h('p', { class: 'cl-caption' });
    var big = h('p', { class: 'cl-big' });
    var text = h('div', { class: 'cl-text' });

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
    body.appendChild(h('p', { class: 'note body-note', text: 'This is an illustration, not a quote. A lender\'s own figures can differ, for example because of fees, how it counts days or how it rounds. Not a prediction.' }));
    body.appendChild(h('div', { class: 'cl-foot' }, howLink()));
    body.appendChild(h('p', { class: 'note body-note cl-disclaimer', text: 'For education only, not financial advice.' }));

    // ---------- Inputs card ----------
    var inputsCard = h('section', { class: 'card cl-inputs', 'aria-labelledby': 'cl-in-h' });
    var chipIn = h('span', { class: 'chip sample', text: 'Example inputs' });
    var fieldsBox = h('div', { class: 'cs-fields' });
    var resetBtn = h('button', { type: 'button', class: 'btn small quiet cl-reset', text: 'Back to the example inputs' });
    inputsCard.appendChild(h('div', { class: 'card-h' }, [h('h2', { id: 'cl-in-h', class: 'cs-h3', text: 'Change the inputs' }), chipIn]));
    inputsCard.appendChild(fieldsBox);
    // Visible only while the answer is stale (the class cl-stale on the screen, set and cleared in refresh); the space is always
    // reserved, so showing it moves nothing. Not a live region: the field's own message is spoken when the field is left.
    inputsCard.appendChild(h('p', { class: 'cl-stale-note', text: STRINGS.staleNote }));
    inputsCard.appendChild(h('div', { class: 'cs-foot' }, resetBtn));
    inputsCard.appendChild(h('p', { class: 'note body-note', text: 'These start as example inputs. Nothing you type here is saved.' }));

    // ---------- The what-if card ----------
    var wiCard = h('section', { class: 'card cl-wi', 'aria-labelledby': 'cl-wi-h' });
    var wiLive = h('p', { class: 'sr-only', 'aria-live': 'polite' });
    var wiOut = h('div', { class: 'cl-wi-out' });
    var wiHead = h('h3', { class: 'cl-wi-h3' });
    var wiNote = h('p', { class: 'cl-wi-none' });
    var wiSentences = h('div', { class: 'cl-wi-text' });
    var wiTiles = h('dl', { class: 'cl-tiles' });
    var wiHost = h('div', { class: 'cl-wi-chart' });
    var keyPlainTx = h('span'), keyPlanTx = h('span');
    var wiChartBox = h('div', { class: 'cl-wi-chartbox' }, [
      h('h4', { class: 'cl-chart-h', text: STRINGS.chartHeading }),
      wiHost,
      h('ul', { class: 'legend cl-legend', 'aria-label': 'Chart key' }, [
        h('li', {}, [h('span', { class: 'cl-key cl-key-plain' }), keyPlainTx]),
        h('li', {}, [h('span', { class: 'cl-key cl-key-plan' }), keyPlanTx])
      ])
    ]);
    var balBtn = h('button', { type: 'button', class: 'linkbtn cl-link', text: STRINGS.balancesShow });
    var balHead = h('thead'), balBody = h('tbody'), balCap = h('caption', { class: 'sr-only', text: STRINGS.balancesCaption });
    var balPanel = h('div', { class: 'cl-wi-bal' }, [
      h('div', { class: 'cl-scroll cl-scroll-s', role: 'region', 'aria-label': STRINGS.balancesCaption, tabindex: '0' },
        h('table', { class: 'numtable cl-table' }, [balCap, balHead, balBody]))
    ]);
    dom.disclosure(balBtn, balPanel, function () { drawBalances(); });
    balBtn.addEventListener('click', function () {
      balBtn.textContent = balBtn.getAttribute('aria-expanded') === 'true' ? STRINGS.balancesHide : STRINGS.balancesShow;
    });
    var balFoot = h('div', { class: 'cl-foot' }, balBtn);
    wiOut.appendChild(wiHead);
    wiOut.appendChild(wiSentences);
    wiOut.appendChild(wiNote);
    wiOut.appendChild(wiTiles);
    wiOut.appendChild(wiChartBox);
    wiOut.appendChild(balFoot);
    wiOut.appendChild(balPanel);

    var radios = {}, gid = dom.id('cl-wi-opt');
    var optsBox = h('fieldset', { class: 'cl-opts' }, [h('legend', { text: STRINGS.optsLegend })]);
    [['none', STRINGS.optNone], ['r500', STRINGS.optR500], ['r1000', STRINGS.optR1000], ['yearly', STRINGS.optYearly]].forEach(function (o) {
      var r = h('input', { type: 'radio', name: gid, value: o[0] });
      r.checked = o[0] === what;
      r.addEventListener('change', function () {
        if (!r.checked) return;
        what = o[0];
        remember({ what: what });
        drawWhatIf();
        wiLive.textContent = liveWhat();
      });
      radios[o[0]] = r;
      optsBox.appendChild(h('label', {}, [r, h('span', { text: o[1] })]));
    });
    var chipWi = h('span', { class: 'chip sample', text: 'Example inputs' });
    wiCard.appendChild(h('div', { class: 'card-h' }, [h('div', {}, [
      h('p', { class: 'eyebrow', text: 'Illustration' }),
      h('h2', { id: 'cl-wi-h', class: 'cs-h3', text: STRINGS.whatIfHeading })
    ]), chipWi]));
    var wiLead = h('p', { class: 'cl-wi-lead' });   // rebuilt from the inputs on screen, so it follows Hide amounts
    wiCard.appendChild(wiLead);
    wiCard.appendChild(h('div', { class: 'cl-foot' }, howLink()));
    wiCard.appendChild(optsBox);
    wiCard.appendChild(wiOut);
    wiCard.appendChild(h('p', { class: 'note body-note', text: STRINGS.whatIfAssume }));
    wiCard.appendChild(h('p', { class: 'note body-note', text: STRINGS.whatIfNote }));
    wiCard.appendChild(h('p', { class: 'note body-note cl-disclaimer', text: 'For education only, not financial advice.' }));
    wiCard.appendChild(wiLive);

    // ---------- The table card: large, directly under the results ----------
    var tableCard = h('section', { class: 'card cl-tablecard', 'aria-labelledby': 'cl-tb-h' });
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
    var chipTb = h('span', { class: 'chip sample', text: 'Example inputs' });
    var tbInputs = h('p', { class: 'cl-wi-lead' });   // the inputs behind the table, rebuilt with the figures so it follows Hide amounts
    tableCard.appendChild(h('div', { class: 'card-h' }, [h('div', {}, [
      h('p', { class: 'eyebrow', text: 'Illustration' }),
      h('h2', { id: 'cl-tb-h', class: 'cs-h3', text: STRINGS.tableHeading })
    ]), chipTb]));
    tableCard.appendChild(tbInputs);
    tableCard.appendChild(h('p', { class: 'cl-wi-lead', text: STRINGS.tableLead }));
    tableCard.appendChild(h('div', { class: 'cl-foot' }, [tableBtn, howLink()]));
    tableCard.appendChild(tablePanel);
    tableCard.appendChild(h('p', { class: 'note body-note cl-disclaimer', text: 'For education only, not financial advice.' }));

    // ---------- The explanation: below the table ----------
    // A same-page link: a button that scrolls to the heading and puts focus on it. It never touches
    // the address, so the hash router is not disturbed (no "#anchor" link).
    var howHeading = h('h2', { id: 'cl-how-h', class: 'cs-h3', tabindex: '-1', text: STRINGS.howHeading });
    function howLink() {
      var b = h('button', { type: 'button', class: 'linkbtn cl-link', text: STRINGS.howLink });
      b.addEventListener('click', function () { howHeading.scrollIntoView({ block: 'start' }); howHeading.focus({ preventScroll: true }); });
      return b;
    }
    var howCard = h('section', { class: 'card cl-how', 'aria-labelledby': 'cl-how-h' }, [
      howHeading,
      h('p', { class: 'cs-body', text: STRINGS.how1 }),
      h('p', { class: 'cs-body', text: STRINGS.how2 }),
      h('p', { class: 'cs-body', text: STRINGS.how3 }),
      h('p', { class: 'cs-body', text: STRINGS.how4 })
    ]);

    // Results and inputs side by side with the what-ifs under the results; then the table; then the explanation.
    el.appendChild(h('div', { class: 'cl-grid' }, [resultCard, inputsCard, wiCard]));
    el.appendChild(tableCard);
    el.appendChild(howCard);

    // ---------- Fields ----------
    function termHint(years) { return years === 1 ? '1 year is 12 monthly payments.' : years + ' years is ' + (years * 12) + ' monthly payments.'; }
    function buildFields(from) {
      dom.clear(fieldsBox);
      from = from || {};
      f = {
        // accepts: the form kit tidies a left field only where this screen's own reader reads it as a number (a value out of range is
        // still tidied, then refused with its message); "0,500" is not a number here, so it is left as typed, with the message.
        amount: K.field({ label: 'Loan amount', kind: 'money', prefix: '$', value: D.cents,
          accepts: function (t) { var r = Z.parseAmount(t); return r.ok || r.message === Z.MSG.amountRange; } }),
        rate: K.field({ label: 'Yearly interest rate (%)', kind: 'text', value: D.rate, cap: 'money' }),
        term: K.field({ label: 'Term in years', kind: 'text', value: D.term, cap: 'money', hint: termHint(D.years) })
      };
      if (from.amount !== undefined) f.amount.input.value = from.amount;
      if (from.rate !== undefined) f.rate.input.value = from.rate;
      if (from.term !== undefined) f.term.input.value = from.term;
      f.term.input.setAttribute('inputmode', 'numeric');
      // The rate gets the decimal keypad on a phone (it has the "."); data-plain-number tells the Hide amounts audit it is not an amount.
      f.rate.input.setAttribute('inputmode', 'decimal');
      f.rate.input.setAttribute('data-plain-number', '');
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
        fk.input.addEventListener('blur', function () {
          // Leaving the amount: whatever reads as an amount (spaces, "$", commas) is written back as $250,000.00.
          if (k === 'amount' && !F.hidden) {
            var a = Z.parseAmount(fk.input.value);
            if (a.ok) fk.input.value = '$' + K.inputText(a.cents);
          }
          check(k); refresh(false);
          // The message appears under a field the reader has just left: say it, so it is not found only by going back.
          var shown = fk.el.classList.contains('fk-bad') && fk.el.querySelector('.fk-err');
          if (shown) { clearTimeout(liveTimer); live.textContent = shown.textContent; }
        });
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
      // Still typing, and what is typed cannot be read yet (the first digit of a new amount is under $100): the answer must not
      // collapse, or the page jumps under the field being typed in. The last answer stays as it is (its chips too, as they
      // describe the figures shown), dimmed, until the field is left (leaving it, or Enter, shows the message as before);
      // a screen reader is told after the usual pause.
      if (typed && !inp.ok && current) {
        el.classList.add('cl-stale');
        speak(typed, CHECK_INPUTS);
        return;
      }
      el.classList.remove('cl-stale');
      chipRes.hidden = chipIn.hidden = chipWi.hidden = chipTb.hidden = !(inp.ok && inp.cents === D.cents && inp.milli === D.milli && inp.years === D.years);
      dom.clear(tbody); dom.clear(thead); tableDirty = true;
      if (!inp.ok || !res.ok) {
        current = null;
        msg.hidden = false; body.hidden = true;
        msg.textContent = !inp.ok ? CHECK_INPUTS : Z.MSG.guard;
        chipRes.hidden = chipIn.hidden = chipWi.hidden = chipTb.hidden = true;
        wiCard.hidden = tableCard.hidden = true;
        tbInputs.textContent = '';
        drawChart();
        drawWhatIf();
        speak(typed, msg.textContent);
        return;
      }
      msg.hidden = true; body.hidden = false;
      wiCard.hidden = tableCard.hidden = false;
      var sameRun = current && current.inp.cents === inp.cents && current.inp.milli === inp.milli && current.inp.years === inp.years;
      current = { inp: inp, sch: res };
      if (!sameRun || sel > res.years.length) sel = 1;
      drawText();
      drawChart();
      drawWhatIf();
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
      tbInputs.textContent = fill(STRINGS.tableInputs, { A: A, r: r, n: n, p: $$(sch.payment) });
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
    function showYear(y, focus, say) {
      sel = y;
      readout.textContent = readoutText(y);
      if (say) { clearTimeout(liveTimer); live.textContent = readout.textContent; }   // a reader's own choice of year is read out once
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
        b.addEventListener('click', function () { showYear(d.year, false, true); });
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
      showYear(Math.max(1, Math.min(Y, to)), true, true);
    });
    var chartCtl = SW.charts.responsive(host, draw);

    // ---------- The what-ifs ----------
    function stepText(step) { return step === 500 ? '$500' : '$1,000'; }
    // The chosen what-if worked out for the inputs now on screen, or null.
    function compute() {
      if (!current || what === 'none') return null;
      var i = current.inp, r = what === 'yearly' ? Z.extraYearly(i.cents, i.milli, i.years) : Z.roundUp(i.cents, i.milli, i.years, what === 'r500' ? 500 : 1000);
      if (!r.ok) return null;
      var same = what === 'yearly' ? (r.interestSaved === 0 && r.monthsSaved === 0) : r.alreadyOnStep;
      var step = what === 'r500' ? 500 : 1000;
      var head = what === 'yearly' ? STRINGS.headYearly : fill(STRINGS.headRound, { step: stepText(step) });
      var planName = what === 'yearly' ? STRINGS.seriesYearly : fill(STRINGS.seriesRound, { r: $$(r.roundedPayment) });
      return { r: r, same: same, step: step, head: head, planName: planName, cents: i.cents };
    }
    function liveWhat() {
      var d = wiData;
      if (!d) return STRINGS.liveNone;
      if (d.same) return fill(STRINGS.liveSame, { h: d.head });
      return fill(STRINGS.liveChange, { h: d.head, i: $$(d.r.interestSaved), t: Z.monthsText(d.r.monthsSaved) });
    }
    function tile(label, value, sub, cls) {
      return h('div', { class: cls || '' }, [h('dt', { text: label }), h('dd', { text: value }), sub ? h('dd', { class: 'cl-more', text: sub }) : null]);
    }
    function drawWhatIf() {
      var balOpen = balBtn.getAttribute('aria-expanded') === 'true';
      dom.clear(wiTiles); dom.clear(wiSentences); dom.clear(wiNote); dom.clear(wiHost); dom.clear(balHead); dom.clear(balBody);
      wiData = compute();
      wiLead.textContent = current ? fill(STRINGS.whatIfLead, { A: $$(current.inp.cents), r: Z.rateText(current.inp.milli), n: current.inp.years * 12, p: $$(current.sch.payment) }) : '';
      wiOut.hidden = false;
      wiNote.hidden = true;
      var show = !!wiData;
      wiHead.hidden = wiTiles.hidden = wiSentences.hidden = !show;
      wiChartBox.hidden = balFoot.hidden = true;
      // The balances table stays open while the reader types, and is built again with the new figures.
      var keepBal = balOpen && show && !wiData.same;
      balPanel.hidden = !keepBal; balBtn.setAttribute('aria-expanded', keepBal ? 'true' : 'false');
      balBtn.textContent = keepBal ? STRINGS.balancesHide : STRINGS.balancesShow;
      if (!current) { wiOut.hidden = true; wiCtl.redraw(); return; }
      if (!show) {
        wiNote.hidden = false;
        wiNote.textContent = STRINGS.nonePicked;
        wiCtl.redraw();
        return;
      }
      var d = wiData, r = d.r, p = r.payment, A = current.inp;
      wiHead.textContent = d.head;
      var sentences = [];
      if (what === 'yearly') {
        sentences.push(fill(d.same ? STRINGS.yearlyNone : STRINGS.yearlyIntro, { p: $$(p), pp: $$(2 * p) }));
      } else if (d.same) {
        sentences.push(fill(STRINGS.roundSame, { p: $$(p), step: stepText(d.step) }));
      } else {
        sentences.push(fill(STRINGS.roundIntro, { p: $$(p), step: stepText(d.step), r: $$(r.roundedPayment), e: $$(r.extra) }));
      }
      if (!d.same) {
        sentences.push(fill(STRINGS.result, { zero: $$(0), m: r.months, mt: Z.monthsText(r.months), pm: r.plainMonths, pmt: Z.monthsText(r.plainMonths), ti: $$(r.totalInterest), pti: $$(r.plainTotalInterest) }));
        var full = what === 'yearly' ? p : r.roundedPayment;
        if (r.plan.lastPayment < full) sentences.push(fill(STRINGS.lastPay, { l: $$(r.plan.lastPayment) }));
      }
      sentences.forEach(function (t) { wiSentences.appendChild(h('p', { class: 'cl-sentence', text: t })); });
      if (d.same) { wiTiles.hidden = true; wiCtl.redraw(); return; }
      if (what === 'yearly') wiTiles.appendChild(tile(STRINGS.tExtra, $$(p), STRINGS.subExtra));
      else wiTiles.appendChild(tile(STRINGS.tRounded, fill(STRINGS.perMonth, { x: $$(r.roundedPayment) }), fill(STRINGS.subRounded, { x: $$(p) })));
      wiTiles.appendChild(tile(fill(STRINGS.tEnds, { zero: $$(0) }), Z.monthsText(r.months), fill(STRINGS.subEnds, { x: Z.monthsText(r.plainMonths) })));
      wiTiles.appendChild(tile(STRINGS.tInterest, $$(r.totalInterest), fill(STRINGS.subInterest, { x: $$(r.plainTotalInterest) })));
      wiTiles.appendChild(tile(STRINGS.tIntSaved, $$(r.interestSaved), STRINGS.subIntSaved));
      wiTiles.appendChild(tile(STRINGS.tTimeSaved, Z.monthsText(r.monthsSaved), r.monthsSaved === 0 ? STRINGS.subTimeSavedSame : r.monthsSaved === 1 ? STRINGS.subTimeSavedOne : fill(STRINGS.subTimeSaved, { n: r.monthsSaved })));
      keyPlainTx.textContent = STRINGS.seriesPlain;
      keyPlanTx.textContent = d.planName;
      wiChartBox.hidden = balFoot.hidden = false;
      if (keepBal) drawBalances();
      wiCtl.redraw();
    }

    // The balance at the end of year y for a list of rows (0 once the last payment is made).
    function balanceAt(rows, y) { var i = y * 12 - 1; return i >= rows.length ? 0 : rows[i].balance; }
    // [month, balance] points: the start, then every 12th month, then the last month.
    function points(rows, A) {
      var pts = [[0, A]];
      rows.forEach(function (r, i) { if (r.no % 12 === 0 || i === rows.length - 1) pts.push([r.no, r.balance]); });
      return pts;
    }
    function drawWI(W) {
      dom.clear(wiHost);
      var d = wiData;
      if (!d || d.same || !current || wiChartBox.hidden) return;
      var plain = d.r.plain.rows, plan = d.r.plan.rows, A = d.cents;
      var mobile = W < 520, plotH = mobile ? 190 : 240;
      var L = mobile ? 46 : 56, R = 12, T = 10, B = 46, H = plotH + T + B;
      var yearsMax = plain.length / 12, pw = W - L - R;
      var step = niceStep(A / 100 / (mobile ? 3.5 : 4.5)), top = Math.max(step, Math.ceil(A / 100 / step - 1e-9) * step);
      var xv = function (month) { return L + (month / 12) / yearsMax * pw; };
      var yv = function (cents) { return T + (1 - cents / 100 / top) * plotH; };
      var svg = s('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', focusable: 'false', class: 'chart cl-svg cl-wi-svg' });
      for (var g = 0; g <= top + step / 2; g += step) {
        var gy = yv(g * 100).toFixed(1);
        svg.appendChild(s('line', { x1: L, x2: W - R, y1: gy, y2: gy, class: g === 0 ? 's-zero' : 's-grid' }));
        svg.appendChild(s('text', { x: L - 8, y: Number(gy) + 4, class: 'ax', 'text-anchor': 'end' }, axisText(Number(g.toFixed(6)))));
      }
      var xs = [1, 2, 5, 10].filter(function (v) { return yearsMax / v <= 8; })[0] || 10;
      for (var yr = 0; yr <= yearsMax + 1e-9; yr += xs) svg.appendChild(s('text', { x: xv(yr * 12).toFixed(1), y: H - 26, class: 'ax', 'text-anchor': 'middle' }, String(yr)));
      svg.appendChild(s('text', { x: (L + pw / 2).toFixed(1), y: H - 6, class: 'ax', 'text-anchor': 'middle' }, STRINGS.axisYears));
      var a = points(plain, A), b = points(plan, A);
      function pathOf(pts) { return pts.map(function (p) { return xv(p[0]).toFixed(1) + ' ' + yv(p[1]).toFixed(1); }); }
      var pa = pathOf(a), pb = pathOf(b);
      svg.appendChild(s('path', { d: 'M' + pa.concat(pb.slice().reverse()).join(' L ') + ' Z', class: 'cl-wi-gap' }));
      svg.appendChild(s('path', { d: 'M' + pa.join(' L '), class: 'cl-wi-ln cl-wi-ln-plain' }));
      svg.appendChild(s('path', { d: 'M' + pb.join(' L '), class: 'cl-wi-ln cl-wi-ln-plan' }));
      var end = b[b.length - 1];
      svg.appendChild(s('circle', { cx: xv(end[0]).toFixed(1), cy: yv(end[1]).toFixed(1), r: 4.5, class: 'cl-wi-dot' }));
      var parts = [fill(STRINGS.chartLabel, { a: STRINGS.seriesPlain, b: d.planName, zero: $$(0), at: Z.monthsText(plain.length), bt: Z.monthsText(plan.length) })];
      var yMax = Math.ceil(yearsMax);
      for (var k = 1; k <= yMax; k++) {
        if (k === 1 || k % 5 === 0 || k === yMax) parts.push(fill(STRINGS.chartLabelAt, { y: k, a: STRINGS.seriesPlain, x: $$(balanceAt(plain, k)), b: d.planName, z: $$(balanceAt(plan, k)) }));
      }
      parts.push(STRINGS.chartLabelEnd);
      svg.setAttribute('aria-label', parts.join(' '));
      wiHost.appendChild(svg);
    }
    var wiCtl = SW.charts.responsive(wiHost, drawWI);

    function drawBalances() {
      dom.clear(balHead); dom.clear(balBody);
      var d = wiData;
      if (!d || d.same) return;
      var plain = d.r.plain.rows, plan = d.r.plan.rows, Y = Math.ceil(plain.length / 12);
      balHead.appendChild(h('tr', {}, [
        h('th', { scope: 'col', text: STRINGS.balancesYear }),
        h('th', { scope: 'col', text: STRINGS.balancesColPlain }),
        h('th', { scope: 'col', text: what === 'yearly' ? STRINGS.balancesColYearly : STRINGS.balancesColRound })
      ]));
      var frag = document.createDocumentFragment();
      for (var y = 1; y <= Y; y++) {
        var tr = document.createElement('tr'), th = document.createElement('th');
        th.scope = 'row'; th.textContent = String(y); tr.appendChild(th);
        [balanceAt(plain, y), balanceAt(plan, y)].forEach(function (v) { var td = document.createElement('td'); td.textContent = $$(v); tr.appendChild(td); });
        frag.appendChild(tr);
      }
      balBody.appendChild(frag);
    }

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
      what = 'none'; radios.none.checked = true; remember({ what: 'none' });
      buildFields(); refresh(false);
      ctx.app.announce('Example inputs restored');
      f.amount.input.focus();
    });

    buildFields({ amount: saved.amount, rate: saved.rate, term: saved.term, shown: saved.shown });
    refresh(false);

    return {
      el: el,
      // The screen shows this calculator: draw what was waiting.
      shown: function () { chartDirty = false; if (current) { chartCtl.redraw(); wiCtl.redraw(); } },
      // Hide amounts changed: every figure is built again, the typed text stays.
      // The spoken lines are emptied too, so no old figure stays readable.
      settingsChanged: function () { clearTimeout(liveTimer); live.textContent = ''; wiLive.textContent = ''; refresh(false); },
      destroy: function () { clearTimeout(liveTimer); chartCtl.destroy(); wiCtl.destroy(); }
    };
  }

  SW.loanCalculator = { create: create, remember: remember, recall: recall };
})();
