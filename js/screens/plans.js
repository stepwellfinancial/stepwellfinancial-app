/* Plans: the free plan only. No paid plan is shown until a price is set,
   and nothing in the app is held back for one. The plan lists what it holds
   and its limits, in the present tense. No badges, countdowns or flags.
   The outline is ink: no plan can be chosen here, so it is not a control's
   state (brand 1.2.0, A-I4). */
(function () {
  'use strict';
  var SW = window.SW;
  if (!SW || !SW.screens) return;

  var HOLDS = [
    'Every screen in this app: accounts, transactions, cash flow, budget, bills, goals, What if and Learn.',
    'Import from a file, export, backup and restore.',
    'The optional passphrase lock.'
  ];
  var LIMITS = [
    'Your numbers are kept only on this device. Nothing is synced to another device.',
    'If you clear this browser’s data, or lose the device, the numbers are gone unless you saved a backup.',
    'No sign-in, no household view and no linked bank accounts.'
  ];

  SW.screens.register('plans', {
    render: function (wrap, ctx) {
      var h = ctx.dom.h;
      wrap.appendChild(ctx.app.screenHeader(ctx.route, { eyebrow: 'You' }));
      wrap.appendChild(h('section', { class: 'card pl-card pl-free', 'aria-labelledby': 'pl-free-h' }, [
        h('h2', { id: 'pl-free-h', text: 'Free' }),
        h('p', { class: 'pl-price', text: '$0' }),
        h('h3', { class: 'pl-sub', text: 'What it holds' }),
        h('ul', { class: 'pl-list' }, HOLDS.map(function (t) { return h('li', { text: t }); })),
        h('h3', { class: 'pl-sub', text: 'Limits' }),
        h('ul', { class: 'pl-list' }, LIMITS.map(function (t) { return h('li', { text: t }); }))
      ]));
      wrap.appendChild(h('section', { class: 'card pl-both', 'aria-label': 'Ads and affiliate links' }, [
        h('p', { class: 'pl-p', text: 'If we ever show ads or use affiliate links, we’ll label them clearly.' })
      ]));
      return null;
    }
  });
})();
