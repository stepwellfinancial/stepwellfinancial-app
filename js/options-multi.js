/* Options multi-leg layer (tool only). Strategy names and multi-leg code live only here.
 *
 * What it does: pure arithmetic on whole numbers (cents) for a position of up to four legs held to expiry. It calls the core engine
 * (engine.js, ITEM_ENGINE) for every single-option payoff and profit or loss and for the share gain, so no single-option arithmetic is
 * repeated here. A leg is { type: 'call'|'put'|'share', side: 1 (long) | -1 (short), K: strike in cents (not for a share), p: premium
 * per share in cents (a share: price paid per share), n: contracts (a share: lots of 100) }. Fee is cents per option contract, paid once.
 * T(S) = sum of side x 100 x n x (payoff - p), less fee x option contracts, is piecewise linear with kinks only at strikes, so every
 * figure comes from T at 0 and at each strike plus the two tail slopes; break-evens are exact fractions (the slope of a segment is
 * a whole number, so root = a + t / m with whole t and m), shown rounded half up by quotient and remainder. No Math.round, toFixed,
 * parseFloat or float multiply is used for money.
 * What it must never touch: files, the network, the DOM, the clock, a random draw, storage, cookies, the URL, or any global other
 * than the one name it defines (OPTIONS_MULTI) and the one it reads (ITEM_ENGINE, in a page or runner; in node it is required from
 * ./engine.js). No input and no output of its own.
 *
 * Refusal codes (validate): R1 butterfly or iron butterfly strikes not strictly K1 < K2 < K3; R2 two-strike order (strangle, collar,
 * the four verticals) not strictly ascending; R3 a money field blank, negative, non-numeric, exponent form or over 2 decimals;
 * R4 quantity not a whole number 1 to 100; R5 iron condor strikes not strictly K1 < K2 < K3 < K4 (refused, never re-sorted);
 * R6 fee not 0.00 to 100.00; R7 custom legs: none, or more than four (a share leg counts toward the four).
 * Added by the builder (not in the spec; flagged): R8 a money field outside its range; R9 a missing or unknown strategy, direction,
 * kind, leg type or leg side.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(require('./engine.js')); }
  else { root.OPTIONS_MULTI = factory(root.ITEM_ENGINE); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CORE) {
  var M = 100;                                    // shares per contract, fixed
  var calcs = CORE.calcs, raw = CORE.raw;

  function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
  function isInt(x) { return typeof x === 'number' && isFinite(x) && Math.floor(x) === x; }
  // num / den half up, whole num >= 0, whole den > 0, by quotient and remainder
  function halfUp(num, den) {
    var r = num % den, q = (num - r) / den;
    return 2 * r >= den ? q + 1 : q;
  }

  // ---- legs ----
  function legPayoff(leg, S) {                    // per share, cents
    if (leg.type === 'call') return raw.callPayoff(leg.K, S);
    if (leg.type === 'put') return raw.putPayoff(leg.K, S);
    return isInt(S) && S >= 0 ? S : null;
  }
  function legPL(leg, S) {                        // whole leg, cents, no fee
    var g;
    if (leg.type === 'share') g = raw.sharesPL(leg.p, S);
    else { var r = calcs.profitLoss({ type: leg.type, K: leg.K, S: S, p: leg.p }); g = r === null ? null : r.value; }
    return g === null ? null : leg.side * M * leg.n * g;
  }
  function contractsOf(legs) {
    var i, c = 0;
    for (i = 0; i < legs.length; i++) if (legs[i].type !== 'share') c += legs[i].n;
    return c;
  }
  function positionTotal(legs, fee, S) {
    var i, t = 0, x;
    for (i = 0; i < legs.length; i++) { x = legPL(legs[i], S); if (x === null) return null; t += x; }
    return t - (fee || 0) * contractsOf(legs);
  }
  function netPremium(legs) {                     // options only; positive is a net credit
    var i, t = 0;
    for (i = 0; i < legs.length; i++) if (legs[i].type !== 'share') t -= legs[i].side * M * legs[i].n * legs[i].p;
    return t;
  }
  function shareCost(legs) {                      // positive is cash paid for shares
    var i, t = 0;
    for (i = 0; i < legs.length; i++) if (legs[i].type === 'share') t += legs[i].side * M * legs[i].n * legs[i].p;
    return t;
  }
  function costToOpen(legs, fee) {                // paid > 0 is cash out, < 0 is cash in
    var net = netPremium(legs), sh = shareCost(legs), f = (fee || 0) * contractsOf(legs);
    return { netOptions: net, shares: sh, fees: f, paid: -net + sh + f };
  }
  function cashToSecure(legs) {                   // cash that would buy the shares at each short put's strike
    var i, t = 0;
    for (i = 0; i < legs.length; i++) if (legs[i].type === 'put' && legs[i].side === -1) t += M * legs[i].n * legs[i].K;
    return t;
  }

  // ---- shape ----
  function kinks(legs) {                          // distinct option strikes above 0, ascending
    var i, k, out = [];
    for (i = 0; i < legs.length; i++) {
      k = legs[i].K;
      if (legs[i].type !== 'share' && k > 0 && out.indexOf(k) < 0) out.push(k);
    }
    out.sort(function (a, b) { return a - b; });
    return out;
  }
  function tailSlope(legs) {                      // cents of total per cent of price: right of the top strike, left of the lowest
    var i, l, right = 0, left = 0;
    for (i = 0; i < legs.length; i++) {
      l = legs[i];
      if (l.type === 'call') right += l.side * M * l.n;
      else if (l.type === 'share') { right += l.side * M * l.n; left += l.side * M * l.n; }
      else left -= l.side * M * l.n;
    }
    return { right: right, left: left };
  }
  function scan(legs, fee) {
    var pts = [0].concat(kinks(legs)), T = [], i;
    for (i = 0; i < pts.length; i++) T.push(positionTotal(legs, fee, pts[i]));
    return { pts: pts, T: T, mR: tailSlope(legs).right };
  }
  // ranges of prices where T equals target; to: null means from there upward
  function rangesAt(s, target) {
    var out = [], i, prev = false;
    for (i = 0; i < s.pts.length; i++) {
      if (s.T[i] === target) {
        if (prev) out[out.length - 1].to = s.pts[i]; else out.push({ from: s.pts[i], to: s.pts[i] });
        prev = true;
      } else prev = false;
    }
    if (prev && s.mR === 0) out[out.length - 1].to = null;
    return out;
  }
  function extremes(legs, fee) {
    var s = scan(legs, fee), i, hi = s.T[0], lo = s.T[0];
    for (i = 1; i < s.T.length; i++) { if (s.T[i] > hi) hi = s.T[i]; if (s.T[i] < lo) lo = s.T[i]; }
    var mp = s.mR > 0 ? { unlimited: true, value: null, where: null, bestIsLoss: false }
      : { unlimited: false, value: hi, where: rangesAt(s, hi), bestIsLoss: hi < 0 };           // value may be negative (E2)
    var ml = s.mR < 0 ? { unlimited: true, value: null, noLoss: false, where: null }
      : (lo < 0 ? { unlimited: false, value: -lo, noLoss: false, where: rangesAt(s, lo) }
        : { unlimited: false, value: 0, noLoss: true, where: [] });
    return { maxProfit: mp, maxLoss: ml };
  }
  // exact break-evens. points: { num, den, cents } (price = num / den cents, cents half up); flat: ranges where T is 0 ({from, to},
  // to null = upward); everywhere: T is 0 at every price. A zero point inside or touching a flat range is not listed (the range wins).
  function breakEvens(legs, fee) {
    var s = scan(legs, fee), n = s.pts.length, i, flat = [], inFlat = [], pts = [], a, b, Ta, Tb, m, t, num, L;
    for (i = 0; i < n; i++) inFlat.push(false);
    for (i = 0; i + 1 < n; i++) {
      if (s.T[i] === 0 && s.T[i + 1] === 0) {
        if (flat.length && flat[flat.length - 1].to === s.pts[i]) flat[flat.length - 1].to = s.pts[i + 1];
        else flat.push({ from: s.pts[i], to: s.pts[i + 1] });
        inFlat[i] = true; inFlat[i + 1] = true;
      }
    }
    L = n - 1;
    if (s.T[L] === 0 && s.mR === 0) {
      if (flat.length && flat[flat.length - 1].to === s.pts[L]) flat[flat.length - 1].to = null;
      else flat.push({ from: s.pts[L], to: null });
      inFlat[L] = true;
    }
    for (i = 0; i < n; i++) {
      if (s.T[i] === 0 && !inFlat[i]) pts.push({ num: s.pts[i], den: 1, cents: s.pts[i] });
      if (i + 1 < n) {
        a = s.pts[i]; b = s.pts[i + 1]; Ta = s.T[i]; Tb = s.T[i + 1];
        if ((Ta < 0 && Tb > 0) || (Ta > 0 && Tb < 0)) {
          m = (Tb - Ta) / (b - a); t = -Ta;                 // whole: a segment's slope is a sum of side x 100 x n
          if (m < 0) { m = -m; t = -t; }
          num = a * m + t;
          pts.push({ num: num, den: m, cents: halfUp(num, m) });
        }
      }
    }
    if (s.T[L] !== 0 && s.mR !== 0 && ((s.T[L] > 0) !== (s.mR > 0))) {
      m = s.mR; t = -s.T[L];
      if (m < 0) { m = -m; t = -t; }
      num = s.pts[L] * m + t;
      pts.push({ num: num, den: m, cents: halfUp(num, m) });
    }
    return { points: pts, flat: flat, everywhere: flat.length === 1 && flat[0].from === 0 && flat[0].to === null };
  }

  // ---- typed input ----
  function parseCents(v) {                        // '3.50' -> 350; null if blank, negative, exponent, non-numeric or over 2 decimals
    var s = typeof v === 'number' ? (isFinite(v) ? String(v) : '') : (typeof v === 'string' ? v.replace(/^\s+|\s+$/g, '') : '');
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
    var p = s.split('.'), f = p[1] || '';
    while (f.length < 2) f += '0';
    return parseInt(p[0], 10) * 100 + parseInt(f, 10);
  }
  function parseQty(v) {
    var s = typeof v === 'number' ? String(v) : (typeof v === 'string' ? v.replace(/^\s+|\s+$/g, '') : '');
    return /^\d{1,4}$/.test(s) ? parseInt(s, 10) : null;
  }
  function blank(v) { return v === undefined || v === null || (typeof v === 'string' && v.replace(/^\s+|\s+$/g, '') === ''); }
  function refuse(code, field, message) { return { ok: false, code: code, field: field, message: message }; }

  // one field by name: K..: strike 0.50 to 10,000.00; n: 1 to 100; fee: 0 to 100.00; S0, Sx: 0.01 to 10,000.00; else (premium, share price B) 0 to 10,000.00
  function readField(name, v) {
    var c;
    if (name === 'n') {
      c = parseQty(v);
      return c !== null && c >= 1 && c <= 100 ? { v: c } : refuse('R4', name, 'Quantity: a whole number from 1 to 100.');
    }
    if (name === 'fee') {
      c = parseCents(v);
      return c !== null && c <= 10000 ? { v: c } : refuse('R6', name, 'Fee per contract: 0.00 to 100.00, not negative, at most 2 decimals.');
    }
    c = parseCents(v);
    if (c === null) return refuse('R3', name, name + ': a number of at most 2 decimals, not blank, not negative, no exponent.');
    if (name.charAt(0) === 'K') return c >= 50 && c <= 1000000 ? { v: c } : refuse('R8', name, 'Strike: 0.50 to 10,000.00.');
    if (name === 'S0' || name === 'Sx') return c >= 1 && c <= 1000000 ? { v: c } : refuse('R8', name, name + ': 0.01 to 10,000.00.');
    return c <= 1000000 ? { v: c } : refuse('R8', name, name + ': 0.00 to 10,000.00.');
  }

  var FIELDS = {
    longCall: ['K', 'p', 'n'], shortCall: ['K', 'p', 'n'], longPut: ['K', 'p', 'n'], shortPut: ['K', 'p', 'n'], cashSecuredPut: ['K', 'p', 'n'],
    coveredCall: ['B', 'K', 'p', 'n'], protectivePut: ['B', 'K', 'p', 'n'], collar: ['B', 'Kp', 'pp', 'Kc', 'pc', 'n'],
    bullCallSpread: ['K1', 'p1', 'K2', 'p2', 'n'], bearPutSpread: ['K1', 'p1', 'K2', 'p2', 'n'],
    bullPutSpread: ['K1', 'p1', 'K2', 'p2', 'n'], bearCallSpread: ['K1', 'p1', 'K2', 'p2', 'n'],
    straddle: ['K', 'pc', 'pp', 'n'], strangle: ['Kp', 'pp', 'Kc', 'pc', 'n'],
    butterfly: ['K1', 'p1', 'K2', 'p2', 'K3', 'p3', 'n'],
    ironButterfly: ['K1', 'p1', 'K2', 'p2', 'p3', 'K3', 'p4', 'n'],
    ironCondor: ['K1', 'p1', 'K2', 'p2', 'K3', 'p3', 'K4', 'p4', 'n']
  };
  var ORDER = {
    bullCallSpread: [['K1', 'K2'], 'R2'], bearPutSpread: [['K1', 'K2'], 'R2'], bullPutSpread: [['K1', 'K2'], 'R2'], bearCallSpread: [['K1', 'K2'], 'R2'],
    strangle: [['Kp', 'Kc'], 'R2'], collar: [['Kp', 'Kc'], 'R2'],
    butterfly: [['K1', 'K2', 'K3'], 'R1'], ironButterfly: [['K1', 'K2', 'K3'], 'R1'], ironCondor: [['K1', 'K2', 'K3', 'K4'], 'R5']
  };
  var NEEDS_DIR = { straddle: 1, strangle: 1, butterfly: 1, ironButterfly: 1, ironCondor: 1 };

  function L(type, side, K, p, n) { return type === 'share' ? { type: 'share', side: side, p: p, n: n } : { type: type, side: side, K: K, p: p, n: n }; }
  function flipAll(legs) { var i; for (i = 0; i < legs.length; i++) legs[i].side = -legs[i].side; return legs; }

  // legs of a preset from values already in cents (c); dir 'buy' or 'sell' where the strategy has one; kind 'call' or 'put' for the butterfly
  function presetLegs(strategy, c) {
    var n = c.n, legs;
    switch (strategy) {
      case 'longCall': return [L('call', 1, c.K, c.p, n)];
      case 'shortCall': return [L('call', -1, c.K, c.p, n)];
      case 'longPut': return [L('put', 1, c.K, c.p, n)];
      case 'shortPut': case 'cashSecuredPut': return [L('put', -1, c.K, c.p, n)];
      case 'coveredCall': return [L('share', 1, 0, c.B, n), L('call', -1, c.K, c.p, n)];
      case 'protectivePut': return [L('share', 1, 0, c.B, n), L('put', 1, c.K, c.p, n)];
      case 'collar': return [L('share', 1, 0, c.B, n), L('put', 1, c.Kp, c.pp, n), L('call', -1, c.Kc, c.pc, n)];
      case 'bullCallSpread': return [L('call', 1, c.K1, c.p1, n), L('call', -1, c.K2, c.p2, n)];
      case 'bearPutSpread': return [L('put', -1, c.K1, c.p1, n), L('put', 1, c.K2, c.p2, n)];
      case 'bullPutSpread': return [L('put', 1, c.K1, c.p1, n), L('put', -1, c.K2, c.p2, n)];
      case 'bearCallSpread': return [L('call', -1, c.K1, c.p1, n), L('call', 1, c.K2, c.p2, n)];
      case 'straddle': legs = [L('call', 1, c.K, c.pc, n), L('put', 1, c.K, c.pp, n)]; return c.dir === 'sell' ? flipAll(legs) : legs;
      case 'strangle': legs = [L('put', 1, c.Kp, c.pp, n), L('call', 1, c.Kc, c.pc, n)]; return c.dir === 'sell' ? flipAll(legs) : legs;
      case 'butterfly':
        legs = [L(c.kind, 1, c.K1, c.p1, n), L(c.kind, -1, c.K2, c.p2, 2 * n), L(c.kind, 1, c.K3, c.p3, n)];
        return c.dir === 'sell' ? flipAll(legs) : legs;
      case 'ironButterfly':   // the listed form is the Sell form
        legs = [L('put', 1, c.K1, c.p1, n), L('put', -1, c.K2, c.p2, n), L('call', -1, c.K2, c.p3, n), L('call', 1, c.K3, c.p4, n)];
        return c.dir === 'buy' ? flipAll(legs) : legs;
      case 'ironCondor':
        legs = [L('put', 1, c.K1, c.p1, n), L('put', -1, c.K2, c.p2, n), L('call', -1, c.K3, c.p3, n), L('call', 1, c.K4, c.p4, n)];
        return c.dir === 'buy' ? flipAll(legs) : legs;
    }
    return null;
  }

  function notesFor(strategy, c, legs) {
    var notes = [], e;
    if ((strategy === 'butterfly' || strategy === 'ironButterfly') && c.K2 - c.K1 !== c.K3 - c.K2) notes.push('unequalWings');
    if (strategy === 'ironCondor' && c.K2 - c.K1 !== c.K4 - c.K3) notes.push('unequalWings');
    e = extremes(legs, 0);                         // before fees; calls' premium above strike is NOT a note (QA E4)
    if (!e.maxLoss.unlimited && e.maxLoss.noLoss) notes.push('cannotLose');
    return notes;
  }

  // validate(strategy, inputs): typed text (or numbers) in; { ok: true, strategy, legs, fee, S0, Sx, notes } or a refusal
  function validate(strategy, inputs) {
    var c = {}, names, i, r, legs, fee = 0, S0 = null, Sx = null, ord, k, list, one, s;
    if (!inputs) inputs = {};
    if (strategy === 'custom') {
      list = inputs.legs;
      if (!Array.isArray(list) || list.length < 1 || list.length > 4) return refuse('R7', 'legs', 'Custom legs: from 1 to 4 legs (a share leg counts).');
      legs = [];
      for (i = 0; i < list.length; i++) {
        one = list[i];
        if (one === null || typeof one !== 'object') return refuse('R9', 'legs.' + i, 'Leg ' + (i + 1) + ': fill in the leg.');
        if (one.type !== 'call' && one.type !== 'put' && one.type !== 'share') return refuse('R9', 'legs.' + i + '.type', 'Leg ' + (i + 1) + ': choose call, put or shares.');
        if (one.side !== 'long' && one.side !== 'short') return refuse('R9', 'legs.' + i + '.side', 'Leg ' + (i + 1) + ': choose long or short.');
        s = one.side === 'long' ? 1 : -1;
        if (one.type !== 'share') { r = readField('K', one.K); if (r.ok === false) return r; k = r.v; } else k = 0;
        r = readField('p', one.p); if (r.ok === false) return r;
        var pc = r.v;
        r = readField('n', one.n); if (r.ok === false) return r;
        legs.push(L(one.type, s, k, pc, r.v));
      }
    } else {
      if (typeof strategy !== 'string' || !has(FIELDS, strategy)) return refuse('R9', 'strategy', 'Choose a strategy.');
      names = FIELDS[strategy];
      if (has(NEEDS_DIR, strategy) && inputs.dir !== 'buy' && inputs.dir !== 'sell') return refuse('R9', 'dir', 'Choose Bought (long) or Sold (short).');
      if (strategy === 'butterfly' && inputs.kind !== 'call' && inputs.kind !== 'put') return refuse('R9', 'kind', 'Choose the call or the put version.');
      for (i = 0; i < names.length; i++) {
        r = readField(names[i], inputs[names[i]]);
        if (r.ok === false) return r;
        c[names[i]] = r.v;
      }
      ord = has(ORDER, strategy) ? ORDER[strategy] : null;
      if (ord) {
        for (i = 0; i + 1 < ord[0].length; i++) {
          if (!(c[ord[0][i]] < c[ord[0][i + 1]])) {
            return refuse(ord[1], ord[0][i + 1], 'Strikes ' + ord[0].join(', ') + ' must rise strictly (' + ord[0][i] + ' below ' + ord[0][i + 1] +
              '); equal or out-of-order strikes are refused, not re-sorted.' + (strategy === 'strangle' && c.Kp === c.Kc ? ' Equal strikes make this a straddle, which is a separate item in the list.' : ''));
          }
        }
      }
      c.dir = inputs.dir; c.kind = inputs.kind;
      legs = presetLegs(strategy, c);
    }
    if (!blank(inputs.fee)) { r = readField('fee', inputs.fee); if (r.ok === false) return r; fee = r.v; }
    if (!blank(inputs.S0)) { r = readField('S0', inputs.S0); if (r.ok === false) return r; S0 = r.v; }
    if (!blank(inputs.Sx)) { r = readField('Sx', inputs.Sx); if (r.ok === false) return r; Sx = r.v; }
    return { ok: true, strategy: strategy, legs: legs, fee: fee, S0: S0, Sx: Sx, notes: notesFor(strategy, c, legs) };
  }

  return {
    legPayoff: legPayoff, legPL: legPL, positionTotal: positionTotal, netPremium: netPremium, shareCost: shareCost, costToOpen: costToOpen,
    cashToSecure: cashToSecure, contractsOf: contractsOf, kinks: kinks, tailSlope: tailSlope, extremes: extremes, breakEvens: breakEvens,
    parseCents: parseCents, validate: validate, presetLegs: presetLegs, halfUp: halfUp
  };
});
