/* calc-site.js: compound interest maths. Pure functions, no DOM, so QA can test them alone.
 *
 * This is the calculator website's calc.js, function for function and line for line
 * (only this comment differs), so the app shows the same figures as the website.
 * Do not change the maths here without changing it on the website first.
 *
 * Each year end is computed in closed form. Annual, quarterly and monthly
 * compounding use the period convention: inside a period, money earns simple
 * interest at r/12 a month, credited at the period's end. Daily compounding uses
 * the exact equivalent monthly rate.
 */
(function (root) {
  "use strict";

  var FREQUENCIES = { annually: 1, quarterly: 4, monthly: 12, daily: 365 };

  var LIMITS = {
    principal: { min: 0, max: 100000000, label: "Initial deposit" },
    monthly: { min: 0, max: 1000000, label: "Monthly contribution" },
    ratePct: { min: 0, max: 50, label: "Interest rate" },
    years: { min: 1, max: 100, label: "Years", integer: true }
  };

  function monthlyRate(ratePct, frequency) {
    var n = FREQUENCIES[frequency];
    var r = ratePct / 100;
    if (r === 0) return 0;
    return Math.expm1((n / 12) * Math.log1p(r / n));
  }

  // Above this, a JavaScript number cannot hold every cent, so the page says so.
  var EXACT_TO_CENTS_BELOW = 1e12;

  /* inputs: {principal, monthly, ratePct, years, frequency, timing: "end"|"start"}
   *
   * Alongside the compound balance it tracks the same deposits under simple
   * interest: every dollar earns r a year (r/12 a month) on itself only, never on
   * interest already earned, so the gap between the two is what compounding adds.
   * Compounding frequency does not apply to simple interest.
   */
  function calculate(inputs) {
    var i = monthlyRate(inputs.ratePct, inputs.frequency);
    var rm = inputs.ratePct / 100 / 12;   // simple interest per month
    var start = inputs.timing === "start";
    var P = inputs.principal, M = inputs.monthly;
    var yearly = [];

    /* Each year end is computed in closed form rather than by adding up month
     * after month, so rounding error never accumulates, even over 1,200 months. */
    // log of the monthly growth factor, via log1p and expm1, which keep full
    // precision where "(1 + tiny) - 1" would throw digits away.
    var n = FREQUENCIES[inputs.frequency];
    var logMonthly = inputs.ratePct === 0 ? 0 : (n / 12) * Math.log1p(inputs.ratePct / 100 / n);
    i = Math.expm1(logMonthly);
    /* Annual, quarterly and monthly compounding follow the bank convention:
     * inside a compounding period, money earns simple interest at r/12 a month,
     * and that interest is credited, and starts compounding, at the period's end.
     * So compound is never below simple, even for money held part of a period.
     * One period's deposits are worth Dp at its end; then
     *   balance after k periods = P(1+R)^k + Dp((1+R)^k - 1)/R,  R = r/n.
     * Daily compounding is finer than the monthly deposits, so there the exact
     * equivalent monthly rate is used instead (it never pays less than r/12). */
    var periodMonths = 12 / n;
    var R = inputs.ratePct / 100 / n;
    var periodic = n <= 12;
    var heldInPeriod = start ? periodMonths * (periodMonths + 1) / 2 : periodMonths * (periodMonths - 1) / 2;
    var Dp = M * periodMonths + M * rm * heldInPeriod;
    var logPeriod = R === 0 ? 0 : Math.log1p(R);

    function compoundAt(m) {
      if (periodic) {
        var k = m / periodMonths;                                   // whole periods at a year end
        var annuityP = R === 0 ? k : Math.expm1(k * logPeriod) / R;
        return P * Math.exp(k * logPeriod) + Dp * annuityP;
      }
      var growth = Math.exp(m * logMonthly);
      var annuity = i === 0 ? m : Math.expm1(m * logMonthly) / i;  // sum of (1+i)^k, k = 0..m-1
      return P * growth + M * annuity * (start ? 1 + i : 1);
    }

    function at(m) {
      var balance = compoundAt(m);
      var contributions = P + M * m;
      // A deposit made in month k is held for m-k+1 months (start) or m-k (end).
      var heldMonths = start ? m * (m + 1) / 2 : m * (m - 1) / 2;
      var simpleInterest = P * rm * m + M * rm * heldMonths;
      return {
        year: m / 12,
        balance: balance,
        contributions: contributions,
        interest: balance - contributions,
        simpleBalance: contributions + simpleInterest,
        simpleInterest: simpleInterest
      };
    }

    for (var y = 1; y <= inputs.years; y++) yearly.push(at(y * 12));
    var last = yearly[yearly.length - 1];
    return {
      final: last.balance,
      contributions: last.contributions,
      interest: last.interest,
      simpleFinal: last.simpleBalance,
      // Never below zero: where compound and simple are equal, the two formulas
      // can differ by a few billionths of a cent, which would print as "-$0.00".
      compoundingAdds: Math.max(0, last.balance - last.simpleBalance),
      simpleInterest: last.simpleInterest,
      yearly: yearly
    };
  }

  /* Returns {field: message} for every invalid field. Empty object means valid. */
  function validate(raw) {
    var errors = {};
    Object.keys(LIMITS).forEach(function (key) {
      var lim = LIMITS[key];
      var v = raw[key];
      if (v === null || v === undefined || v === "" || typeof v !== "number" || !isFinite(v)) {
        errors[key] = "Enter a number.";
      } else if (v < lim.min) {
        errors[key] = lim.label + " can't be below " + lim.min.toLocaleString("en-US") + ".";
      } else if (v > lim.max) {
        errors[key] = lim.label + " can't be above " + lim.max.toLocaleString("en-US") + ".";
      } else if (lim.integer && Math.floor(v) !== v) {
        errors[key] = "Use whole years.";
      } else if (key === "ratePct" && Math.abs(v * 100 - Math.round(v * 100)) > 1e-9) {
        errors[key] = "Use at most 2 decimal places.";
      }
    });
    if (!Object.prototype.hasOwnProperty.call(FREQUENCIES, raw.frequency)) errors.frequency = "Choose how often interest compounds.";
    if (raw.timing !== "start" && raw.timing !== "end") errors.timing = "Choose when you contribute.";
    return errors;
  }

  /* "12,500.50" or "$12,500" -> 12500.5; "10." -> 10; anything unreadable -> NaN.
   * With allowCommas false (the rate), a comma is refused rather than dropped, so
   * "1,5" is never silently read as 15. */
  function parseAmount(text, allowCommas) {
    var s = String(text == null ? "" : text);
    if (allowCommas === false && s.indexOf(",") !== -1) return NaN;
    var bare = s.replace(/[$%\s]/g, "");
    if (bare.indexOf(",") !== -1 && !/^-?\d{1,3}(,\d{3})+(\.\d*)?$/.test(bare)) return NaN;
    var cleaned = bare.replace(/,/g, "");
    if (cleaned === "") return NaN;
    return /^-?(\d+\.?\d*|\.\d+)$/.test(cleaned) ? Number(cleaned) : NaN;
  }

  var api = {
    FREQUENCIES: FREQUENCIES,
    LIMITS: LIMITS,
    EXACT_TO_CENTS_BELOW: EXACT_TO_CENTS_BELOW,
    monthlyRate: monthlyRate,
    calculate: calculate,
    validate: validate,
    parseAmount: parseAmount
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CompoundCalc = api;
})(typeof self !== "undefined" ? self : this);
