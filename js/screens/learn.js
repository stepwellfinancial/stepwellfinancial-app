/* Learn: the lessons that exist, a myth check, a short glossary, and lessons
   offered because of a plain fact in the reader's own records.
   An offer follows fixed rules, states the fact and names the lesson
   ("You have a credit card balance. Lesson: how interest on cards works."),
   and opens only if the reader chooses. Each lesson is the same for
   everyone and shows none of the reader's figures. Lessons open at
   #/learn/<lesson>. The dated pathway stays behind SW.flags.pathwayRoadmap.

   PART 1 is pure (no DOM): the lesson list and the offer rules, so the test
   page can check them alone. PART 2 is the screen. */
(function (root) {
  'use strict';
  var SW = root.SW = root.SW || {};
  var E = SW.engC = SW.engC || {};

  // Only lessons that exist. Onboarding offers these as topics (settings.topics).
  var LESSONS = [
    { id: 'card-interest', title: 'How interest on cards works', blurb: 'What an APR is, how card interest is worked out, and what a grace period is.' },
    { id: 'credit-scores', title: 'How credit scores work', blurb: 'What a score is built from, FICO and VantageScore, and where free credit reports come from.' },
    { id: 'fees', title: 'What account fees are', blurb: 'The fees accounts charge, and the cost a fund takes out of itself.' }
  ];
  function lesson(id) { return LESSONS.filter(function (l) { return l.id === id; })[0] || null; }
  // Topics the reader picked come first; otherwise the order above.
  function ordered(topics) {
    var t = topics || [];
    return LESSONS.slice().sort(function (a, b) {
      var ia = t.indexOf(a.id), ib = t.indexOf(b.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || LESSONS.indexOf(a) - LESSONS.indexOf(b);
    });
  }

  // offers({ accounts, balances, transactions, categories, scores }, today) ->
  //   [{ id, fact, lesson, fromSample }] by fixed rules:
  //   a credit card with a balance above $0 today; a line in a fee category in the
  //   last 12 months; a credit score the reader entered.
  function offers(d, today) {
    var C = root.SWCalc, out = [];
    var cards = C.totalsOn(d.accounts, d.balances, today).rows.filter(function (r) { return r.account.type === 'credit_card' && r.cents > 0; });
    if (cards.length) out.push({ id: 'card-interest', fact: 'You have a credit card balance.', lesson: 'how interest on cards works',
      fromSample: cards.every(function (r) { return r.account.source === 'sample'; }) });
    var fee = {};
    d.categories.forEach(function (c) { if (c.isFee) fee[c.id] = true; });
    var from = (Number(today.slice(0, 4)) - 1) + today.slice(4);
    var fees = d.transactions.filter(function (t) {
      if (t.date <= from || t.date > today || t.cents >= 0) return false;
      return fee[t.categoryId] || (t.splits || []).some(function (p) { return fee[p.categoryId]; });
    });
    if (fees.length) out.push({ id: 'fees', fact: 'You have fee lines in your transactions from the last 12 months.', lesson: 'what account fees are',
      fromSample: fees.every(function (t) { return t.source === 'sample'; }) });
    if (d.scores.length) out.push({ id: 'credit-scores', fact: 'You entered a credit score.', lesson: 'how credit scores work',
      fromSample: d.scores.every(function (s) { return s.source === 'sample'; }) });
    return out;
  }
  function offerSentence(o) { return o.fact + ' Lesson: ' + o.lesson + '.'; }

  E.learn = { LESSONS: LESSONS, lesson: lesson, ordered: ordered, offers: offers, offerSentence: offerSentence };
})(this);

/* PART 2: the screen. */
(function () {
  'use strict';
  var SW = window.SW;
  if (!SW || !SW.screens) return;
  var L = SW.engC.learn;

  // Offers the reader put away, for this visit only (never stored).
  var putAway = {};

  var GLOSSARY = [
    ['APR', 'Annual percentage rate: the yearly cost of borrowing, shown as a percentage.'],
    ['APY', 'Annual percentage yield: what a savings balance would earn in a year at a given rate, with compounding counted.'],
    ['Credit report', 'A record of credit accounts and their payment history, kept by a credit bureau.'],
    ['Credit score', 'A number a scoring model works out from a credit report.'],
    ['Net worth', 'What you own minus what you owe.'],
    ['Sinking fund', 'A sinking fund is a named goal for one cost you know is coming.']
  ];

  SW.screens.register('learn', {
    render: function (wrap, ctx) {
      var store = ctx.store, dom = ctx.dom, h = dom.h;
      var sub = String(ctx.sub || '');
      var focus = null;

      draw();
      return {
        onStoreChange: function () {
          var st = store.status();
          if (st.locked || st.deleted || st.closed) return false;
          draw();
          return true;
        }
      };

      function draw() {
        dom.clear(wrap);
        if (sub) return lessonView(L.lesson(sub));
        var list = L.offers({ accounts: store.list('accounts'), balances: store.list('balances'), transactions: store.list('transactions'),
          categories: store.list('categories'), scores: ctx.flags.creditScore ? store.list('scores') : [] }, store.today());
        var shown = list.filter(function (o) { return !putAway[o.id]; });
        var sample = shown.some(function (o) { return o.fromSample; });
        wrap.appendChild(ctx.app.screenHeader(ctx.route, { eyebrow: 'Lessons' + (sample ? ' · Sample data' : '') }));
        var left = h('div', { class: 'ln-col' }), right = h('div', { class: 'ln-col' });
        wrap.appendChild(h('div', { class: 'ln-grid' }, [left, right]));
        if (shown.length) left.appendChild(offersCard(shown, sample));
        else if (list.length) left.appendChild(h('p', { class: 'card ln-p ln-putaway', tabindex: '-1', 'data-focus': 'putaway', text: 'Lessons from your data are put away for now. They are still in the list below.' }));
        left.appendChild(lessonsCard());
        if (ctx.flags.pathwayRoadmap) left.appendChild(roadmapCard());
        right.appendChild(mythCard());
        right.appendChild(glossaryCard());
        if (focus) { var el = wrap.querySelector('[data-focus="' + focus + '"]'); focus = null; if (el) el.focus(); }
      }

      // ---------- From your data ----------
      function offersCard(shown, sample) {
        var ul = h('ul', { class: 'ln-offers', role: 'list' });
        shown.forEach(function (o) {
          var later = h('button', { type: 'button', class: 'btn small quiet', text: 'Not now', 'aria-label': 'Not now: ' + o.lesson });
          later.addEventListener('click', function () { putAway[o.id] = true; focus = 'putaway'; draw(); if (!wrap.querySelector('[data-focus="putaway"]')) { var f = wrap.querySelector('.ln-offers button'); if (f) f.focus(); } });
          ul.appendChild(h('li', { class: 'ln-offer' }, [
            h('p', { class: 'ln-p ln-fact' }, [o.fact + ' Lesson: ', h('a', { href: '#/learn/' + o.id, text: o.lesson }), '.']),
            later
          ]));
        });
        return h('section', { class: 'card ln-from', 'aria-labelledby': 'ln-from-h' }, [
          h('div', { class: 'card-h' }, [h('h2', { id: 'ln-from-h', text: 'From your data' }), sample ? h('span', { class: 'chip sample', text: 'Sample data' }) : null]),
          ul,
          h('p', { class: 'ln-p ln-why', text: 'These come from fixed rules about what you entered. Each lesson is the same for everyone and uses example figures, not yours.' })
        ]);
      }

      // ---------- The lessons that exist ----------
      function lessonsCard() {
        var ul = h('ul', { class: 'ln-list', role: 'list' });
        L.ordered(store.settings().topics).forEach(function (l) {
          ul.appendChild(h('li', { class: 'ln-item' }, [h('a', { href: '#/learn/' + l.id, class: 'ln-item-t', text: l.title }), h('p', { class: 'ln-p', text: l.blurb })]));
        });
        return h('section', { class: 'card', 'aria-labelledby': 'ln-list-h' }, [h('h2', { id: 'ln-list-h', text: 'Lessons' }), ul]);
      }
      // Held: shown only when the flag is on, after it is cleared.
      function roadmapCard() {
        return h('section', { class: 'card', 'aria-label': 'Dated pathway' }, [h('h2', { text: 'Money basics, at your pace' }),
          h('p', { class: 'ln-p', text: 'Same lessons, same order, for everyone. The dates come only from the pace you choose.' })]);
      }

      function mythCard() {
        return h('section', { class: 'card ln-myth', 'aria-labelledby': 'ln-myth-h' }, [
          h('p', { class: 'eyebrow', id: 'ln-myth-h', text: 'Myth check' }),
          h('p', { class: 'ln-myth-q' }, h('b', { text: '“Carrying a card balance helps your credit score.”' })),
          h('p', { class: 'ln-p', text: 'Scores look at things like payment history and how much of the available credit is in use. Interest charged on a balance is not part of the score.' })
        ]);
      }
      function glossaryCard() {
        var dl = h('dl', { class: 'ln-gloss' });
        GLOSSARY.forEach(function (g) { dl.appendChild(h('dt', { text: g[0] })); dl.appendChild(h('dd', { text: g[1] })); });
        return h('section', { class: 'card', 'aria-labelledby': 'ln-gloss-h' }, [h('h2', { id: 'ln-gloss-h', text: 'Glossary' }), dl]);
      }

      // ---------- One lesson: the same for everyone, none of the reader's figures ----------
      function lessonView(l) {
        if (!l) {
          wrap.appendChild(ctx.app.screenHeader(ctx.route, { eyebrow: 'Lessons', title: 'We couldn’t find that lesson' }));
          wrap.appendChild(h('section', { class: 'card ln-lesson' }, [h('p', { class: 'ln-p' }, ['It may have a different name. ', h('a', { href: '#/learn', text: 'See the lessons in Learn' }), '.'])]));
          return;
        }
        wrap.appendChild(ctx.app.screenHeader(ctx.route, { eyebrow: 'Lesson · the same for everyone', title: l.title }));
        var body = l.id === 'credit-scores' ? creditLesson() : l.id === 'fees' ? feesLesson() : cardLesson();
        wrap.appendChild(h('article', { class: 'card ln-lesson', 'aria-labelledby': 'view-title' }, body.concat([
          h('p', { class: 'disclaimer', text: 'For education only, not financial advice.' }),
          h('p', { class: 'ln-back' }, h('a', { href: '#/learn', text: 'Back to Learn' }))
        ])));
      }
      function sec(title, paras) {
        return [h('h2', { text: title })].concat(paras.map(function (p) { return typeof p === 'string' ? h('p', { class: 'ln-p', text: p }) : p; }));
      }
      function cardLesson() {
        return [].concat(
          sec('The rate', ['A card’s interest rate is shown as an APR, a yearly percentage. Card interest is usually worked out each day from that rate, on the balance carried on the card.']),
          sec('The grace period', ['Many cards have a grace period. When the full statement balance is cleared by the due date, no interest is charged on new purchases. A balance carried past the due date starts to collect interest.']),
          sec('Other rates on the same card', ['A card can have more than one APR, such as one for purchases and a higher one for cash advances, which often have no grace period. The card’s terms and each statement list its rates.']),
          [h('p', { class: 'ln-p' }, ['To see a rate at work on numbers you type in, the Loan tab on ', h('a', { href: '#/what-if', text: 'What if' }), ' shows an illustration.'])]
        );
      }
      function feesLesson() {
        return [].concat(
          sec('What a fee is', ['A fee is a charge an account takes for a service or after an event. Some are regular, like a monthly account fee or a card’s yearly fee. Others come only after an event, like a late fee or an overdraft fee.']),
          sec('Fund costs', ['An investment fund has a cost too, called the expense ratio. It is a yearly percentage taken out of the fund itself, so it doesn’t show as a line in your transactions.']),
          [h('p', { class: 'ln-p' }, ['The fee x-ray on ', h('a', { href: '#/bills', text: 'Bills' }), ' lists the fee lines in your own transactions.'])]
        );
      }
      function creditLesson() {
        var F = SW.engC.settings ? SW.engC.settings.FACTORS : [];
        return [].concat(
          sec('What a score is', ['A credit score is a number a scoring model works out from the information in a credit report. Lenders and others use it as a short summary of that report.']),
          [h('h2', { text: 'What scores are generally built from' }),
            h('ul', { class: 'ln-factors' }, F.map(function (f) { return h('li', {}, [h('b', { text: f[0] + ': ' }), f[1]]); })),
            h('p', { class: 'ln-p', text: 'Each scoring model weighs these in its own way.' })],
          sec('FICO and VantageScore', [
            'FICO and VantageScore are two companies that make scoring models, and each has several versions. Recent versions of both use a scale of 300 to 850, and some versions use other ranges.',
            'The same credit report can give a different number in each model, because each model weighs the information in its own way.'
          ]),
          sec('Why scores differ', ['Scores can differ between apps and sites because they use different models, different data held by each credit bureau, and different dates.']),
          sec('Free credit reports', [
            'AnnualCreditReport.com is where free credit reports from the three nationwide credit bureaus are available, weekly. A report is not a score.',
            'consumerfinance.gov, from the Consumer Financial Protection Bureau, explains how credit reports and scores work.'
          ])
        );
      }
    }
  });
})();
