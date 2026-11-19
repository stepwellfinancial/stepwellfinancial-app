/* Options engine, core (one-leg calcs). It holds the one-leg calcs and nothing else; the multi-leg layer is in another file.
 *
 * What it does: pure arithmetic on whole numbers. Every money figure, in and out, is a whole number of CENTS (strike, price paid,
 * price at expiry, payoff, profit or loss, break-even). All figures are per share unless a calc says per contract. A contract is 100
 * shares; perContract scales by 100 times the number of contracts. There is no rounding in this file: every result is a product,
 * sum or difference of whole numbers, so no float is ever used for money. Typical ranges (strike 20.00 to 120.00 in
 * 5.00 steps, contracts 1 to 3, and so on) are not limits of this file: a calc refuses only a value that is not a
 * whole number of cents, is negative, or (a count) is below 1. It never clamps and never assumes a step.
 * What it must never touch: files, the network, the DOM, the clock, a random draw, storage, cookies, or any global other than the one
 * name it defines (ITEM_ENGINE). The one conditional line at the end hands the object to node's module system when that exists, so
 * a layer built on top of it and the tests can load it; in a page or in the test runner it does nothing.
 *
 * Contract: ITEM_ENGINE = { calcs, mistakes, traps, names, formats, dollars, raw }. A calc takes one object of the
 * given and returns an object of results, or null when the given is outside what the calc can do (a redraw). A mistake takes
 * (given, result) and returns a value, or null when it does not apply or equals the right answer (a trap equal to the answer is
 * omitted). traps(calc, given, field) lists the traps of one answer once each, in the spec's order. `raw` holds the three bare
 * positional functions (callPayoff(K, S), putPayoff(K, S), sharesPL(buy, end)) that return a whole number or null.
 * Result names never equal a given name.
 *
 * The given of each calc (cents): callPayoff { K, S }   putPayoff { K, S }   profitLoss { type, K, S, p }   breakEven { type, K, p }
 *   maxLoss { p, contracts }   moneyness { type, K, S, p? }   perContract { x, n }   sharesPL { buy, end }
 * Results: callPayoff { value }  putPayoff { value }  profitLoss { value, payoff, verdict }  breakEven { value }
 *   maxLoss { perShare, value }  moneyness { value, profitable? }  perContract { value }  sharesPL { value }
 * type is 'call' or 'put'. K strike, S price at expiry, p price paid per share, x any amount, n and contracts counts.
 *
 * Mistake names: the spec's, except that the two payoff calcs each have their own noFloor and endingOnly, so they are named
 * callNoFloor, callEndingOnly, putNoFloor, putEndingOnly here. perShareOnly100 belongs to a per-contract question (names key
 * 'profitLoss.contract'); the brief's list for the plain profit-or-loss answer is forgotPrice, addedPrice, flooredAfter, wrongType.
 */
var ITEM_ENGINE = (function () {
  // ---- helpers: whole numbers only ----
  function isInt(x) { return typeof x === 'number' && isFinite(x) && Math.floor(x) === x; }
  function nn(x) { return isInt(x) && x >= 0; }                       // a whole number of cents, not negative
  function cnt(x) { return isInt(x) && x >= 1; }                      // a count of one or more
  function okType(t) { return t === 'call' || t === 'put'; }
  function other(t) { return t === 'call' ? 'put' : 'call'; }
  function same(x, answer) { return x === answer ? null : x; }       // a trap that equals the answer is omitted
  function dollars(cents) { return cents / 100; }                    // display edge only; the engine never uses it

  // ---- bare payoffs, whole cents per share ----
  function callPay(K, S) { return nn(K) && nn(S) ? (S > K ? S - K : 0) : null; }
  function putPay(K, S) { return nn(K) && nn(S) ? (K > S ? K - S : 0) : null; }
  function payOf(type, K, S) { return type === 'call' ? callPay(K, S) : putPay(K, S); }
  function sharesGain(buy, end) { return nn(buy) && nn(end) ? end - buy : null; }

  // ---- calcs ----
  var calcs = {
    // value = max(S - K, 0)
    callPayoff: function (g) {
      if (!g) return null;
      var v = callPay(g.K, g.S);
      return v === null ? null : { value: v };
    },
    // value = max(K - S, 0)
    putPayoff: function (g) {
      if (!g) return null;
      var v = putPay(g.K, g.S);
      return v === null ? null : { value: v };
    },
    // value = payoff - p (may be negative); verdict text
    profitLoss: function (g) {
      if (!g || !okType(g.type) || !nn(g.p)) return null;
      var pay = payOf(g.type, g.K, g.S);
      if (pay === null) return null;
      var v = pay - g.p;
      return { value: v, payoff: pay, verdict: v > 0 ? 'profit' : (v < 0 ? 'loss' : 'no profit or loss') };
    },
    // value = K + p for a call, K - p for a put; a price per share, never scaled by 100
    breakEven: function (g) {
      if (!g || !okType(g.type) || !nn(g.K) || !nn(g.p)) return null;
      return { value: g.type === 'call' ? g.K + g.p : g.K - g.p };
    },
    // perShare = p; value = p x 100 x contracts
    maxLoss: function (g) {
      if (!g || !nn(g.p) || !cnt(g.contracts)) return null;
      return { perShare: g.p, value: g.p * 100 * g.contracts };
    },
    // call: in when S > K; put: in when S < K; equal is at the money. profitable only when p is given.
    moneyness: function (g) {
      if (!g || !okType(g.type) || !nn(g.K) || !nn(g.S)) return null;
      var d = g.type === 'call' ? g.S - g.K : g.K - g.S;
      var r = { value: d > 0 ? 'in the money' : (d === 0 ? 'at the money' : 'out of the money') };
      if (g.p !== undefined) {
        if (!nn(g.p)) return null;
        r.profitable = payOf(g.type, g.K, g.S) - g.p > 0 ? 'yes' : 'no';
      }
      return r;
    },
    // value = x x 100 x n
    perContract: function (g) {
      if (!g || !isInt(g.x) || !cnt(g.n)) return null;
      return { value: g.x * 100 * g.n };
    },
    // value = end - buy, one share, may be negative
    sharesPL: function (g) {
      if (!g) return null;
      var v = sharesGain(g.buy, g.end);
      return v === null ? null : { value: v };
    }
  };

  // a mistake: null when the calc gave no result (v null), else the trap, or null if it equals the answer
  var mistakes = {
    // callPayoff
    putFormula: function (g, v) { return v ? same(putPay(g.K, g.S), v.value) : null; },
    callNoFloor: function (g, v) { return v ? same(g.S - g.K, v.value) : null; },
    callEndingOnly: function (g, v) { return v ? same(g.S, v.value) : null; },
    // putPayoff
    callFormula: function (g, v) { return v ? same(callPay(g.K, g.S), v.value) : null; },
    putNoFloor: function (g, v) { return v ? same(g.K - g.S, v.value) : null; },
    putEndingOnly: function (g, v) { return v ? same(g.K, v.value) : null; },
    // profitLoss
    forgotPrice: function (g, v) { return v ? same(v.payoff, v.value) : null; },
    addedPrice: function (g, v) { return v ? same(v.payoff + g.p, v.value) : null; },
    flooredAfter: function (g, v) { return v ? same(v.value > 0 ? v.value : 0, v.value) : null; },
    wrongType: function (g, v) { return v ? same(payOf(other(g.type), g.K, g.S) - g.p, v.value) : null; },
    perShareOnly100: function (g, v) { return v ? same(v.payoff * 100 - g.p, v.value) : null; },
    // breakEven
    wrongSign: function (g, v) { return v ? same(g.type === 'call' ? g.K - g.p : g.K + g.p, v.value) : null; },
    strikeOnly: function (g, v) { return v ? same(g.K, v.value) : null; },
    priceOnly: function (g, v) { return v ? same(g.p, v.value) : null; },
    times100: function (g, v) { return v ? same(v.value * 100, v.value) : null; },
    // maxLoss
    unscaled: function (g, v) { return v ? same(g.p * g.contracts, v.value) : null; },
    zero: function (g, v) { return v ? same(0, v.value) : null; },
    // moneyness (text)
    swapped: function (g, v) {
      if (!v) return null;
      var d = other(g.type) === 'call' ? g.S - g.K : g.K - g.S;
      return same(d > 0 ? 'in the money' : (d === 0 ? 'at the money' : 'out of the money'), v.value);
    },
    profitEqualsIn: function (g, v) {
      if (!v || v.profitable === undefined) return null;
      return same(v.value === 'in the money' ? 'yes' : 'no', v.profitable);
    },
    // perContract
    noScale: function (g, v) { return v ? same(g.x, v.value) : null; },
    times10: function (g, v) { return v ? same(g.x * 10, v.value) : null; },
    times1000: function (g, v) { return v ? same(g.x * 1000, v.value) : null; },
    // sharesPL
    reversed: function (g, v) { return v ? same(g.buy - g.end, v.value) : null; },
    endOnly: function (g, v) { return v ? same(g.end, v.value) : null; }
  };

  // which mistakes belong to which answer, in the spec's order
  var names = {
    callPayoff: ['putFormula', 'callNoFloor', 'callEndingOnly'],
    putPayoff: ['callFormula', 'putNoFloor', 'putEndingOnly'],
    profitLoss: ['forgotPrice', 'addedPrice', 'flooredAfter', 'wrongType'],
    'profitLoss.contract': ['perShareOnly100'],
    breakEven: ['wrongSign', 'strikeOnly', 'priceOnly', 'times100'],
    maxLoss: ['unscaled', 'zero'],
    moneyness: ['swapped'],
    'moneyness.profitable': ['profitEqualsIn'],
    perContract: ['noScale', 'times10', 'times1000'],
    sharesPL: ['reversed', 'endOnly']
  };

  // the traps of one answer for one given, each value once, in the spec's order; [] for a redraw. field: e.g. 'contract' or 'profitable'.
  function traps(calc, g, field) {
    var v = calcs[calc](g), out = [], key = field ? calc + '.' + field : calc, i, t;
    if (!v || !names[key]) return out;
    for (i = 0; i < names[key].length; i++) {
      t = mistakes[names[key][i]](g, v);
      if (t !== null && out.indexOf(t) < 0) out.push(t);
    }
    return out;
  }

  // how the item shows each result: 'cents' is a whole number of cents (the item or builder converts; see dollars)
  var formats = {
    value: 'cents', payoff: 'cents', perShare: 'cents', verdict: 'text', profitable: 'text'
  };

  var raw = { callPayoff: callPay, putPayoff: putPay, sharesPL: sharesGain };

  return { calcs: calcs, mistakes: mistakes, traps: traps, names: names, formats: formats, dollars: dollars, raw: raw };
})();
if (typeof module !== 'undefined' && module.exports) { module.exports = ITEM_ENGINE; }
