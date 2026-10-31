/* Stepwell Financial: the list of screens.
   To build a screen:
     1. add js/screens/<file>.js, which calls SW.screens.register('<file>', {...});
     2. if it needs styles, add css/screens/<file>.css and set css: true;
     3. ask the foundation owner to add both files to index.html (nothing is
        loaded at run time), and set ready: true on its line below.
   A route also answers its sub-paths: #/onboarding/2 opens "onboarding"
   with ctx.sub = '2'.
   Each entry is one line on purpose, so parallel work rarely conflicts.
   mode: where the screen's numbers are kept (the data band).
   nav: which navigation group shows it. tab: its bottom-tab name on phones.
   flag: the launch switch in js/boot.js (SW.flags) the route needs. A route
   whose flag is off is dropped from this list before anything reads it, so it
   has no navigation entry, no route and no link. */
(function () {
  'use strict';
  var SW = window.SW = window.SW || {};

  var ALL = [
    { path: 'overview', file: 'overview', ready: true, css: true, ref: 'A2', title: 'Overview', nav: 'main', icon: 'home', tab: 'Home', phase: '1', mode: 'device', purpose: 'Net worth at a glance: what changed, the monthly picture, accounts, and recent activity.' },
    { path: 'accounts', file: 'accounts', ready: true, css: true, ref: 'A2', title: 'Accounts', nav: 'main', icon: 'wallet', phase: '1', mode: 'device', purpose: 'Every account grouped by type, with its balance history and where each number came from.' },
    { path: 'transactions', file: 'transactions', ready: true, css: true, ref: 'A4', title: 'Transactions', nav: 'main', icon: 'list', tab: 'Activity', phase: '1', mode: 'device', purpose: 'Every line you enter or import, with categories, rules and splits, and explain-this-line for the bank’s cryptic text.' },
    { path: 'cash-flow', file: 'cash-flow', ready: true, css: true, ref: 'A5', title: 'Cash flow', nav: 'main', icon: 'flow', phase: '1', mode: 'device', purpose: 'Where the month’s money came in and went out, with a hide-amounts view for sharing.' },
    { path: 'budget', file: 'budget', ready: true, css: true, ref: 'A6', title: 'Budget', nav: 'main', icon: 'budget', tab: 'Budget', phase: '1', mode: 'device', purpose: 'A flexible monthly budget, the month at a glance, and what is not yet given a job.' },
    { path: 'bills', file: 'bills', ready: true, css: true, ref: 'A7', title: 'Bills', nav: 'main', icon: 'cal', phase: '1', mode: 'device', purpose: 'A calendar of bills coming up, and a fee x-ray of the fees paid in the last 12 months.' },
    { path: 'goals', file: 'goals', ready: true, css: true, ref: 'A8', title: 'Goals', nav: 'main', icon: 'goal', phase: '1', mode: 'device', purpose: 'Goals, sinking funds and an emergency fund meter, described in months of your own spending.' },
    { path: 'what-if', file: 'what-if', ready: true, css: true, ref: 'A9', title: 'What if', nav: 'main', icon: 'whatif', phase: '1', mode: 'device', purpose: 'The planner you drive: change the inputs and see an illustration at an example rate.' },
    { path: 'calculators', file: 'calculators', ready: true, css: true, ref: 'F2', title: 'Calculators', nav: 'main', icon: 'grid', phase: '1', mode: 'none', purpose: 'Calculators that run in your browser and keep nothing: compound interest, and loan amortization with a payment table. Each has a chart and a table.' },
    { path: 'learn', file: 'learn', ready: true, css: true, ref: 'A10', title: 'Learn', nav: 'learn', icon: 'learn', tab: 'Learn', phase: '1', mode: 'device', purpose: 'The lesson pathway, plus lessons your own data points to, opened only if you choose.' },
    { path: 'how-it-fits', file: 'how-it-fits', ready: true, css: true, ref: '', title: 'How it fits together', nav: 'learn', icon: 'growth', phase: '1', mode: 'none', purpose: 'One example month of money, shown piece by piece, with an example savings growth chart. Every figure is an example; nothing here reads your numbers.' },
    { path: 'settings', file: 'settings', ready: true, css: true, ref: 'A11', title: 'Settings and data', nav: 'you', icon: 'gear', phase: '1', mode: 'device', purpose: 'Where your numbers live, export and delete, and look and feel.' },
    { path: 'plans', file: 'plans', ready: true, css: true, ref: 'A12', title: 'Plans', nav: 'you', icon: 'plans', phase: '1', mode: 'device', purpose: 'The free plan: what it holds and its limits.' },
    { path: 'onboarding', file: 'onboarding', ready: true, css: true, ref: 'A1, A3', title: 'Getting started', nav: 'start', icon: 'door', phase: '1', mode: 'device', purpose: 'Four short screens: what the app does, where your numbers are kept, a first account, and what to learn. Plus the empty, loading and error states.' },
    { path: 'welcome', file: 'welcome', ready: true, css: true, ref: 'F1', title: 'Welcome', nav: 'start', icon: 'door', phase: '1', mode: 'none', purpose: 'The front door: what the platform is, a sample net worth chart, and the line between the free tools and the app.' },
    { path: 'linked', file: 'linked', flag: 'linked', ready: true, css: true, ref: 'B1, B2', title: 'Linked accounts', nav: 'start', icon: 'link', phase: '2', mode: 'linked', purpose: 'Linking a bank, and linked, manual and device-only accounts side by side, with sync errors in plain words.' },
    { path: 'later/ask', file: 'later-ask', flag: 'aiChat', ready: true, css: true, ref: 'L1', title: 'Ask your money', nav: 'later', icon: 'later', phase: 'later', mode: 'device', purpose: 'Ask about your own numbers; each answer shows the data it used.' },
    { path: 'later/week', file: 'later-week', flag: 'later', ready: true, css: true, ref: 'L2', title: 'Your week in money', nav: 'later', icon: 'later', phase: 'later', mode: 'device', purpose: 'A short, plain summary of your week, with no praise or blame.' },
    { path: 'later/ahead', file: 'later-ahead', flag: 'later', ready: true, css: true, ref: 'L3', title: 'Cash flow ahead', nav: 'later', icon: 'later', phase: 'later', mode: 'device', purpose: 'An illustration of your checking balance until next payday, with every input listed.' },
    { path: 'later/future', file: 'later-future', flag: 'later', ready: true, css: true, ref: 'L4', title: 'Future you', nav: 'later', icon: 'later', phase: 'later', mode: 'device', purpose: 'An illustration of a balance in 20 years at example rates.' },
    { path: 'screens', file: 'screens-index', flag: 'prototypeBuild', ready: true, css: true, ref: '', title: 'Screens', nav: 'start', icon: 'grid', phase: 'tool', mode: 'none', purpose: 'Every screen and state in this prototype, for reviewers.' }
  ];

  SW.routes = ALL.filter(function (r) { return !r.flag || (SW.flags && SW.flags[r.flag] === true); });
})();
