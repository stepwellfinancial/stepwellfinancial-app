/* month-flow-calc.js: the numbers behind "The month, day by day".
 * Pure: no DOM, no storage, no network. Every figure is an example.
 * The same example month as the "How it fits together" graphic (money-flow-calc.js):
 * a $4,000 paycheck lands in checking on day 1, and each piece moves out on its own
 * day. Items are keyed by the ids in MoneyFlowCalc's NODES (rent, bills, food, loans,
 * check, sav, hsa, roth, k401). Checking is what is left: it ends the month at $450.
 * Tests: tests/month-flow-calc-test.js. */
(function (root) {
  'use strict';

  var DAYS = 30;          // the example month
  var PAY_DAY = 1;        // the example paycheck lands in checking on this day
  var PAYCHECK = 4000;

  // Each item leaves checking on its days, the amount each time.
  var SCHEDULE = [
    { id: 'rent', label: 'Rent', amt: 1200, days: [1] },
    { id: 'sav', label: 'Savings', amt: 350, days: [2] },
    { id: 'hsa', label: 'HSA', amt: 150, days: [2] },
    { id: 'roth', label: 'Roth', amt: 250, days: [2] },
    { id: 'k401', label: '401(k)', amt: 400, days: [2] },
    { id: 'bills', label: 'Bills', amt: 400, days: [3] },
    { id: 'food', label: 'Groceries', amt: 125, days: [7, 14, 21, 28] },
    { id: 'loans', label: 'Loans', amt: 300, days: [15] }
  ];

  // A whole day from 1 to DAYS; anything else is brought into range.
  function clampDay(d) {
    var n = Math.round(Number(d));
    if (!isFinite(n)) return 1;
    return Math.min(DAYS, Math.max(1, n));
  }

  // What one item has moved out of checking by the end of a day.
  function movedBy(item, day) {
    return item.days.filter(function (x) { return x <= day; }).length * item.amt;
  }

  // The checking balance after that day's moves.
  function balanceOn(day) {
    var d = clampDay(day);
    return SCHEDULE.reduce(function (b, it) { return b - movedBy(it, d); }, PAYCHECK);
  }

  // Per id, the amount so far. Checking is its balance.
  function filledOn(day) {
    var d = clampDay(day), out = {};
    SCHEDULE.forEach(function (it) { out[it.id] = movedBy(it, d); });
    out.check = balanceOn(d);
    return out;
  }

  // The payments on that day, in schedule order: [{ id, label, amt }].
  function eventsOn(day) {
    var d = clampDay(day);
    return SCHEDULE.filter(function (it) { return it.days.indexOf(d) >= 0; })
      .map(function (it) { return { id: it.id, label: it.label, amt: it.amt }; });
  }

  // The month's total per id (checking: where it ends).
  var TOTALS = filledOn(DAYS);

  var api = {
    DAYS: DAYS, PAY_DAY: PAY_DAY, PAYCHECK: PAYCHECK, SCHEDULE: SCHEDULE, TOTALS: TOTALS,
    clampDay: clampDay, balanceOn: balanceOn, filledOn: filledOn, eventsOn: eventsOn
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MonthFlowCalc = api;
})(typeof window !== 'undefined' ? window : this);
