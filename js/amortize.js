/* Loan amortization: the pure maths (no DOM, no storage, no network).
   One global, Amortize, so the test page can run it alone.

   Method (monthly, end of month, all money in whole cents):
   - A is the amount in cents, n = years x 12, R is the yearly rate in thousandths
     of a percent as a whole number (6.5% = 6500), so the monthly rate is R / 1,200,000.
   - Payment p = A x r / (1 - (1 + r)^-n), rounded half up to the cent. At 0% it is
     A / n in integer cents (no floating point). The one floating point step is the
     power in the payment formula, worked with log1p and expm1 so it stays exact
     to many more digits than the cent needs.
   - Each month: interest = balance x R / 1,200,000 in integer arithmetic, rounded
     half up to the cent. Repaid = payment - interest. Balance = balance + interest - payment.
   - A payment is the last if it is payment n, or if balance + interest is not more
     than p. The last payment is balance + interest, so the balance after it is
     exactly 0. The schedule never has more than n rows.
   - If the rounded payment is not above the first month's interest, there is no
     schedule: the balance would not fall.

   Extra principal (release 2), same method, same cents, same half up:
   - Each month: interest first, then the regular payment p, then any extra amount,
     which goes wholly to the balance. A month is the last if it is month n or if
     balance + interest is not more than p + that month's extra; the last payment is
     balance + interest. The guard is the plain one: no schedule exists, so none of
     the extra schedules exist either (decided on the plain payment).
   - With an extra of 0 the rows equal the plain schedule's rows, field for field.
   - Round up: the plain payment rounded UP to a step of $500 or $1,000 (4,200 -> 4,500
     at 500 and 5,000 at 1,000; a payment already on a step is unchanged). The
     schedule then runs at the rounded payment: the amount above p is the monthly extra.
   - One extra payment a year, the one timing used everywhere (the spec says the same):
     one additional payment equal to the plain payment p, made at the end of month 12
     with that month's regular payment, and again in months 24, 36, and so on (every
     month whose number is a multiple of 12). It is applied after that month's interest,
     wholly to the balance, so month 12 takes 2 x p in total. The first one comes after
     twelve ordinary payments, never earlier, and a term of 1 year has none that changes
     anything, because month 12 is its last payment.
   - Saved figures compare with the plain schedule at the same amount, rate and term:
     interest saved = plain total interest - total interest; months saved = plain
     months - months. */
(function (root) {
  'use strict';

  var MIN_CENTS = 10000, MAX_CENTS = 1000000000;   // $100.00 to $10,000,000.00
  var MAX_RATE = 30000;                              // 30%
  var MIN_YEARS = 1, MAX_YEARS = 40;
  var RATE_DIV = 1200000;                            // thousandths of a percent, per month

  // Messages, word for word as the spec gives them.
  var MSG = {
    amountEmpty: 'Enter a loan amount.',
    amountText: 'Use numbers only, for example 25,000 or 25,000.50.',
    amountRange: 'Enter an amount from $100 to $10,000,000.',
    rateEmpty: 'Enter a yearly interest rate.',
    rateText: 'Use numbers only, for example 6.5.',
    rateRange: 'Enter a rate from 0% to 30%.',
    termEmpty: 'Enter a term in years.',
    termText: 'Use a whole number of years, for example 5.',
    termRange: 'Enter a term from 1 to 40 years.',
    guard: 'At this rate and term, the monthly payment would only cover the interest, so the balance would not fall. A shorter term or a lower rate would give a schedule.'
  };
  function decimalsMsg(count, most) { return 'This has ' + count + ' decimal places. Use ' + most + ' at most.'; }

  // Integer division rounded half up, for whole numbers n >= 0 and d > 0.
  function divRound(n, d) {
    var twice = 2 * n + d;
    return (twice - (twice % (2 * d))) / (2 * d);
  }

  // ---------- Reading what was typed ----------
  // Each returns { ok: true, cents | milli | years } or { ok: false, message }.
  // Check order: empty, not a number, decimal places, range.
  // What a person types or pastes, with every space taken out first (ordinary spaces,
  // non-breaking and thin spaces, tabs, line breaks, zero width marks), so "  250 000 "
  // reads as 250000. The rules after that run on the squashed text.
  function squash(text) {
    return String(text === undefined || text === null ? '' : text).replace(/[\s​-‍⁠]+/g, '');
  }

  // Amount rules: an optional minus (refused later, as out of range), an optional leading
  // "$", digits with an optional ".", then up to 2 decimal places. Commas are accepted
  // only as thousands separators in the right places: 1 to 3 digits, then groups of
  // exactly 3 ("250,000" and "1,250,000.5" are fine; "25,00", "2,5000" and "0,500" are
  // not numbers). A comma is never read as a decimal point. No "$" after the digits, no
  // letters ("12k", "USD"), no second dot. More than 2 decimals gets the decimals
  // message with the real count, even if the extra digits are zeros ("5.000").
  function parseAmount(text) {
    var t = squash(text);
    if (!t) return { ok: false, message: MSG.amountEmpty };
    var m = /^(-)?(\$)?(-)?(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d*))?$/.exec(t);
    var whole = m ? m[4].replace(/,/g, '') : '', frac = m && m[5] ? m[5] : '';
    if (!m || (!whole && !frac) || (m[4].indexOf(',') >= 0 && m[4].charAt(0) === '0')) return { ok: false, message: MSG.amountText };
    if (frac.length > 2) return { ok: false, message: decimalsMsg(frac.length, 2) };
    whole = whole.replace(/^0+(?=\d)/, '');
    if (m[1] || m[3] || whole.length > 10) return { ok: false, message: MSG.amountRange };
    var cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
    if (cents < MIN_CENTS || cents > MAX_CENTS) return { ok: false, message: MSG.amountRange };
    return { ok: true, cents: cents };
  }

  // Rate rules: spaces anywhere are ignored, an optional single "%" at the end, digits
  // with an optional ".", up to 3 decimal places ("6.5", "6.5%", " 6.5 ", "6.5 %").
  // A comma is not accepted (not read as a decimal point either).
  function parseRate(text) {
    var t = squash(text);
    if (!t) return { ok: false, message: MSG.rateEmpty };
    var m = /^(-)?(\d*)(?:\.(\d*))?%?$/.exec(t);
    var whole = m ? m[2] : '', frac = m && m[3] ? m[3] : '';
    if (!m || (!whole && !frac)) return { ok: false, message: MSG.rateText };
    if (frac.length > 3) return { ok: false, message: decimalsMsg(frac.length, 3) };
    whole = whole.replace(/^0+(?=\d)/, '');
    if (m[1] || whole.length > 3) return { ok: false, message: MSG.rateRange };
    var milli = Number(whole || '0') * 1000 + Number((frac + '000').slice(0, 3));
    if (milli > MAX_RATE) return { ok: false, message: MSG.rateRange };
    return { ok: true, milli: milli };
  }

  // Term rules: a whole number of years, spaces ignored, optionally followed by the word
  // "year", "years", "yr" or "yrs" in any case ("30", " 30 ", "30 years", "1 year"). A
  // whole number written with only zeros after the point ("30.0") is accepted as 30;
  // "2.5" is not a whole number.
  function parseTerm(text) {
    var t = squash(text);
    if (!t) return { ok: false, message: MSG.termEmpty };
    var m = /^(-?)(\d+)(?:\.0*)?(?:years?|yrs?)?$/i.exec(t);
    if (!m) return { ok: false, message: MSG.termText };
    var digits = m[2].replace(/^0+(?=\d)/, '');
    if (m[1] || digits.length > 3) return { ok: false, message: MSG.termRange };
    var years = Number(digits);
    if (years < MIN_YEARS || years > MAX_YEARS) return { ok: false, message: MSG.termRange };
    return { ok: true, years: years };
  }

  // ---------- The schedule ----------
  function interestFor(balance, rateMilli) { return divRound(balance * rateMilli, RATE_DIV); }

  function paymentFor(cents, rateMilli, n) {
    if (rateMilli === 0) return divRound(cents, n);
    var r = rateMilli / RATE_DIV;
    var exact = cents * r / -Math.expm1(-n * Math.log1p(r));
    return Math.floor(exact + 0.5);
  }

  // schedule(cents, rateMilli, years)
  //  -> { ok: true, n, payment, lastPayment, totalPaid, totalInterest,
  //       rows: [{ no, payment, interest, repaid, balance }],
  //       years: [{ year, paid, interest, repaid, balance }] }
  //  or { ok: false, guard: true, payment, firstInterest }
  function schedule(cents, rateMilli, years) {
    var n = years * 12;
    var p = paymentFor(cents, rateMilli, n);
    var first = interestFor(cents, rateMilli);
    if (p <= first) return { ok: false, guard: true, payment: p, firstInterest: first };
    var rows = [], balance = cents, totalInterest = 0, totalPaid = 0;
    for (var k = 1; k <= n; k++) {
      var interest = interestFor(balance, rateMilli);
      var due = balance + interest;
      var last = k === n || due <= p;
      var pay = last ? due : p;
      balance = due - pay;
      rows.push({ no: k, payment: pay, interest: interest, repaid: pay - interest, balance: balance });
      totalInterest += interest;
      totalPaid += pay;
      if (last) break;
    }
    var byYear = [];
    for (var i = 0; i < rows.length; i++) {
      var y = Math.floor(i / 12);
      if (!byYear[y]) byYear[y] = { year: y + 1, paid: 0, interest: 0, repaid: 0, balance: 0 };
      var row = rows[i], b = byYear[y];
      b.paid += row.payment; b.interest += row.interest; b.repaid += row.repaid; b.balance = row.balance;
    }
    return { ok: true, n: n, payment: p, lastPayment: rows[rows.length - 1].payment, totalPaid: totalPaid,
      totalInterest: totalInterest, rows: rows, years: byYear };
  }

  // ---------- Extra principal ----------
  var ROUND_STEPS = Object.freeze([500, 1000]);   // whole dollars

  function validExtra(x) { return typeof x === 'number' && isFinite(x) && x >= 0 && Math.floor(x) === x && x <= MAX_CENTS; }

  // scheduleExtra(cents, rateMilli, years, monthlyExtra, yearlyExtra)
  //  monthlyExtra: whole cents added to principal every month (default 0).
  //  yearlyExtra: whole cents added to principal in months 12, 24, 36 ... (default 0).
  //  Each month: interest, then the regular payment p, then the extra, which goes to the balance.
  //  -> { ok: true, n, payment: p, monthlyExtra, yearlyExtra, lastPayment, totalPaid, totalInterest,
  //       months, extraPaid,
  //       rows: [{ no, payment, extra, interest, repaid, balance }],
  //       years: [{ year, paid, extra, interest, repaid, balance }] }
  //  payment in a row is everything paid that month (regular + extra), so balance = balance before
  //  + interest - payment, as in the plain schedule. extra in a row is the part of the payment above
  //  what the plain rule would take from the same balance that month (p, or the whole amount due if
  //  that is the plain last payment), so it is 0 in every row when both extras are 0.
  //  or { ok: false, guard: true, payment, firstInterest } (the plain payment only covers interest)
  //  or { ok: false, badExtra: true } (an extra that is not a whole number of cents from 0 up).
  function scheduleExtra(cents, rateMilli, years, monthlyExtra, yearlyExtra) {
    monthlyExtra = monthlyExtra === undefined ? 0 : monthlyExtra;
    yearlyExtra = yearlyExtra === undefined ? 0 : yearlyExtra;
    if (!validExtra(monthlyExtra) || !validExtra(yearlyExtra)) return { ok: false, badExtra: true };
    var n = years * 12;
    var p = paymentFor(cents, rateMilli, n);
    var first = interestFor(cents, rateMilli);
    if (p <= first) return { ok: false, guard: true, payment: p, firstInterest: first };
    var rows = [], balance = cents, totalInterest = 0, totalPaid = 0, extraPaid = 0;
    for (var k = 1; k <= n; k++) {
      var interest = interestFor(balance, rateMilli);
      var due = balance + interest;
      var room = p + monthlyExtra + (k % 12 === 0 ? yearlyExtra : 0);
      var last = k === n || due <= room;
      var pay = last ? due : room;
      var plainPay = (k === n || due <= p) ? due : p;
      var extra = pay - plainPay;
      balance = due - pay;
      rows.push({ no: k, payment: pay, extra: extra, interest: interest, repaid: pay - interest, balance: balance });
      totalInterest += interest;
      totalPaid += pay;
      extraPaid += extra;
      if (last) break;
    }
    var byYear = [];
    for (var i = 0; i < rows.length; i++) {
      var y = Math.floor(i / 12);
      if (!byYear[y]) byYear[y] = { year: y + 1, paid: 0, extra: 0, interest: 0, repaid: 0, balance: 0 };
      var row = rows[i], b = byYear[y];
      b.paid += row.payment; b.extra += row.extra; b.interest += row.interest; b.repaid += row.repaid; b.balance = row.balance;
    }
    return { ok: true, n: n, payment: p, monthlyExtra: monthlyExtra, yearlyExtra: yearlyExtra,
      lastPayment: rows[rows.length - 1].payment, totalPaid: totalPaid, totalInterest: totalInterest,
      months: rows.length, extraPaid: extraPaid, rows: rows, years: byYear };
  }

  // roundUpPayment(paymentCents, stepDollars) -> the payment rounded UP to a multiple of the step,
  // in whole cents; a payment already on a step is unchanged. stepDollars is 500 or 1000, else null.
  function roundUpPayment(payment, stepDollars) {
    if (ROUND_STEPS.indexOf(stepDollars) < 0 || typeof payment !== 'number' || !(payment >= 0) || Math.floor(payment) !== payment) return null;
    var s = stepDollars * 100, r = payment % s;
    return r === 0 ? payment : payment + s - r;
  }

  // The comparison figures, against the plain schedule at the same amount, rate and term.
  function compared(plain, plan) {
    var plainMonths = plain.rows.length;
    return { plainMonths: plainMonths, months: plan.months, monthsSaved: plainMonths - plan.months,
      plainTotalInterest: plain.totalInterest, totalInterest: plan.totalInterest,
      interestSaved: plain.totalInterest - plan.totalInterest };
  }

  // roundUp(cents, rateMilli, years, stepDollars): the plain payment p rounded up to the step; the
  // schedule runs at the rounded payment, the amount above p being extra principal every month.
  //  -> { ok: true, step, payment: p, roundedPayment, extra, alreadyOnStep, plain, plan,
  //       plainMonths, months, monthsSaved, plainTotalInterest, totalInterest, interestSaved }
  //     (plain is schedule(), plan is scheduleExtra(..., extra))
  //  or { ok: false, badStep: true } or the guard result { ok: false, guard: true, ... }.
  function roundUp(cents, rateMilli, years, stepDollars) {
    if (ROUND_STEPS.indexOf(stepDollars) < 0) return { ok: false, badStep: true };
    var plain = schedule(cents, rateMilli, years);
    if (!plain.ok) return plain;
    var rounded = roundUpPayment(plain.payment, stepDollars), extra = rounded - plain.payment;
    var plan = scheduleExtra(cents, rateMilli, years, extra, 0);
    var out = { ok: true, step: stepDollars, payment: plain.payment, roundedPayment: rounded, extra: extra,
      alreadyOnStep: extra === 0, plain: plain, plan: plan };
    var c = compared(plain, plan);
    for (var key in c) out[key] = c[key];
    return out;
  }

  // extraYearly(cents, rateMilli, years): one extra payment a year, equal to the plain payment p,
  // in months 12, 24, 36 ... (the timing in the header comment).
  //  -> { ok: true, payment: p, extra: p, plain, plan, plainMonths, months, monthsSaved,
  //       plainTotalInterest, totalInterest, interestSaved }  or the guard result.
  function extraYearly(cents, rateMilli, years) {
    var plain = schedule(cents, rateMilli, years);
    if (!plain.ok) return plain;
    var plan = scheduleExtra(cents, rateMilli, years, 0, plain.payment);
    var out = { ok: true, payment: plain.payment, extra: plain.payment, plain: plain, plan: plan };
    var c = compared(plain, plan);
    for (var key in c) out[key] = c[key];
    return out;
  }

  // ---------- Text for figures (kept here so the tests can check it too) ----------
  // 123456 -> "$1,234.56"
  function money(cents) {
    var dollars = Math.floor(cents / 100), c = cents % 100;
    return '$' + String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + (c < 10 ? '0' : '') + c;
  }
  // 6500 -> "6.5", 6000 -> "6", 125 -> "0.125": the rate as typed, without trailing zeros
  function rateText(milli) {
    var whole = Math.floor(milli / 1000), frac = String(milli % 1000);
    while (frac.length < 3) frac = '0' + frac;
    frac = frac.replace(/0+$/, '');
    return String(whole) + (frac ? '.' + frac : '');
  }
  function yearsText(y) { return y + (y === 1 ? ' year' : ' years'); }
  // 328 -> "27 years and 4 months", 360 -> "30 years", 8 -> "8 months", 13 -> "1 year and 1 month"
  function monthsText(months) {
    var y = Math.floor(months / 12), r = months % 12, parts = [];
    if (y) parts.push(yearsText(y));
    if (r || !y) parts.push(r + (r === 1 ? ' month' : ' months'));
    return parts.join(' and ');
  }

  // What the screen starts with: $250,000.00 at the example rate for 30 years. text is the
  // string for the field; the numbers are what parseAmount, parseRate and parseTerm give for it.
  var DEFAULTS = Object.freeze({ cents: 25000000, rate: '6.5', milli: 6500, term: '30', years: 30 });

  var api = {
    MIN_CENTS: MIN_CENTS, MAX_CENTS: MAX_CENTS, MAX_RATE: MAX_RATE, MIN_YEARS: MIN_YEARS, MAX_YEARS: MAX_YEARS,
    ROUND_STEPS: ROUND_STEPS, DEFAULTS: DEFAULTS,
    MSG: MSG, divRound: divRound, parseAmount: parseAmount, parseRate: parseRate, parseTerm: parseTerm,
    interestFor: interestFor, paymentFor: paymentFor, schedule: schedule,
    scheduleExtra: scheduleExtra, roundUpPayment: roundUpPayment, roundUp: roundUp, extraYearly: extraYearly,
    money: money, rateText: rateText, yearsText: yearsText, monthsText: monthsText
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Amortize = api;
})(this);
