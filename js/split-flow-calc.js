/* split-flow-calc.js: the numbers for "What if the example split changed?".
 * Pure: no DOM, no storage, no network. Every figure is an example.
 * The example $4,000 paycheck: spending stays at the example $2,400, the amount
 * saved is the reader's slider (example amounts only, $0 to $1,600 in $50 steps),
 * and checking is what is left. The saving grows at an example 5% a year,
 * compounded monthly, deposits at the end of each month, the same rule as
 * money-flow-calc.js (at $1,150 the two agree exactly).
 * Tests: tests/split-flow-calc-test.js. */
(function (root) {
  'use strict';

  var PAYCHECK = 4000, SPENDING = 2400;
  var MIN = 0, MAX = 1600, STEP = 50, EXAMPLE = 1150;
  var ANNUAL_RATE = 0.05, YEARS = 10, MONTHS = YEARS * 12;

  // A saved amount brought into the slider's range.
  function clampSaved(s) {
    var n = Number(s);
    if (!isFinite(n)) return EXAMPLE;
    return Math.min(MAX, Math.max(MIN, n));
  }

  // The month's split. Spending is fixed; checking is what is left.
  function split(saved) {
    var s = clampSaved(saved);
    return { paycheck: PAYCHECK, spending: SPENDING, saved: s, checking: PAYCHECK - SPENDING - s };
  }

  // Balance after each month, 0 to months: deposits at the end of each month.
  // { saved, months, series, end, put, interest }
  function growth(saved, months) {
    var s = clampSaved(saved), n = months === undefined ? MONTHS : months;
    var r = ANNUAL_RATE / 12, out = [0], b = 0, m;
    for (m = 1; m <= n; m++) { b = b * (1 + r) + s; out.push(b); }
    var end = out[out.length - 1], put = s * n;
    return { saved: s, months: n, series: out, end: end, put: put, interest: end - put };
  }

  // The 10 year figures the card shows for one slider position.
  function figures(saved) {
    var g = growth(saved, MONTHS);
    return { saved: g.saved, put: g.put, end: g.end, interest: g.interest, series: g.series };
  }

  // The chart's fixed top: the 10 year balance at the top of the slider, rounded up to $50,000.
  var AXIS_TOP = Math.ceil(figures(MAX).end / 50000) * 50000;

  var api = {
    AXIS_TOP: AXIS_TOP,
    PAYCHECK: PAYCHECK, SPENDING: SPENDING, MIN: MIN, MAX: MAX, STEP: STEP, EXAMPLE: EXAMPLE,
    ANNUAL_RATE: ANNUAL_RATE, YEARS: YEARS, MONTHS: MONTHS,
    clampSaved: clampSaved, split: split, growth: growth, figures: figures
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SplitFlowCalc = api;
})(typeof window !== 'undefined' ? window : this);
