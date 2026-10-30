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

  /* Growth multiple and the percent beside "Compounding adds". Both are plain ratios
   * for the labels. Anything that is not a real, finite number, or a base of zero or
   * less, gives null (and "" as text), so no label ever shows NaN or Infinity. */
  var WHOLE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function cents(v) { return Math.round(v * 100); }

  /* num / den, rounded half up to one decimal, as a whole number of tenths. Both are
   * whole numbers: the division of floats is never rounded a second time (a ratio that
   * is exactly x.x5 in dollars sits a hair below it in binary, such as 3249.9999999999995). */
  function tenths(num, den) {
    var n = 20 * num + den, d = 2 * den;       // floor(10 * num / den + 1/2)
    var q = Math.floor(n / d);
    if (q * d > n) q--; else if ((q + 1) * d <= n) q++;   // settle a float division that landed on the wrong side
    return q;
  }

  /* 31 -> "3.1": tenths as text, with a thousands separator, "." and one decimal. */
  function tenthsText(t) { return WHOLE.format(Math.floor(t / 10)) + "." + (t % 10); }

  /* ending balance / total put in (the starting amount plus every contribution), from
   * whole cents so a figure like $3,250.00 is exactly 3250. */
  function growthMultiple(ending, putIn) {
    if (!isNum(ending) || !isNum(putIn) || ending < 0) return null;
    var e = cents(ending), p = cents(putIn);
    if (!(p > 0)) return null;
    var m = e / p;
    return isFinite(m) ? m : null;
  }

  /* A multiple of 100,000x or more, or a percent of 100,000% or more, only comes from
   * extreme inputs (such as 50% a year for decades). As a label it would be a wall
   * of digits that squeezes the chart for no use, so the text is left out then. */
  var TEXT_CAP = 100000;

  /* "2.3×" (the multiplication sign, U+00D7, no space), or "" when there is no multiple (or it is past TEXT_CAP). */
  function multipleText(ending, putIn) {
    if (growthMultiple(ending, putIn) === null) return "";
    var t = tenths(cents(ending), cents(putIn));
    return t >= TEXT_CAP * 10 ? "" : tenthsText(t) + "×";   // the cap is checked after rounding
  }

  /* What compounding adds, as a percent of simple interest's ending balance. */
  function addsPercent(extra, simpleFinal) {
    if (!isNum(extra) || !isNum(simpleFinal) || extra < 0) return null;
    var x = cents(extra), s = cents(simpleFinal);
    if (!(s > 0)) return null;
    var p = x * 100 / s;
    return isFinite(p) ? p : null;
  }

  /* "+36.5%", or "" when there is no percent, it rounds to 0.0% (nothing to say
   * beyond the dollar figure beside it), or it is past TEXT_CAP (after rounding). */
  function addsPercentText(extra, simpleFinal) {
    if (addsPercent(extra, simpleFinal) === null) return "";
    var t = tenths(cents(extra) * 100, cents(simpleFinal));
    return t === 0 || t >= TEXT_CAP * 10 ? "" : "+" + tenthsText(t) + "%";
  }

  var api = {
    FREQUENCIES: FREQUENCIES,
    LIMITS: LIMITS,
    EXACT_TO_CENTS_BELOW: EXACT_TO_CENTS_BELOW,
    monthlyRate: monthlyRate,
    calculate: calculate,
    validate: validate,
    parseAmount: parseAmount,
    TEXT_CAP: TEXT_CAP,
    growthMultiple: growthMultiple,
    multipleText: multipleText,
    addsPercent: addsPercent,
    addsPercentText: addsPercentText
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CompoundCalc = api;
})(typeof self !== "undefined" ? self : this);
