/* money-flow-calc.js: the numbers behind the "How it fits together" graphic.
 * Pure: no DOM, no window, no storage, no network. Every figure is an example.
 * The same file, byte for byte, ships on stepwellfinancial.com and in the app
 * (see money-flow.sha256). Tests: tests/money-flow-calc-test.js in each repository.
 *
 * The example month: a $4,000 paycheck split into nine pieces. The four saving
 * pieces add up to $1,150 a month, which the growth card puts in at the end of
 * each month, at an example 5% a year, compounded monthly. */
(function (root) {
  'use strict';

  // k: "spend" (gold balls), "bank" (gray) or "save" (green). t: the caption.
  var NODES = [
    { id: 'rent', label: 'Rent', amt: 1200, k: 'spend', t: 'A fixed monthly cost. Rent is the largest piece of many months, which is why it shapes everything else.' },
    { id: 'bills', label: 'Bills', amt: 400, k: 'spend', t: 'Utilities, phone and insurance. Regular, due on set dates, and easy to forget until a late fee shows up.' },
    { id: 'food', label: 'Groceries', amt: 500, k: 'spend', t: 'Food at home. A flexible cost: it moves up and down more than rent or bills.' },
    { id: 'loans', label: 'Loans', amt: 300, k: 'spend', t: 'Payments on money you borrowed. Each payment covers interest plus some of what you owe.' },
    { id: 'check', label: 'Checking', amt: 450, k: 'bank', t: 'Left in checking: the part of the month not sent anywhere else. Money waits here until it is spent or moved.' },
    { id: 'sav', label: 'Savings', amt: 350, k: 'save', t: 'A bank savings account for goals and surprises. Easy to reach, and it adds up with each deposit.' },
    { id: 'hsa', label: 'HSA', amt: 150, k: 'save', t: 'A health savings account, for health costs. Account rules and limits differ and change.' },
    { id: 'roth', label: 'Roth', amt: 250, k: 'save', t: 'A retirement account with its own tax rules. Rules and limits differ and change.' },
    { id: 'k401', label: '401(k)', amt: 400, k: 'save', t: 'A retirement account through an employer. Rules and limits differ and change.' }
  ];

  var PAYCHECK = 4000;          // the example paycheck
  var ANNUAL_RATE = 0.05;       // example 5% a year, compounded monthly
  var HORIZONS = [1, 5, 10, 20]; // years the growth card offers
  var DEFAULT_YEARS = 10;

  var MONTHLY_SAVE = NODES.filter(function (n) { return n.k === 'save'; })
    .reduce(function (s, n) { return s + n.amt; }, 0); // 1150

  function sumOfPieces() { return NODES.reduce(function (s, n) { return s + n.amt; }, 0); } // 4000

  var whole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  var cents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

  // $1,200 (whole dollars, as the browser rounds them)
  function money(n) { return whole.format(n); }
  // $1,234.56: to the cent, rounded half up
  function money2(n) { return cents.format(Math.floor(n * 100 + 0.5) / 100); }

  // Balance after each month, 0 to years*12, deposits at the end of each month.
  function series(years) {
    var r = ANNUAL_RATE / 12, out = [0], b = 0;
    for (var m = 1; m <= years * 12; m++) { b = b * (1 + r) + MONTHLY_SAVE; out.push(b); }
    return out;
  }

  // The growth card's figures for one horizon.
  function growth(years) {
    var s = series(years), end = s[s.length - 1], put = MONTHLY_SAVE * years * 12;
    return { years: years, series: s, end: end, put: put, interest: end - put };
  }

  // How many balls ride a path: one for about every $110, never fewer than two.
  function ballCount(amt) { return Math.max(2, Math.round(amt / 110)); }

  var api = {
    NODES: NODES, PAYCHECK: PAYCHECK, ANNUAL_RATE: ANNUAL_RATE, HORIZONS: HORIZONS, DEFAULT_YEARS: DEFAULT_YEARS,
    MONTHLY_SAVE: MONTHLY_SAVE, sumOfPieces: sumOfPieces, money: money, money2: money2,
    series: series, growth: growth, ballCount: ballCount
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoneyFlowCalc = api;
})(typeof window !== 'undefined' ? window : this);
