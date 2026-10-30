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
     schedule: the balance would not fall. */
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
  function parseAmount(text) {
    var t = String(text === undefined || text === null ? '' : text).trim();
    if (!t) return { ok: false, message: MSG.amountEmpty };
    var m = /^(-)?\s*(\$)?\s*(-)?(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d*))?$/.exec(t);
    var whole = m ? m[4].replace(/,/g, '') : '', frac = m && m[5] ? m[5] : '';
    if (!m || (!whole && !frac)) return { ok: false, message: MSG.amountText };
    if (frac.length > 2) return { ok: false, message: decimalsMsg(frac.length, 2) };
    whole = whole.replace(/^0+(?=\d)/, '');
    if (m[1] || m[3] || whole.length > 10) return { ok: false, message: MSG.amountRange };
    var cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
    if (cents < MIN_CENTS || cents > MAX_CENTS) return { ok: false, message: MSG.amountRange };
    return { ok: true, cents: cents };
  }

  function parseRate(text) {
    var t = String(text === undefined || text === null ? '' : text).trim();
    if (!t) return { ok: false, message: MSG.rateEmpty };
    var m = /^(-)?(\d*)(?:\.(\d*))?\s*%?$/.exec(t);
    var whole = m ? m[2] : '', frac = m && m[3] ? m[3] : '';
    if (!m || (!whole && !frac)) return { ok: false, message: MSG.rateText };
    if (frac.length > 3) return { ok: false, message: decimalsMsg(frac.length, 3) };
    whole = whole.replace(/^0+(?=\d)/, '');
    if (m[1] || whole.length > 3) return { ok: false, message: MSG.rateRange };
    var milli = Number(whole || '0') * 1000 + Number((frac + '000').slice(0, 3));
    if (milli > MAX_RATE) return { ok: false, message: MSG.rateRange };
    return { ok: true, milli: milli };
  }

  function parseTerm(text) {
    var t = String(text === undefined || text === null ? '' : text).trim();
    if (!t) return { ok: false, message: MSG.termEmpty };
    if (!/^-?\d+$/.test(t)) return { ok: false, message: MSG.termText };
    var digits = t.replace(/^-/, '').replace(/^0+(?=\d)/, '');
    if (t.charAt(0) === '-' || digits.length > 3) return { ok: false, message: MSG.termRange };
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

  var api = {
    MIN_CENTS: MIN_CENTS, MAX_CENTS: MAX_CENTS, MAX_RATE: MAX_RATE, MIN_YEARS: MIN_YEARS, MAX_YEARS: MAX_YEARS,
    MSG: MSG, divRound: divRound, parseAmount: parseAmount, parseRate: parseRate, parseTerm: parseTerm,
    interestFor: interestFor, paymentFor: paymentFor, schedule: schedule, money: money, rateText: rateText, yearsText: yearsText
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Amortize = api;
})(this);
