/* Option modeler: page code.
 *
 * Two parts in one file. (1) The pure part (everything above `start`): money formatter, picker table, field labels, example numbers,
 * chart model, text pieces. It touches no page, no clock, no storage, no network. It calls the engine (options-multi.js, which calls
 * options.js) for every figure: validate, presetLegs, positionTotal, netPremium, costToOpen, cashToSecure, kinks, tailSlope, extremes,
 * breakEvens. No payoff or break-even arithmetic is repeated here. (2) `start(doc)`: the page wiring, run only in a browser.
 * Privacy (the page says the numbers are not stored or sent): this file has no network call, no storage, no cookie, no change to
 * the URL or hash, no form, no timer that sends anything. Typed numbers live in one variable (`st`) until the page closes.
 * Money in is whole cents from the engine. Every shown figure goes through fmtMoney.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory; }   // node: factory(optionsMultiEngine) returns the pure api
  else { var api = factory(root.OPTIONS_MULTI); root.OPTIONS_MODELER = api; if (root.document) { api.start(root.document, root); } }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (E) {

  // ---- the one formatter ----
  // Spec section 3, "Rounding, half up": a figure of num/den cents shows as floor((2*num + den) / (2*den)) cents. Every figure the engine
  // returns is already a whole number of cents (den 1), so this is the identity; a non-whole value (never expected) is rounded the same
  // way, half up. Dollars with a thousands comma, two decimals, and a minus sign for a negative number (axis labels only; text uses words).
  function group3(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function fmtMoney(c) {
    if (typeof c !== 'number' || !isFinite(c)) return '';
    c = Math.floor((2 * c + 1) / 2);
    var neg = c < 0, n = neg ? -c : c, frac = n % 100, whole = (n - frac) / 100;
    return (neg ? '-' : '') + '$' + group3(whole) + '.' + (frac < 10 ? '0' : '') + frac;
  }
  function toPlain(c) { var f = c % 100, w = (c - f) / 100; return w + '.' + (f < 10 ? '0' : '') + f; }
  // a total in words: never a minus sign or a colour alone
  function totalWords(t) { return t > 0 ? 'a profit of ' + fmtMoney(t) : (t < 0 ? 'a loss of ' + fmtMoney(-t) : 'a total of $0.00'); }

  // ---- the picker (spec section 4, R1 lines, exact) ----
  function F(name, kind, type, side, flip, noun) { return { name: name, kind: kind, type: type, side: side, flip: flip || null, noun: noun || null }; }
  var N_ = F('n', 'n');
  var STRAT = [
    { id: 'longCall', group: 'Single options', name: 'Long call', line: 'one call bought.', f: [F('K', 'K', 'call', 1), F('p', 'p', 'call', 1), N_] },
    { id: 'shortCall', group: 'Single options', name: 'Short call', line: 'one call sold, also called written.', f: [F('K', 'K', 'call', -1), F('p', 'p', 'call', -1), N_] },
    { id: 'longPut', group: 'Single options', name: 'Long put', line: 'one put bought.', f: [F('K', 'K', 'put', 1), F('p', 'p', 'put', 1), N_] },
    { id: 'shortPut', group: 'Single options', name: 'Short put', line: 'one put sold, also called written.', f: [F('K', 'K', 'put', -1), F('p', 'p', 'put', -1), N_] },
    { id: 'coveredCall', group: 'With shares', name: 'Share plus short call (often called a covered call)', line: '100 shares per contract held, and one call sold.',
      f: [F('B', 'B'), F('K', 'K', 'call', -1), F('p', 'p', 'call', -1), N_] },
    { id: 'protectivePut', group: 'With shares', name: 'Share plus long put (often called a protective put)', line: '100 shares per contract held, and one put bought.',
      f: [F('B', 'B'), F('K', 'K', 'put', 1), F('p', 'p', 'put', 1), N_] },
    { id: 'collar', group: 'With shares', name: 'Collar', line: '100 shares per contract held, one put bought at a lower strike and one call sold at a higher strike.',
      f: [F('B', 'B'), F('Kp', 'K', 'put', 1), F('pp', 'p', 'put', 1), F('Kc', 'K', 'call', -1), F('pc', 'p', 'call', -1), N_] },
    { id: 'cashSecuredPut', group: 'With shares', name: 'Short put with the cash amount shown (often called a cash-secured put)',
      line: 'one put sold, with the cash equal to the strike for the shares shown.', f: [F('K', 'K', 'put', -1), F('p', 'p', 'put', -1), N_] },
    { id: 'bullCallSpread', group: 'Spreads', name: 'Bull call spread', line: 'one call bought, and one call at a higher strike sold.',
      f: [F('K1', 'K', 'call', 1), F('p1', 'p', 'call', 1), F('K2', 'K', 'call', -1), F('p2', 'p', 'call', -1), N_] },
    { id: 'bearPutSpread', group: 'Spreads', name: 'Bear put spread', line: 'one put bought, and one put at a lower strike sold.',
      f: [F('K1', 'K', 'put', -1), F('p1', 'p', 'put', -1), F('K2', 'K', 'put', 1), F('p2', 'p', 'put', 1), N_] },
    { id: 'bullPutSpread', group: 'Spreads', name: 'Bull put spread', line: 'one put sold, and one put at a lower strike bought.',
      f: [F('K1', 'K', 'put', 1), F('p1', 'p', 'put', 1), F('K2', 'K', 'put', -1), F('p2', 'p', 'put', -1), N_] },
    { id: 'bearCallSpread', group: 'Spreads', name: 'Bear call spread', line: 'one call sold, and one call at a higher strike bought.',
      f: [F('K1', 'K', 'call', -1), F('p1', 'p', 'call', -1), F('K2', 'K', 'call', 1), F('p2', 'p', 'call', 1), N_] },
    { id: 'straddle', group: 'Straddle and strangle', name: 'Straddle', line: 'a call and a put at the same strike, both bought or both sold.', dir: true,
      f: [F('K', 'K', 'call and the put', 1, 'sell', 'both'), F('pc', 'p', 'call', 1, 'sell'), F('pp', 'p', 'put', 1, 'sell'), N_] },
    { id: 'strangle', group: 'Straddle and strangle', name: 'Strangle', line: 'a put at a lower strike and a call at a higher strike, both bought or both sold.', dir: true,
      f: [F('Kp', 'K', 'put', 1, 'sell'), F('pp', 'p', 'put', 1, 'sell'), F('Kc', 'K', 'call', 1, 'sell'), F('pc', 'p', 'call', 1, 'sell'), N_] },
    { id: 'butterfly', group: 'Butterflies and condors', name: 'Butterfly',
      line: 'one option bought at a low strike, two sold at a middle strike and one bought at a high strike, all calls or all puts; or the reverse.', dir: true, kind: true,
      f: [F('K1', 'K', 'kind', 1, 'sell'), F('p1', 'p', 'kind', 1, 'sell'), F('K2', 'K', 'kind', -1, 'sell', 'two'), F('p2', 'p', 'kind', -1, 'sell', 'two'),
        F('K3', 'K', 'kind', 1, 'sell'), F('p3', 'p', 'kind', 1, 'sell'), N_] },
    { id: 'ironButterfly', group: 'Butterflies and condors', name: 'Iron butterfly',
      line: 'a put and a call sold at the middle strike, a put bought below it and a call bought above it; or the reverse.', dir: true,
      f: [F('K1', 'K', 'put', 1, 'buy'), F('p1', 'p', 'put', 1, 'buy'), F('K2', 'K', 'put and the call', -1, 'buy', 'both'), F('p2', 'p', 'put', -1, 'buy'),
        F('p3', 'p', 'call', -1, 'buy'), F('K3', 'K', 'call', 1, 'buy'), F('p4', 'p', 'call', 1, 'buy'), N_] },
    { id: 'ironCondor', group: 'Butterflies and condors', name: 'Iron condor',
      line: 'a put and a call sold at inner strikes, and a put and a call bought further out; or the reverse.', dir: true,
      f: [F('K1', 'K', 'put', 1, 'buy'), F('p1', 'p', 'put', 1, 'buy'), F('K2', 'K', 'put', -1, 'buy'), F('p2', 'p', 'put', -1, 'buy'),
        F('K3', 'K', 'call', -1, 'buy'), F('p3', 'p', 'call', -1, 'buy'), F('K4', 'K', 'call', 1, 'buy'), F('p4', 'p', 'call', 1, 'buy'), N_] },
    { id: 'custom', group: 'Custom legs', name: 'Custom legs', line: 'up to four legs, each a call, a put or shares, bought or sold, typed one at a time.', f: [] }
  ];
  function strat(id) { var i; for (i = 0; i < STRAT.length; i++) if (STRAT[i].id === id) return STRAT[i]; return null; }
  // learn pages that exist (first build): strategy id -> slug under /options-calculator/learn/. A strategy not listed gets no link.
  var LEARN = { longCall: 'long-call', shortCall: 'short-call', longPut: 'long-put', shortPut: 'short-put', straddle: 'long-straddle', strangle: 'long-strangle',
    butterfly: 'long-call-butterfly', collar: 'collar', ironCondor: 'iron-condor', ironButterfly: 'iron-butterfly', bullCallSpread: 'bull-call-spread', bearPutSpread: 'bear-put-spread' };
  function learnHref(id) { return Object.prototype.hasOwnProperty.call(LEARN, id) ? '/options-calculator/learn/' + LEARN[id] + '/' : null; }

  // label of a field, from the leg it belongs to ("Strike of the call that is bought")
  // sid (optional): the strategy id, for the Low/Middle/High and Lowest/Second/Third/Highest prefixes before "strike"
  var PRE = { butterfly: { K1: 'Low', K2: 'Middle', K3: 'High' }, ironButterfly: { K1: 'Low', K2: 'Middle', K3: 'High' }, ironCondor: { K1: 'Lowest', K2: 'Second', K3: 'Third', K4: 'Highest' } };
  function fieldLabel(d, dir, kind, sid) {
    if (d.kind === 'n') return 'Quantity (contracts)';
    if (d.kind === 'B') return 'Price per share paid for the shares';
    var type = d.type === 'kind' ? kind : d.type, side = d.side * (d.flip && d.flip === dir ? -1 : 1), noun, plural = false, pre = sid && PRE[sid] ? PRE[sid][d.name] : null;
    if (d.noun === 'two') { noun = 'two ' + type + 's'; plural = true; } else if (d.noun === 'both') { noun = type; plural = true; } else noun = type;
    return (d.kind === 'K' ? (pre ? pre + ' strike' : 'Strike') : 'Premium per share') + ' of the ' + noun + (plural ? ' that are ' : ' that is ') + (side > 0 ? 'bought' : 'sold');
  }
  // optional fields: [name, label, label as shown (optional)]
  var OPTIONAL = [['fee', 'Fee per contract (dollars)'], ['S0', 'Price now (per share)'], ['Sx', 'Price at expiry to check (any price you type)']];
  function optLabel(name) { var i; for (i = 0; i < OPTIONAL.length; i++) if (OPTIONAL[i][0] === name) return OPTIONAL[i][1] + ' (optional)'; return name; }

  // example numbers: the oracle cases of the spec (made up). Each is filled only by the "Fill with example numbers" button.
  var EX = {
    longCall: { K: '50.00', p: '3.00', n: '1' }, shortCall: { K: '50.00', p: '3.00', n: '1' },
    longPut: { K: '40.00', p: '2.50', n: '1' }, shortPut: { K: '40.00', p: '2.50', n: '1' }, cashSecuredPut: { K: '45.00', p: '1.80', n: '1' },
    coveredCall: { B: '48.00', K: '50.00', p: '2.00', n: '1' }, protectivePut: { B: '50.00', K: '48.00', p: '1.50', n: '1' },
    collar: { B: '50.00', Kp: '45.00', pp: '1.20', Kc: '55.00', pc: '1.50', n: '1' },
    bullCallSpread: { K1: '50.00', p1: '4.00', K2: '55.00', p2: '1.50', n: '1' }, bearPutSpread: { K1: '45.00', p1: '1.25', K2: '50.00', p2: '3.50', n: '1' },
    bullPutSpread: { K1: '45.00', p1: '1.00', K2: '50.00', p2: '3.00', n: '1' }, bearCallSpread: { K1: '50.00', p1: '3.00', K2: '55.00', p2: '1.00', n: '1' },
    straddle: { K: '50.00', pc: '3.00', pp: '2.00', n: '1' }, strangle: { Kp: '45.00', pp: '1.00', Kc: '55.00', pc: '1.50', n: '1' },
    butterflyCall: { K1: '45.00', p1: '7.00', K2: '50.00', p2: '3.50', K3: '55.00', p3: '1.50', n: '1' },
    butterflyPut: { K1: '45.00', p1: '1.00', K2: '50.00', p2: '3.00', K3: '55.00', p3: '6.00', n: '1' },
    ironButterfly: { K1: '45.00', p1: '0.80', K2: '50.00', p2: '2.60', p3: '2.40', K3: '55.00', p4: '0.70', n: '1' },
    ironCondor: { K1: '40.00', p1: '0.50', K2: '45.00', p2: '1.50', K3: '55.00', p3: '1.25', K4: '60.00', p4: '0.40', n: '1' }
  };
  var EX_CUSTOM = [{ type: 'call', side: 'long', K: '50.00', p: '3.00', n: '1' }, { type: 'call', side: 'short', K: '55.00', p: '1.00', n: '2' }];

  // The page's own error messages (spec "Tool page strings", error region). The engine says which rule refused (code) and which field;
  // the words here are the spec's. raw: typed text by field name (a custom leg: that leg's K, p, n); leg: index of the custom leg, or null.
  var VERTICAL = { bullCallSpread: 1, bearPutSpread: 1, bullPutSpread: 1, bearCallSpread: 1 };
  var RANGE_TXT = { K: ['0.50', '10,000.00'], S: ['0.01', '10,000.00'], fee: ['0.00', '100.00'], other: ['0.00', '10,000.00'] };
  function fieldName(f, leg) {
    if (leg !== null && leg !== undefined) return f === 'n' ? 'Quantity' : 'Leg ' + (leg + 1) + (f === 'K' ? ' strike' : ' premium');
    return CODE_NAME[f] || f;
  }
  function errorText(sid, r, raw, leg) {
    var f = r.field, v = raw[f] === undefined || raw[f] === null ? '' : String(raw[f]), nm = fieldName(f, leg), rg, s, i, prev = null, a, b;
    if (r.code === 'R7') return 'Custom legs: use from 1 to 4 legs.';
    if (r.code === 'R1' || r.code === 'R2' || r.code === 'R5') {
      s = strat(sid);
      for (i = 0; s && i < s.f.length; i++) { if (s.f[i].kind === 'K') { if (s.f[i].name === f) break; prev = s.f[i].name; } }
      if (prev === null) return 'Each strike must be lower than the next one.';
      a = E.parseCents(raw[prev]); b = E.parseCents(raw[f]);
      if (a !== null && a === b && VERTICAL[sid]) return 'The two strikes must be different.';
      if (a !== null && a === b && sid === 'strangle') return 'Equal strikes make this a straddle, which is a separate item in the list.';
      return fieldName(prev, null) + ' must be lower than ' + nm + '.';
    }
    if (/^\s*$/.test(v)) return nm + ': type a number.';
    if (r.code === 'R4') return 'Quantity: type a whole number from 1 to 100.';
    if (E.parseCents(v) === null) return nm + ': use digits with at most 2 decimals.';
    rg = f.charAt(0) === 'K' ? RANGE_TXT.K : (f === 'S0' || f === 'Sx' ? RANGE_TXT.S : (f === 'fee' ? RANGE_TXT.fee : RANGE_TXT.other));
    return nm + ': type a number from ' + rg[0] + ' to ' + rg[1] + '.';
  }
  var CODE_NAME = { K1: 'Strike 1', K2: 'Strike 2', K3: 'Strike 3', K4: 'Strike 4', Kp: 'Put strike', Kc: 'Call strike', K: 'Strike', p1: 'Premium 1', p2: 'Premium 2',
    p3: 'Premium 3', p4: 'Premium 4', pp: 'Put premium', pc: 'Call premium', p: 'Premium', B: 'Share price', S0: 'Price now', Sx: 'Price at expiry to check', fee: 'Fee per contract', n: 'Quantity' };

  // ---- chart model ----
  // Axis range, spec section 3 "Domain": lo = max(0, kmin - 0.3 x span), hi = kmax + 0.3 x span over all strikes (a share leg: its price), S0 and Sx;
  // span 0 becomes 0.2 x kmax. Whole cents: 0.3 x span is floor(3 x span / 10) (exact when span is a multiple of 10 cents; display only).
  // extras (break-even prices) widen the range when given; the spec's own formula is the call without extras. A zero-width range gets 1.00 added (builder's guard).
  function axisRange(legs, S0, Sx, extras) {
    var vals = [], i, kmin, kmax, span, m, lo, hi;
    for (i = 0; i < legs.length; i++) vals.push(legs[i].type === 'share' ? legs[i].p : legs[i].K);
    if (S0 !== null && S0 !== undefined) vals.push(S0);
    if (Sx !== null && Sx !== undefined) vals.push(Sx);
    for (i = 0; extras && i < extras.length; i++) vals.push(extras[i]);
    kmin = vals[0]; kmax = vals[0];
    for (i = 1; i < vals.length; i++) { if (vals[i] < kmin) kmin = vals[i]; if (vals[i] > kmax) kmax = vals[i]; }
    span = kmax - kmin;
    if (span === 0) span = Math.floor(kmax / 5);
    m = Math.floor(3 * span / 10);
    lo = Math.max(0, kmin - m); hi = kmax + m;
    if (hi <= lo) hi = lo + 100;
    return { lo: lo, hi: hi };
  }
  // tick prices: steps of 1, 2, 5 or 10 times a power of ten cents, the smallest step that gives at most about `want` ticks
  function niceTicks(lo, hi, want) {
    var raw = (hi - lo) / want, pow = 1, step, k, c, out = [], t;
    if (raw > 1) pow = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    c = [1, 2, 5, 10];
    step = pow * 10;
    for (k = 0; k < c.length; k++) { if (c[k] * pow >= raw) { step = c[k] * pow; break; } }
    for (t = Math.ceil(lo / step) * step; t <= hi; t += step) out.push(t);
    return out;
  }
  // the points of the line (the axis ends and every strike between them, each with the engine's total), markers, tails, ticks
  function chartModel(v, extras) {
    var legs = v.legs, fee = v.fee, r = axisRange(legs, v.S0, v.Sx, extras), ks = E.kinks(legs), xs = [r.lo], i, pts = [], ys = [0], hasP = false, hasL = false, pad, yMin, yMax, strikes = [], tail = E.tailSlope(legs).right, t;
    for (i = 0; i < ks.length; i++) if (ks[i] > r.lo && ks[i] < r.hi) xs.push(ks[i]);
    xs.push(r.hi);
    for (i = 0; i < xs.length; i++) { t = E.positionTotal(legs, fee, xs[i]); pts.push({ S: xs[i], T: t }); ys.push(t); if (t > 0) hasP = true; if (t < 0) hasL = true; }
    for (i = 0; i < ks.length; i++) if (ks[i] >= r.lo && ks[i] <= r.hi) strikes.push(ks[i]);
    yMin = Math.min.apply(null, ys); yMax = Math.max.apply(null, ys);
    pad = Math.max(Math.floor((yMax - yMin) / 10), 100);
    yMin -= pad; yMax += pad;
    return { lo: r.lo, hi: r.hi, top: ks.length ? ks[ks.length - 1] : 0, pts: pts, yMin: yMin, yMax: yMax, strikes: strikes, S0: v.S0, Sx: v.Sx, tail: tail,
      lossEdge: tail < 0, profitEdge: tail > 0, hasProfit: hasP, hasLoss: hasL,
      xticks: niceTicks(r.lo, r.hi, 4), yticks: niceTicks(yMin, yMax, 4) };
  }

  // ---- text pieces (spec section 5, exact strings; brackets filled from the engine) ----
  function joinAnd(a) { return a.length === 1 ? a[0] : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function plural(n, w) { return n === 1 ? w : w + 's'; }
  function maxProfitWhere(ranges) {
    var out = [], i, r;
    for (i = 0; i < ranges.length; i++) {
      r = ranges[i];
      // first range: "for any price from $A to $B" (or "from $A upward", or "at a price of $A"); a later range: "from $C upward" or "from $C to $D"
      if (r.to === null) out.push((i ? '' : 'for any price ') + 'from ' + fmtMoney(r.from) + ' upward');
      else if (r.from === r.to) out.push(i ? 'at a price of ' + fmtMoney(r.from) : 'at a price of ' + fmtMoney(r.from));
      else out.push((i ? '' : 'for any price ') + 'from ' + fmtMoney(r.from) + ' to ' + fmtMoney(r.to));
    }
    return out.join(' and ');
  }
  function maxLossWhere(ranges) {   // WHERE of T7, no dollar figure about the loss itself
    var out = [], i, r;
    for (i = 0; i < ranges.length; i++) {
      r = ranges[i];
      if (r.to === null) out.push('at or above ' + fmtMoney(r.from));
      else if (r.from === r.to) out.push('exactly ' + fmtMoney(r.from));
      else if (r.from === 0) out.push('at or below ' + fmtMoney(r.to));
      else out.push('from ' + fmtMoney(r.from) + ' to ' + fmtMoney(r.to));
    }
    return out.join(' or ') + ' per share';       // "per share" once, at the end
  }
  function flatWords(be) {
    var out = [], i, f;
    if (be.everywhere) return 'at every price';
    for (i = 0; i < be.flat.length; i++) { f = be.flat[i]; out.push(f.to === null ? 'from ' + fmtMoney(f.from) + ' upward' : 'from ' + fmtMoney(f.from) + ' to ' + fmtMoney(f.to)); }
    return out.join(' and ');
  }
  // every pre-filled number carries its tag; bought (long) or sold (short) is in words
  function legSentence(l, tag) {
    var side = l.side > 0 ? 'bought (long)' : 'sold (short)';
    if (l.type === 'share') return (100 * l.n) + ' shares ' + (l.side > 0 ? 'bought' : 'sold') + ' at ' + fmtMoney(l.p) + ' per share (' + tag + ')';
    return l.n + ' ' + l.type + ' ' + plural(l.n, 'contract') + ' ' + side + ' with a strike of ' + fmtMoney(l.K) + ' (' + tag + ') and a premium of ' + fmtMoney(l.p) + ' per share (' + tag + ')';
  }
  // the position summary sentence. Each clause is a whole clause, so the sentence reads correctly when the profit or loss has no limit.
  // ex: E.extremes result; top: highest strike in cents; example: true while any input is still pre-filled.
  function summarySentence(ex, top, beText, example) {
    var P, L, topTxt = fmtMoney(top) + ' per share';
    if (ex.maxProfit.unlimited) P = 'the total keeps rising in this model as the price at expiry rises above ' + topTxt;
    else if (ex.maxProfit.bestIsLoss) P = 'this position makes no profit at expiry, as typed (the smallest loss is ' + fmtMoney(-ex.maxProfit.value) + ')';
    else if (ex.maxProfit.value === 0) P = 'the most this position can make is $0.00';
    else P = 'the most this position can make is ' + fmtMoney(ex.maxProfit.value) + ', ' + maxProfitWhere(ex.maxProfit.where);
    if (ex.maxLoss.unlimited) L = 'the loss has no limit as the price at expiry rises above ' + topTxt;
    else if (ex.maxLoss.noLoss) L = 'it has no loss at expiry, as typed';
    else L = 'the most it can lose is ' + fmtMoney(ex.maxLoss.value);
    return 'At expiry, ' + P + ', ' + L + ', and it breaks even at ' + beText + '. These figures come from the ' + (example ? 'example numbers' : 'numbers typed') + ' above';
  }
  // the one inputs line under the cards. vals: typed text by field name; legs: custom legs; dir 'buy'|'sell'|null; kind 'call'|'put'|null.
  function trimS(s) { return String(s === undefined || s === null ? '' : s).replace(/^\s+|\s+$/g, ''); }
  function inputsLine(sid, tag, vals, dir, kind, legs) {
    var s = strat(sid), parts = [], head = s.name, i, j, l, o, side;
    if (s.dir && dir) head += ', model as ' + (dir === 'sell' ? 'sold (short)' : 'bought (long)');
    if (s.kind && kind) head += ', ' + kind + ' version';
    parts.push(head);
    if (sid === 'custom') {
      for (i = 0; i < legs.length; i++) {
        l = legs[i]; side = l.side === 'long' ? 'bought (long)' : 'sold (short)';
        if (l.type === 'share') parts.push('leg ' + (i + 1) + ' ' + side + ' shares, price $' + trimS(l.p) + ' per share, quantity ' + trimS(l.n) + ' (lots of 100 shares)');
        else parts.push('leg ' + (i + 1) + ' ' + side + ' ' + l.type + ', strike $' + trimS(l.K) + ', premium $' + trimS(l.p) + ' per share, quantity ' + trimS(l.n) + ' (contracts)');
      }
    } else {
      for (j = 0; j < s.f.length; j++) { o = trimS(vals[s.f[j].name]); parts.push(fieldLabel(s.f[j], dir, kind, sid).toLowerCase() + ' ' + (s.f[j].kind === 'n' ? '' : '$') + o); }
    }
    o = trimS(vals.fee); parts.push('fee per contract ' + (o ? '$' + o : 'none typed'));
    o = trimS(vals.S0); if (o) parts.push('price now (per share) $' + o);
    o = trimS(vals.Sx); if (o) parts.push('price at expiry to check $' + o);
    return 'Inputs (' + tag + ') for every figure above: ' + parts.join('; ') + '.';
  }
  var CARD_POINTER = 'From the inputs listed under these cards.';
  // the line shown while the picker is collapsed
  function pickerSummary(id) { var s = strat(id); return s ? 'Strategy: ' + s.name : ''; }
  // v: a successful E.validate result. example: true while any input is still a pre-filled example.
  function analyse(v, example) {
    var legs = v.legs, fee = v.fee, ex = E.extremes(legs, fee), be = E.breakEvens(legs, fee), net = E.netPremium(legs), cost = E.costToOpen(legs, fee),
      mR = E.tailSlope(legs).right, ks = E.kinks(legs), top = ks.length ? ks[ks.length - 1] : 0, tag = example ? 'example' : 'typed',
      R = fmtMoney(Math.abs(mR) * 100), c1, c2, maxP, maxL, beMain, beText, beCard, netSentence, netCard, i, m = [], parts = [], wrong = [], hasLong = false, hasShort = false, hasShare = false, legTexts = [], out = {}, T0, nOpt = 0;
    c1 = 'No fixed top in this model: the total rises ' + R + ' for each $1.00 the price at expiry is above ' + fmtMoney(top) + ' per share.';   // C1
    c2 = 'No limit: the loss grows ' + R + ' for each $1.00 the price at expiry is above ' + fmtMoney(top) + ' per share.';                       // C2
    if (ex.maxProfit.unlimited) maxP = c1;
    else if (ex.maxProfit.bestIsLoss) maxP = 'no profit at expiry in this model, as typed. The smallest loss is ' + fmtMoney(-ex.maxProfit.value);
    else if (ex.maxProfit.value === 0) maxP = 'no profit above $0.00 at expiry, as typed';
    else maxP = fmtMoney(ex.maxProfit.value) + ', ' + maxProfitWhere(ex.maxProfit.where);
    if (ex.maxLoss.unlimited) maxL = c2;
    else if (ex.maxLoss.noLoss) maxL = '$0.00 (as typed, no loss at expiry)';                                                                       // C3
    else maxL = fmtMoney(ex.maxLoss.value);
    for (i = 0; i < be.points.length; i++) m.push(fmtMoney(be.points[i].cents));
    beMain = m.length ? joinAnd(m) + ' per share' : '';
    if (be.flat.length || be.everywhere) {
      beText = beMain ? beMain + '; the total is also $0.00 ' + flatWords(be) : 'no single price (the total is $0.00 ' + flatWords(be) + ')';
    } else if (m.length) beText = beMain;
    else { T0 = E.positionTotal(legs, fee, 0); beText = 'no price (the position is ' + (T0 > 0 ? 'above' : 'below') + ' zero at every price)'; }
    beCard = m.length ? beText + ', rounded to the cent' : beText;
    if (net > 0) { netCard = fmtMoney(net) + ' before fees'; netSentence = 'Opening it gives a net credit of ' + fmtMoney(net) + ': more premium received than paid'; }
    else if (net < 0) { netCard = fmtMoney(-net) + ' before fees'; netSentence = 'Opening it costs a net debit of ' + fmtMoney(-net) + ': more premium paid than received'; }
    else { netCard = '$0.00 before fees'; netSentence = 'Opening it gives a net of $0.00: premium received equals premium paid'; }
    out.netTitle = net > 0 ? 'Net credit received' : (net < 0 ? 'Net debit paid' : 'Net of $0.00');
    if (cost.fees > 0) netSentence += ' before fees of ' + fmtMoney(cost.fees);
    for (i = 0; i < legs.length; i++) {
      legTexts.push(legSentence(legs[i], tag));
      if (legs[i].type === 'share') hasShare = true; else { nOpt++; if (legs[i].side > 0) hasLong = true; else hasShort = true; }
    }
    if (net !== 0 || nOpt) parts.push('Options: ' + (net > 0 ? fmtMoney(net) + ' received' : (net < 0 ? fmtMoney(-net) + ' paid' : '$0.00')));
    if (cost.shares !== 0) parts.push('Shares: ' + fmtMoney(Math.abs(cost.shares)) + (cost.shares > 0 ? ' paid' : ' received'));
    parts.push('Fees: ' + fmtMoney(cost.fees));
    out.maxProfit = maxP; out.maxLoss = maxL; out.breakEven = beText; out.breakEvenCard = beCard; out.net = netCard; out.netSentence = netSentence;
    out.costParts = parts; out.costTotal = cost.paid > 0 ? fmtMoney(cost.paid) + ' paid, fees included' : (cost.paid < 0 ? fmtMoney(-cost.paid) + ' received, after fees' : '$0.00, fees included');
    out.legSentences = legTexts;
    out.box = 'In this model: ' + joinAnd(legTexts) + '. ' + netSentence + '. ' + summarySentence(ex, top, beText, example) + ' and leave out fees to close or exercise, taxes, dividends, early exercise, the cash a firm may require, and the value before expiry. ' +
      'This describes the position as typed. It says nothing about where any price may go, and it is not advice to buy, sell or use any option.';
    // what can go wrong, in the spec's order
    if (ex.maxLoss.unlimited) wrong.push('The loss has no limit: it grows with every dollar the price at expiry ends above ' + fmtMoney(top) + '.');   // T7
    else if (!ex.maxLoss.noLoss) wrong.push('The Maximum loss card shows the most this position can lose at expiry. It happens if the price at expiry is ' + maxLossWhere(ex.maxLoss.where) + '.');   // no loss: not shown
    if (hasLong) wrong.push('The money paid for an option can all be lost if it ends with no value at expiry.');
    if (hasShort) wrong.push('The seller of an option can lose far more than the money received for it. The seller of a call has no limit on the loss. The seller of a put can lose up to the strike less the premium, for each share.');   // S2
    if (hasLong && hasShort && !hasShare) wrong.push('The long option limits the loss only up to its strike; the width between the strikes is the most the pair can pay out at expiry.');
    if (hasShare) wrong.push('The shares can lose value too; the model counts the shares at the price typed as bought.');
    wrong.push('This model shows expiry only. Before expiry, and with fees, taxes and gaps between real buy and sell prices, results differ. A seller can be assigned before expiry (early exercise), which means having to buy or sell the shares then, and a firm can require a seller to keep money set aside (margin). The model leaves all of these out.');   // S7
    out.wrong = wrong;
    out.cash = null;
    if (v.strategy === 'cashSecuredPut') {
      out.cash = '$' + toPlain(legs[0].K) + ' (' + tag + ') × 100 shares × ' + legs[0].n + ' ' + plural(legs[0].n, 'contract') + ' = ' + fmtMoney(E.cashToSecure(legs)) +
        '. This is arithmetic only; a firm\'s own rules for money set aside are not modelled.';
    }
    out.check = null;
    if (v.Sx !== null) {
      T0 = E.positionTotal(legs, fee, v.Sx);
      out.check = 'If the price at expiry is ' + fmtMoney(v.Sx) + ' per share (' + tag + '): ' + totalWords(T0) + ' for the whole position, with the legs and fees shown above.';   // A2
    }
    out.notes = [];
    for (i = 0; i < v.notes.length; i++) {
      if (v.notes[i] === 'cannotLose') out.notes.push('With these typed premiums, the total at expiry is $0.00 or more at every price. Premiums like these are not normally seen in a real market. Check the numbers you typed.');   // A1
      if (v.notes[i] === 'unequalWings') out.notes.push('The wings are not the same width, so the two sides of the shape differ.');
    }
    out.name = nameSentence(v.strategy, maxL);
    return out;
  }
  // N1 to N3 (tool forms). N2 and N3 need the maximum loss text, so they exist only with a result.
  function nameSentence(id, maxL) {
    if (id === 'coveredCall') return 'In "covered call", "covered" means the shares are held for the call that is sold. It does not mean the loss is covered: the shares can lose value.';
    if (id === 'protectivePut' && maxL) return '"Protective put" is a common name. It does not mean the position cannot lose money: the put has a cost, and the most lost here is ' + maxL + '.';
    if (id === 'cashSecuredPut' && maxL) return 'In "cash-secured put", "cash-secured" means cash equal to the strike for the shares is counted as set aside. It does not mean the position cannot lose money: the loss can be up to ' + maxL + '.';
    return '';
  }
  // the text alternative of the chart
  function altText(m) {
    var s = 'The line shows the total for the whole position at expiry. ', i, a, b;
    for (i = 0; i + 1 < m.pts.length; i++) {
      a = m.pts[i]; b = m.pts[i + 1];
      s += 'From ' + fmtMoney(a.S) + ' to ' + fmtMoney(b.S) + ' per share' + (a.T === b.T ? ' the line is flat at ' + totalWords(a.T) + '. ' : ' the line goes from ' + totalWords(a.T) + ' to ' + totalWords(b.T) + '. ');
    }
    s += 'Right edge: above ' + fmtMoney(m.top) + ' per share ' + (m.profitEdge ? 'the total keeps rising in this model.' : (m.lossEdge ? 'the loss keeps growing, with no limit.' : 'the line stays flat.'));
    return s;
  }
  // rows of "Show the numbers behind the graph": 0, the strikes, the break-evens, the axis ends (and the price to check)
  function tableRows(v, m) {
    var set = [0, m.lo, m.hi], ks = E.kinks(v.legs), be = E.breakEvens(v.legs, v.fee), i, rows = [], seen = {}, S, T;
    for (i = 0; i < ks.length; i++) set.push(ks[i]);
    for (i = 0; i < be.points.length; i++) set.push(be.points[i].cents);
    if (v.Sx !== null) set.push(v.Sx);
    set.sort(function (a, b) { return a - b; });
    for (i = 0; i < set.length; i++) {
      S = set[i];
      if (seen[S]) continue;
      seen[S] = true;
      T = E.positionTotal(v.legs, v.fee, S);
      rows.push({ S: S, price: fmtMoney(S), total: T > 0 ? 'profit ' + fmtMoney(T) : (T < 0 ? 'loss ' + fmtMoney(-T) : '$0.00') });
    }
    return rows;
  }

  // ---- the chart as svg nodes (w, h in pixels). Built with createElementNS and setAttribute; every text goes in with textContent. No HTML string is parsed. ----
  var SVGNS = 'http://www.w3.org/2000/svg';

  // ---- label placement helpers (pure, no DOM). Text widths are estimated at 0.55 x the font size per character. ----
  var AXFS = 13;   // font size of axis ticks, strike labels, axis titles and marker labels: matches .om-svg .axis in modeler.css
  function textWidth(text, fs) { return Number((String(text).length * fs * 0.55).toFixed(1)); }
  // the box (x, y = top, w, h) that a text occupies; anchor is 'start', 'middle' or 'end'; base is the text baseline y
  function labelBox(x, base, anchor, text, fs) {
    var w = textWidth(text, fs);
    return { x: Number((anchor === 'end' ? x - w : (anchor === 'middle' ? x - w / 2 : x)).toFixed(1)), y: base - fs, w: w, h: fs + 3 };
  }
  // true only when the two boxes share area (touching edges do not count)
  function boxesOverlap(a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }
  // Place boxes one after the other. A box that overlaps a fixed box or an earlier placed box moves by its own height (dir +1 down, -1 up), repeated until clear (at most 8 moves).
  function placeBoxes(fixed, movers, dir) {
    var all = fixed.slice(), out = [], i, j, b, n, hit;
    for (i = 0; i < movers.length; i++) {
      b = { x: movers[i].x, y: movers[i].y, w: movers[i].w, h: movers[i].h };
      for (n = 0; n < 8; n++) {
        hit = false;
        for (j = 0; j < all.length; j++) { if (boxesOverlap(b, all[j])) { hit = true; break; } }
        if (!hit) break;
        b.y += dir * b.h;
      }
      all.push(b); out.push(b);
    }
    return out;
  }
  // true when the polyline sp (array of {x, y} in screen units) passes through the box grown by pad on every side (segment against rectangle clipping)
  function lineHitsBox(sp, box, pad) {
    var bx = box.x - pad, by = box.y - pad, bw = box.w + 2 * pad, bh = box.h + 2 * pad, k, j, x1, y1, dx, dy, t0, t1, pp, qq, r, out;
    for (k = 0; k + 1 < sp.length; k++) {
      x1 = sp[k].x; y1 = sp[k].y; dx = sp[k + 1].x - x1; dy = sp[k + 1].y - y1; t0 = 0; t1 = 1; out = false;
      pp = [-dx, dx, -dy, dy]; qq = [x1 - bx, bx + bw - x1, y1 - by, by + bh - y1];
      for (j = 0; j < 4 && !out; j++) {
        if (pp[j] === 0) { if (qq[j] < 0) out = true; }
        else {
          r = qq[j] / pp[j];
          if (pp[j] < 0) { if (r > t1) out = true; else if (r > t0) t0 = r; }
          else { if (r < t0) out = true; else if (r < t1) t1 = r; }
        }
      }
      if (!out) return true;
    }
    return false;
  }
  // true when the box overlaps any box of the list
  function hitsAny(list, b) { var k; for (k = 0; k < list.length; k++) { if (boxesOverlap(b, list[k])) return true; } return false; }
  // left margin: the y-axis title (13 px, centred at x = 11, so it ends by x = 18) + 4 gap + the longest tick label + 6 to the axis
  function leftMargin(labels) {
    var i, mx = 0;
    for (i = 0; i < labels.length; i++) { if (textWidth(labels[i], AXFS) > mx) mx = textWidth(labels[i], AXFS); }
    return Math.ceil(22 + mx + 6);
  }
  // which side of a break-even marker its label goes: away from the loss part of the line, flipped when it would leave the plot. Returns 'start' (right of the marker) or 'end' (left).
  function beSide(pts, S, x, wText, xMin, xMax) {
    var i, a, b, side = 'start';
    for (i = 0; i + 1 < pts.length; i++) {
      a = pts[i]; b = pts[i + 1];
      if (S >= a.S && S <= b.S && a.T !== b.T) { side = (b.T - a.T) / (b.S - a.S) > 0 ? 'start' : 'end'; break; }
    }
    if (side === 'start' && x + 9 + wText > xMax) side = 'end';
    else if (side === 'end' && x - 9 - wText < xMin) side = 'start';
    return side;
  }

  // extra rows of strike labels that need room above the plot: each row is one label box (16 units) higher than the first row at firstY
  function topRows(minY, firstY) { return minY >= firstY ? 0 : Math.ceil((firstY - minY) / 16); }
  function chartNodes(doc, m, w, h, marker, extraRows) {
    var ylabs = [], ml, mr = 14, rowsX = extraRows || 0, mt = 38 + 16 * rowsX, mb = 50, pw, ph = h - 38 - mb, i, p, d, x, y, y0, last = m.pts[m.pts.length - 1], line = '';
    h = h + 16 * rowsX;   // the extra strike-label rows add to the total height; the plot height ph is unchanged
    for (i = 0; i < m.yticks.length; i++) ylabs.push(fmtMoney(m.yticks[i]));
    ml = leftMargin(ylabs); pw = w - ml - mr;
    var yLo = m.yMin;   // bottom of the value axis; lowered below when "Loss at expiry" needs room under its line
    function X(S) { return Number((ml + (S - m.lo) / (m.hi - m.lo) * pw).toFixed(1)); }
    function Y(T) { return Number((mt + (m.yMax - T) / (m.yMax - yLo) * ph).toFixed(1)); }
    // the screen y of the payoff line at screen x (straight between its points)
    function lineYat(px) {
      var k, a, b, xa, xb;
      for (k = 0; k + 1 < m.pts.length; k++) {
        a = m.pts[k]; b = m.pts[k + 1]; xa = X(a.S); xb = X(b.S);
        if (px >= xa && px <= xb) return xb === xa ? Y(a.T) : Y(a.T) + (Y(b.T) - Y(a.T)) * (px - xa) / (xb - xa);
      }
      return Y(m.pts[m.pts.length - 1].T);
    }
    // the lowest the line gets on screen between two screen x values
    function lowestLine(xa, xb) {
      var k, v = Math.max(lineYat(xa), lineYat(xb)), px;
      for (k = 0; k < m.pts.length; k++) { px = X(m.pts[k].S); if (px > xa && px < xb) v = Math.max(v, Y(m.pts[k].T)); }
      return v;
    }
    // "Loss at expiry" (14 px) sits under the line, its top 8 px clear of the line edge (3 px line, so 1.5 px half width): baseline = anchor + 1.5 + 8 + 14
    var lossX = ml + 8, lossW = textWidth('Loss at expiry', 14), lossBase = 0, nn;
    function lossBaseNow() { return Math.ceil(Math.max(lowestLine(lossX, lossX + lossW), Y(0)) + 1.5 + 8 + 14); }
    if (m.hasLoss) {
      for (nn = 0; nn < 8 && lossBaseNow() > mt + ph - 3; nn++) yLo -= (m.yMax - yLo) * 0.1;
      lossBase = lossBaseNow();
    }
    function node(parent, name, attrs, text) {
      var e = doc.createElementNS(SVGNS, name), k;
      for (k in attrs) { if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, String(attrs[k])); }
      if (text !== undefined) e.textContent = text;
      parent.appendChild(e);
      return e;
    }
    function ln(parent, cls, x1, y1, x2, y2) { return node(parent, 'line', { 'class': cls, x1: x1, y1: y1, x2: x2, y2: y2 }); }
    function tx(parent, cls, x2, y2, anchor, text) { var a = { 'class': cls, x: x2, y: y2 }; if (anchor) a['text-anchor'] = anchor; return node(parent, 'text', a, text); }
    var svg = doc.createElementNS(SVGNS, 'svg'), defs, pat, cp, cl;
    y0 = Y(0);
    var fixed = [];   // boxes of texts that stay where they are; strike and break-even labels are placed clear of them
    svg.setAttribute('class', 'om-svg'); svg.setAttribute('width', String(w)); svg.setAttribute('height', String(h)); svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    defs = node(svg, 'defs', {});
    pat = node(defs, 'pattern', { id: 'om-hatch', width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
    ln(pat, 'hatch', 0, 0, 0, 7);
    cp = node(defs, 'clipPath', { id: 'om-clip-p' }); node(cp, 'rect', { x: ml, y: mt, width: pw, height: Math.max(0, y0 - mt).toFixed(1) });
    cl = node(defs, 'clipPath', { id: 'om-clip-l' }); node(cl, 'rect', { x: ml, y: y0, width: pw, height: Math.max(0, mt + ph - y0).toFixed(1) });
    for (i = 0; i < m.yticks.length; i++) {
      y = Y(m.yticks[i]);
      ln(svg, 'grid', ml, y, ml + pw, y); tx(svg, 'axis', ml - 6, y + 4, 'end', ylabs[i]); fixed.push(labelBox(ml - 6, y + 4, 'end', ylabs[i], AXFS));
    }
    for (i = 0; i < m.xticks.length; i++) {
      x = X(m.xticks[i]);
      ln(svg, 'tick', x, mt + ph, x, mt + ph + 4); tx(svg, 'axis', x, mt + ph + 17, 'middle', fmtMoney(m.xticks[i])); fixed.push(labelBox(x, mt + ph + 17, 'middle', fmtMoney(m.xticks[i]), AXFS));
    }
    for (i = 0; i < m.pts.length; i++) { p = m.pts[i]; line += (i ? 'L' : 'M') + X(p.S) + ' ' + Y(p.T) + ' '; }
    d = line + 'L' + X(last.S) + ' ' + y0 + ' L' + X(m.pts[0].S) + ' ' + y0 + ' Z';
    node(svg, 'path', { 'class': 'zone-p', 'clip-path': 'url(#om-clip-p)', d: d });
    node(svg, 'path', { 'class': 'zone-l', 'clip-path': 'url(#om-clip-l)', d: d });
    node(svg, 'path', { 'class': 'zone-h', 'clip-path': 'url(#om-clip-l)', d: d });
    ln(svg, 'base', ml, y0, ml + pw, y0);
    var sp = [];   // the payoff line in screen units, for checking that no label sits on it
    for (i = 0; i < m.pts.length; i++) sp.push({ x: X(m.pts[i].S), y: Y(m.pts[i].T) });
    if (m.hasProfit) {
      // "Profit at expiry" (14 px): the top-left corner first, then lower bands and the top-right corner, the first place the line does not touch
      var pfx = ml + 8, pfy = mt + 16, pfa = 'start', pfb = null, pfc, pfr, pfs, pfw = textWidth('Profit at expiry', 14), pfn = 0;
      for (pfr = 0; pfr < 12 && !pfb; pfr++) {
        for (pfs = 0; pfs < 2 && !pfb; pfs++) {
          pfc = labelBox(pfs ? ml + pw - 8 : ml + 8, mt + 16 + pfr * 17, pfs ? 'end' : 'start', 'Profit at expiry', 14);
          if (pfc.y + pfc.h <= mt + ph && !lineHitsBox(sp, pfc, 3) && !hitsAny(fixed, pfc)) { pfb = pfc; pfx = pfs ? ml + pw - 8 : ml + 8; pfy = mt + 16 + pfr * 17; pfa = pfs ? 'end' : 'start'; }
        }
      }
      tx(svg, 'zl', pfx, pfy, pfa === 'end' ? 'end' : '', 'Profit at expiry'); fixed.push(pfb || labelBox(pfx, pfy, pfa, 'Profit at expiry', 14));
    }
    if (m.hasLoss) { tx(svg, 'zl', lossX, lossBase, '', 'Loss at expiry'); fixed.push(labelBox(lossX, lossBase, 'start', 'Loss at expiry', 14)); }
    for (i = 0; i < m.strikes.length; i++) { x = X(m.strikes[i]); ln(svg, 'strike', x, mt, x, mt + ph); }
    if (m.S0 !== null && m.S0 !== undefined && m.S0 >= m.lo && m.S0 <= m.hi) { x = X(m.S0); ln(svg, 'now', x, mt, x, mt + ph); tx(svg, 'axis', x + 4, mt + 28, '', 'Price now'); fixed.push(labelBox(x + 4, mt + 28, 'start', 'Price now', AXFS)); }
    if (m.Sx !== null && m.Sx !== undefined && m.Sx >= m.lo && m.Sx <= m.hi) { x = X(m.Sx); ln(svg, 'chk', x, mt, x, mt + ph); tx(svg, 'axis', x + 4, mt + ph - 22, '', 'Price to check'); fixed.push(labelBox(x + 4, mt + ph - 22, 'start', 'Price to check', AXFS)); }
    node(svg, 'path', { 'class': 'ln', d: line });
    if (m.profitEdge || m.lossEdge) {
      x = X(last.S); y = Y(last.T);
      ln(svg, 'edge', x, y - 9, x, y + 9);
      tx(svg, 'edgetxt', x - 8, m.profitEdge ? y - 14 : y + 24, 'end', m.profitEdge ? 'Keeps rising in this model' : 'Loss keeps growing: no limit');
      fixed.push(labelBox(x - 8, m.profitEdge ? y - 14 : y + 24, 'end', m.profitEdge ? 'Keeps rising in this model' : 'Loss keeps growing: no limit', 14));
    }
    if (marker && marker.S >= m.lo && marker.S <= m.hi) {
      x = X(marker.S); y = Y(marker.T);
      ln(svg, 'mk', x, mt, x, mt + ph); node(svg, 'circle', { 'class': 'mkdot', cx: x, cy: y, r: 5 });
      fixed.push({ x: x - 6, y: y - 6, w: 12, h: 12 });
    }
    tx(svg, 'axis', ml + pw / 2, h - 6, 'middle', 'Price at expiry (per share)');
    node(svg, 'text', { 'class': 'axis', x: 11, y: mt + ph / 2, 'text-anchor': 'middle', transform: 'rotate(-90 11 ' + (mt + ph / 2) + ')' }, 'Profit or loss (dollars)');
    // break-even labels (13 px, primary text colour): each goes in the free quarter beside its marker, the quarter the payoff line does not cross.
    // Where the line rises through the marker that is above the zero line on the left (or below it on the right); where it falls, above on the right (or below on the left).
    // Above the zero line is tried first. Two markers therefore get labels on different sides, and a label that would hit another box moves up (or down) by its own height. Circles are fixed boxes.
    var bes = m.be || [], beFs = 13, beTxt = [], beSides = [], bePlaced = [], availAbove = y0 - 25 >= mt, availBelow = y0 + 25 <= mt + ph, rising, ww, opts, o, c, fit, ok2, bb, up;
    function beRising(S) {
      var k, a, b;
      for (k = 0; k + 1 < m.pts.length; k++) { a = m.pts[k]; b = m.pts[k + 1]; if (S >= a.S && S <= b.S && a.T !== b.T) return (b.T - a.T) / (b.S - a.S) > 0; }
      return true;
    }
    for (i = 0; i < bes.length; i++) fixed.push({ x: X(bes[i]) - 6, y: y0 - 6, w: 12, h: 12 });
    for (i = 0; i < bes.length; i++) {
      beTxt.push('Break-even ' + fmtMoney(bes[i])); x = X(bes[i]); ww = textWidth(beTxt[i], beFs); rising = beRising(bes[i]);
      opts = [{ sd: rising ? 'end' : 'start', up: true }, { sd: rising ? 'start' : 'end', up: false }];
      if (!availAbove && availBelow) opts.reverse();
      c = null; fit = null;
      for (o = 0; o < opts.length; o++) {
        ok2 = opts[o].sd === 'start' ? x + 9 + ww <= w - 4 : x - 9 - ww >= ml;
        if (ok2 && (opts[o].up ? availAbove : availBelow)) { c = opts[o]; break; }
        if (ok2 && !fit) fit = opts[o];
      }
      if (!c) c = fit || opts[0];
      // first choice as before; but a label that would sit on the payoff line or on another label tries the other sides, then stacks one box higher or lower, beside the same marker
      var cands = [opts[0], opts[1], { sd: opts[0].sd === 'start' ? 'end' : 'start', up: opts[0].up }, { sd: opts[1].sd === 'start' ? 'end' : 'start', up: opts[1].up }], cs, ci, cb, found = null;
      if (c !== opts[0]) cands.unshift(c);
      for (cs = 0; cs < 3 && !found; cs++) {
        for (ci = 0; ci < cands.length && !found; ci++) {
          cb = labelBox(cands[ci].sd === 'start' ? x + 9 : x - 9, (cands[ci].up ? y0 - 12 : y0 + 22) + (cands[ci].up ? -1 : 1) * cs * (beFs + 3), cands[ci].sd, beTxt[i], beFs);
          if (cb.x >= ml && cb.x + cb.w <= w - 4 && cb.y >= mt && cb.y + cb.h <= mt + ph && !lineHitsBox(sp, cb, 3) && !hitsAny(fixed, cb) && !hitsAny(bePlaced, cb)) { found = { c: cands[ci], bb: cb }; }
        }
      }
      if (found) { c = found.c; bb = found.bb; }
      else {
        up = c.up;
        bb = labelBox(c.sd === 'start' ? x + 9 : x - 9, up ? y0 - 12 : y0 + 22, c.sd, beTxt[i], beFs);
        bb = placeBoxes(fixed.concat(bePlaced), [bb], up ? -1 : 1)[0];
      }
      bePlaced.push(bb); beSides.push(c.sd);
    }
    for (i = 0; i < bes.length; i++) {
      node(svg, 'circle', { 'class': 'be', cx: X(bes[i]), cy: y0, r: 5 });
      tx(svg, 'betxt', beSides[i] === 'start' ? bePlaced[i].x : bePlaced[i].x + bePlaced[i].w, bePlaced[i].y + beFs, beSides[i], beTxt[i]);
    }
    // strike labels along the top: a label that touches a fixed box or an earlier label moves up by its own height; kept inside the width
    var skBoxes = [], skTxt = [];
    for (i = 0; i < m.strikes.length; i++) {
      skTxt.push('Strike ' + fmtMoney(m.strikes[i])); x = X(m.strikes[i]);
      p = textWidth(skTxt[i], AXFS); x = Math.min(Math.max(x, p / 2 + 2), w - p / 2 - 2);
      skBoxes.push(labelBox(x, mt - 6, 'middle', skTxt[i], AXFS));
    }
    skBoxes = placeBoxes(fixed.concat(bePlaced), skBoxes, -1);
    // a strike label pushed above its first row (by a break-even label or another strike) needs room: draw again with one more top row per box of height
    var topY = mt - 6 - AXFS, needRows = 0;
    for (i = 0; i < skBoxes.length; i++) needRows = Math.max(needRows, topRows(skBoxes[i].y, topY));
    if (needRows > 0 && rowsX === 0) return chartNodes(doc, m, w, h, marker, needRows);
    for (i = 0; i < m.strikes.length; i++) tx(svg, 'axis', skBoxes[i].x + skBoxes[i].w / 2, skBoxes[i].y + AXFS, 'middle', skTxt[i]);
    return svg;
  }

  // ---- the page ----
  function start(doc, win) {
    var st = { strategy: null, dir: null, kind: null, vals: {}, ex: {}, touched: {}, legs: [], hadResults: false, marker: null, cur: null }, $ = function (id) { return doc.getElementById(id); };
    function h(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = text; return e; }
    function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); }
    function blankLeg() { return { type: '', side: '', K: '', p: '', n: '', ex: {} }; }

    // picker
    var pick = $('om-picker-list'), g = '', i, sdef, lab, inp;
    for (i = 0; i < STRAT.length; i++) {
      sdef = STRAT[i];
      if (sdef.group !== g) { g = sdef.group; pick.appendChild(h('p', 'om-grp', g)); }
      lab = h('label', 'om-opt'); inp = h('input'); inp.type = 'radio'; inp.name = 'strategy'; inp.value = sdef.id;
      lab.appendChild(inp); lab.appendChild(h('span', 'om-optn', sdef.name)); lab.appendChild(doc.createTextNode(': ')); lab.appendChild(h('span', 'om-optc', sdef.line));
      pick.appendChild(lab);
    }
    pick.addEventListener('change', function (e) { if (e.target && e.target.name === 'strategy') choose(e.target.value); });

    // Picker collapse: after the visitor's own choice the list folds to "Strategy: [name]" with a button. First load: list open, nothing chosen.
    var pList = pick, pSum = $('om-picker-sum'), pName = $('om-picker-name'), pBtn = $('om-picker-toggle');
    function collapsePicker() {
      pList.hidden = true; pSum.hidden = false; pName.textContent = pickerSummary(st.strategy);
      pBtn.textContent = 'Change strategy'; pBtn.setAttribute('aria-expanded', 'false');
    }
    function openPicker() {
      var on = pList.querySelector('input:checked') || pList.querySelector('input');
      pList.hidden = false; pSum.hidden = false; pBtn.textContent = 'Close the list'; pBtn.setAttribute('aria-expanded', 'true');
      if (on) on.focus();
    }
    pBtn.addEventListener('click', function () { if (pList.hidden) openPicker(); else { collapsePicker(); pBtn.focus(); } });
    function focusFirstInput() { var f = doc.querySelector('#om-inputs input, #om-inputs select, #om-inputs button'); if (f) f.focus(); }
    function choose(id) {
      st.strategy = id; st.dir = null; st.kind = null; st.vals = {}; st.ex = {}; st.touched = {}; st.marker = null; st.legs = id === 'custom' ? [blankLeg()] : [];
      renderInputs(); update(); collapsePicker(); focusFirstInput();
    }
    function seg(labelA, labelB, onPick, heading, helper, idp) {
      var box = h('div', 'om-seggrp'), hd = h('p', 'om-seghd', heading), row = h('div', 'om-seg'), a = h('button', '', labelA), b = h('button', '', labelB);
      hd.id = idp + '-hd'; a.type = 'button'; b.type = 'button'; a.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-pressed', 'false');
      row.setAttribute('role', 'group'); row.setAttribute('aria-labelledby', hd.id);
      a.addEventListener('click', function () { a.setAttribute('aria-pressed', 'true'); b.setAttribute('aria-pressed', 'false'); onPick(0); });
      b.addEventListener('click', function () { b.setAttribute('aria-pressed', 'true'); a.setAttribute('aria-pressed', 'false'); onPick(1); });
      row.appendChild(a); row.appendChild(b); box.appendChild(hd); if (helper) box.appendChild(h('p', 'om-help', helper)); box.appendChild(row);
      return box;
    }
    function ready() { var s = strat(st.strategy); return s && (!s.dir || st.dir) && (!s.kind || st.kind); }

    function renderInputs() {
      var box = $('om-inputs'), s = strat(st.strategy), btn, more, sum, body, k;
      clear(box);
      $('om-name').textContent = s ? nameSentence(s.id, '') : '';
      clear($('om-learn'));
      if (!s) return;
      if (learnHref(s.id)) { var la = h('a', '', 'Learn about this strategy'); la.href = learnHref(s.id); $('om-learn').appendChild(la); }
      if (s.dir) box.appendChild(seg('Bought (long)', 'Sold (short)', function (k2) { st.dir = k2 ? 'sell' : 'buy'; renderFields(); update(); }, 'Model as', 'This chooses which form is modelled. It says nothing about any trade.', 'om-dir'));
      if (s.kind) box.appendChild(seg('Call version', 'Put version', function (k2) { st.kind = k2 ? 'put' : 'call'; renderFields(); update(); }, 'Version', '', 'om-kind'));
      box.appendChild(h('div', 'om-fields')); box.lastChild.id = 'om-fields';
      btn = h('button', 'om-pill', 'Fill with example numbers'); btn.type = 'button'; btn.id = 'om-fill'; btn.hidden = true; btn.addEventListener('click', fill); box.appendChild(btn);
      k = h('p', 'om-note'); k.id = 'om-filled'; k.setAttribute('aria-live', 'polite'); box.appendChild(k);
      more = h('details', 'om-more'); more.id = 'om-more'; more.hidden = true; sum = h('summary', '', 'Show more: fees, price now, price to check'); more.appendChild(sum);
      more.addEventListener('toggle', function () { sum.textContent = more.open ? 'Show less' : 'Show more: fees, price now, price to check'; }); body = h('div', 'om-fields'); body.id = 'om-optional'; more.appendChild(body); box.appendChild(more);
      box.appendChild(h('p', 'om-note', 'You type every number. This tool does not look up prices, hold a ticker or connect to any market. The numbers you type are not stored or sent anywhere: the calculation runs in your browser.'));
      box.appendChild(h('p', 'om-note', 'In this tool, one contract is for 100 shares.'));
      renderFields();
    }
    // money fields show "$" before the box; strike, premium and price fields show "per share" after it; quantity shows neither
    function fieldEl(id, name, label, value, exFlag, onInput, ariaLabel) {
      var w = h('div', 'om-field'), l = h('label', '', label), ctl = h('div', 'om-ctl'), i2 = h('input'), badge = h('span', 'om-ex', 'Example');
      l.setAttribute('for', id); i2.id = id; i2.type = 'text'; i2.setAttribute('inputmode', 'decimal'); i2.setAttribute('autocomplete', 'off'); i2.value = value;
      if (ariaLabel) i2.setAttribute('aria-label', ariaLabel);
      badge.hidden = !exFlag;
      i2.addEventListener('input', function () { badge.hidden = true; onInput(i2.value); update(); });
      i2.addEventListener('blur', function () { st.touched[id] = true; update(); });
      if (name !== 'n') ctl.appendChild(h('span', 'om-unit', '$'));
      ctl.appendChild(i2);
      if (name !== 'n' && name !== 'fee') ctl.appendChild(h('span', 'om-unit', 'per share'));
      ctl.appendChild(badge); w.appendChild(l); w.appendChild(ctl);
      if (name === 'Sx') i2.addEventListener('keydown', function (e) {
        var c = E.parseCents(i2.value), step = e.shiftKey ? 100 : 1;
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        if (c === null) c = 0;
        c = e.key === 'ArrowUp' ? c + step : Math.max(1, c - step);
        i2.value = toPlain(c); onInput(i2.value); badge.hidden = true; update();
      });
      return w;
    }
    function setVal(name) { return function (v) { st.vals[name] = v; st.ex[name] = false; }; }
    function renderFields() {
      var box = $('om-fields'), opt = $('om-optional'), s = strat(st.strategy), i2, j, leg, row, ok = ready();
      if (!box) return;
      clear(box); clear(opt);
      $('om-fill').hidden = !ok; $('om-more').hidden = !ok;
      if (!ok) return;
      if (s.id === 'custom') {
        for (i2 = 0; i2 < st.legs.length; i2++) box.appendChild(legEl(i2));
        if (st.legs.length < 4) { row = h('button', 'om-pill', 'Add a leg'); row.type = 'button'; row.addEventListener('click', function () { st.legs.push(blankLeg()); renderFields(); update(); }); box.appendChild(row); } else box.appendChild(h('p', 'om-help', 'Up to 4 legs.'));
      } else {
        for (i2 = 0; i2 < s.f.length; i2++) { j = s.f[i2]; box.appendChild(fieldEl('f-' + j.name, j.name, fieldLabel(j, st.dir, st.kind, s.id), st.vals[j.name] || '', !!st.ex[j.name], setVal(j.name))); }
      }
      for (i2 = 0; i2 < OPTIONAL.length; i2++) opt.appendChild(fieldEl('f-' + OPTIONAL[i2][0], OPTIONAL[i2][0], optLabel(OPTIONAL[i2][0]), st.vals[OPTIONAL[i2][0]] || '', false, setVal(OPTIONAL[i2][0])));
    }
    function legEl(i2) {
      var leg = st.legs[i2], w = h('div', 'om-leg'), r1 = h('div', 'om-legrow'), t = h('select'), sd = h('select'), tl = h('label', '', 'Leg ' + (i2 + 1) + ': type'), sl = h('label', '', 'Leg ' + (i2 + 1) + ': side'), opts, x, rm;
      t.id = 'c' + i2 + '-type'; sd.id = 'c' + i2 + '-side'; tl.setAttribute('for', t.id); sl.setAttribute('for', sd.id);
      opts = [['', ''], ['call', 'Call'], ['put', 'Put'], ['share', 'Shares']];
      for (x = 0; x < opts.length; x++) { var o = h('option', '', opts[x][1]); o.value = opts[x][0]; t.appendChild(o); }
      opts = [['', ''], ['long', 'Bought (long)'], ['short', 'Sold (short)']];
      for (x = 0; x < opts.length; x++) { var o2 = h('option', '', opts[x][1]); o2.value = opts[x][0]; sd.appendChild(o2); }
      t.value = leg.type; sd.value = leg.side;
      t.addEventListener('change', function () { leg.type = t.value; renderFields(); update(); });
      sd.addEventListener('change', function () { leg.side = sd.value; update(); });
      var wt = h('div', 'om-field'), ws = h('div', 'om-field'); wt.appendChild(tl); wt.appendChild(t); ws.appendChild(sl); ws.appendChild(sd); r1.appendChild(wt); r1.appendChild(ws); w.appendChild(r1);
      var r2 = h('div', 'om-legrow');
      function lf(name, label) { return fieldEl('c' + i2 + '-' + name, name, label, leg[name], !!leg.ex[name], function (v) { leg[name] = v; leg.ex[name] = false; }, 'Leg ' + (i2 + 1) + ': ' + label); }
      if (leg.type !== 'share') r2.appendChild(lf('K', 'Strike'));
      r2.appendChild(lf('p', leg.type === 'share' ? 'Price per share' : 'Premium per share'));
      r2.appendChild(lf('n', leg.type === 'share' ? 'Quantity (lots of 100 shares)' : 'Quantity (contracts)'));
      w.appendChild(r2);
      if (st.legs.length > 1) { rm = h('button', 'om-pill', 'Remove leg ' + (i2 + 1)); rm.type = 'button'; rm.addEventListener('click', function () { st.legs.splice(i2, 1); renderFields(); update(); }); w.appendChild(rm); }
      return w;
    }
    function fill() {
      var s = strat(st.strategy), src, k2, i2;
      if (s.id === 'custom') {
        st.legs = [];
        for (i2 = 0; i2 < EX_CUSTOM.length; i2++) { var l = EX_CUSTOM[i2]; st.legs.push({ type: l.type, side: l.side, K: l.K, p: l.p, n: l.n, ex: { K: true, p: true, n: true } }); }
      } else {
        src = EX[s.id === 'butterfly' ? (st.kind === 'put' ? 'butterflyPut' : 'butterflyCall') : s.id];
        for (k2 in src) { if (Object.prototype.hasOwnProperty.call(src, k2)) { st.vals[k2] = src[k2]; st.ex[k2] = true; } }
      }
      renderFields();
      $('om-filled').textContent = 'Example numbers filled in. They are made up.';
      update();
    }

    // read the typed numbers, validate, and show either an error under one field, nothing (not complete yet), or the result
    function clearErrors() {
      var ins = doc.querySelectorAll('#om-inputs [aria-invalid]'), i2;
      for (i2 = 0; i2 < ins.length; i2++) { ins[i2].removeAttribute('aria-invalid'); ins[i2].removeAttribute('aria-describedby'); }
      $('om-errbox').hidden = true; $('om-errtext').textContent = '';
    }
    // the error region: a box headed "Check these numbers"; no chart while it is open
    function showError(id, text) {
      var i2 = $(id);
      $('om-errtext').textContent = text; $('om-errbox').hidden = false;
      if (i2) { i2.setAttribute('aria-invalid', 'true'); i2.setAttribute('aria-describedby', 'om-errtext'); }
    }
    function valueOf(id) { var i2 = $(id); return i2 ? i2.value : ''; }
    function isBlank(s2) { return /^\s*$/.test(s2); }
    function optionalInputs(o) { var i2; for (i2 = 0; i2 < OPTIONAL.length; i2++) o[OPTIONAL[i2][0]] = st.vals[OPTIONAL[i2][0]] || ''; return o; }
    function compute() {
      var s = strat(st.strategy), o, r, i2, leg, list = [], f;
      if (!s || !ready()) return null;
      if (s.id === 'custom') {
        for (i2 = 0; i2 < st.legs.length; i2++) {
          leg = st.legs[i2];
          if (!leg.type || !leg.side) return { incomplete: true };
          f = { type: leg.type, side: leg.side, K: leg.K, p: leg.p, n: leg.n };
          r = E.validate('custom', { legs: [f] });
          if (!r.ok) {
            if (r.code === 'R9' || r.code === 'R7') return { incomplete: true };
            if (isBlank(String(leg[r.field] === undefined ? '' : leg[r.field])) && !st.touched['c' + i2 + '-' + r.field]) return { incomplete: true };
            return { error: r, id: 'c' + i2 + '-' + r.field, text: errorText('custom', r, f, i2) };
          }
          list.push(f);
        }
        o = optionalInputs({ legs: list });
      } else {
        o = optionalInputs({ dir: st.dir, kind: st.kind });
        for (i2 = 0; i2 < s.f.length; i2++) o[s.f[i2].name] = st.vals[s.f[i2].name] || '';
      }
      r = E.validate(s.id, o);
      if (!r.ok) {
        if (r.code === 'R9' || r.code === 'R7') return { incomplete: true };
        if (isBlank(String(o[r.field] === undefined ? '' : o[r.field])) && !st.touched['f-' + r.field]) return { incomplete: true };
        return { error: r, id: 'f-' + r.field, text: errorText(s.id, r, o, null) };
      }
      return { ok: r };
    }
    function anyExample() { var k2, i2; for (k2 in st.ex) { if (st.ex[k2]) return true; } for (i2 = 0; i2 < st.legs.length; i2++) { for (k2 in st.legs[i2].ex) { if (st.legs[i2].ex[k2]) return true; } } return false; }

    function card(title, value, sub, tag, pointer) {
      var c = h('div', 'om-rc'), t = h('p', 'om-rl', title + ' '), v;
      t.appendChild(h('span', 'om-tag', tag)); c.appendChild(t); v = h('p', 'om-rv', value); c.appendChild(v);
      if (sub) c.appendChild(h('p', 'om-rs', sub));
      if (pointer) c.appendChild(h('p', 'om-ri', pointer));
      return c;
    }
    // the chart wrapper and the results block show and hide together
    function setResults(show) { $('om-results').hidden = !show; $('om-chartwrap').hidden = !show; }
    function showResults(v, example) {
      var a = analyse(v, example), tag = example ? 'example' : 'typed', cards = $('om-cards'), pt = CARD_POINTER, m, be, ul, i2, li, tb, rows, cap, il;
      clear(cards);
      cards.appendChild(card('Maximum profit', a.maxProfit, 'for the whole position', tag, pt));
      cards.appendChild(card('Maximum loss', a.maxLoss, 'for the whole position', tag, pt));
      cards.appendChild(card('Break-even (per share)', a.breakEvenCard, '', tag, pt));
      cards.appendChild(card(a.netTitle, a.net, 'for the whole position', tag, pt));
      cards.appendChild(card('Cost to open', a.costTotal, a.costParts.join('; '), tag, pt));
      if (a.check) cards.appendChild(card('Price at expiry to check (any price you type)', a.check, '', tag, pt));
      if (a.cash) cards.appendChild(card('Cash equal to the strike for the shares', a.cash, '', tag, pt));
      // the inputs once, as the last item of the cards group; the W1(a) line follows in the page
      il = inputsLine(st.strategy, tag, st.vals, st.dir, st.kind, st.legs);
      cards.appendChild(h('p', 'om-inputs-line', il));
      $('om-notes').textContent = ''; clear($('om-notes'));
      for (i2 = 0; i2 < a.notes.length; i2++) $('om-notes').appendChild(h('p', 'om-note', a.notes[i2]));
      $('om-name').textContent = a.name;
      be = E.breakEvens(v.legs, v.fee);
      m = chartModel(v, (function () { var o = [], k2; for (k2 = 0; k2 < be.points.length; k2++) o.push(be.points[k2].cents); return o; })());
      m.be = []; for (i2 = 0; i2 < be.points.length; i2++) m.be.push(be.points[i2].cents);
      st.cur = { v: v, m: m, a: a };
      if (st.marker === null && v.Sx !== null) st.marker = { S: v.Sx, T: E.positionTotal(v.legs, v.fee, v.Sx) };
      else if (st.marker) st.marker = { S: Math.min(Math.max(st.marker.S, m.lo), m.hi), T: 0 }, st.marker.T = E.positionTotal(v.legs, v.fee, st.marker.S);
      $('om-alt').textContent = altText(m);
      cap = 'Profit or loss at expiry for the position shown. ' + (example ? 'Every price on this chart is a made-up example.' : 'Every price on this chart comes from the numbers typed.') + ' This chart shows expiry only: it does not show the value on any earlier day.';
      $('om-caption').textContent = cap;
      rows = tableRows(v, m); tb = $('om-rows'); clear(tb);
      for (i2 = 0; i2 < rows.length; i2++) { li = h('tr'); li.appendChild(h('td', '', rows[i2].price)); li.appendChild(h('td', '', rows[i2].total)); tb.appendChild(li); }
      $('om-table-cap').textContent = example ? 'Example numbers behind the graph' : 'Numbers behind the graph, from the numbers typed';
      $('om-box').textContent = ''; clear($('om-box'));
      $('om-box').appendChild(h('p', '', a.box)); $('om-box').appendChild(h('p', 'om-w1', 'For education only, not financial advice.'));
      ul = $('om-wrong'); clear(ul);
      for (i2 = 0; i2 < a.wrong.length; i2++) ul.appendChild(h('li', '', a.wrong[i2]));
      setResults(true); $('om-boxes').hidden = false; $('om-empty').hidden = true;
      drawChart();
      st.hadResults = true;   // no automatic scroll: only focus moves, after the visitor's own choice (iteration 1)
    }
    function readout() {
      var r = $('om-readout');
      if (!st.cur || !st.marker) { r.textContent = ''; return; }
      r.textContent = 'At a price of ' + fmtMoney(st.marker.S) + ' per share at expiry: ' + totalWords(st.marker.T) + ' for the whole position.';
    }
    function drawChart() {
      var box = $('om-chart'), w, hh;
      clear(box);
      if (!st.cur) return;
      w = Math.max(280, box.clientWidth || 600); hh = Math.round(Math.min(360, Math.max(240, w * 0.58)));
      box.appendChild(chartNodes(doc, st.cur.m, w, hh, st.marker));
      readout();
    }
    function moveMarker(S) {
      if (!st.cur) return;
      S = Math.min(Math.max(S, st.cur.m.lo), st.cur.m.hi);
      st.marker = { S: S, T: E.positionTotal(st.cur.v.legs, st.cur.v.fee, S) };
      drawChart();
    }
    function update() {
      var c = compute();
      clearErrors();
      if (!strat(st.strategy)) { $('om-empty').textContent = 'Choose a strategy to see its payoff at expiry.'; $('om-empty').hidden = false; setResults(false); $('om-boxes').hidden = true; st.cur = null; st.hadResults = false; drawChart(); return; }
      if (!c || c.incomplete || c.error) {
        if (c && c.error) showError(c.id, c.text);
        $('om-empty').textContent = 'Type the numbers above to see the payoff at expiry.';
        $('om-empty').hidden = !!(c && c.error); setResults(false); $('om-boxes').hidden = true; st.cur = null; st.hadResults = false; drawChart();
        $('om-name').textContent = nameSentence(st.strategy, '');
        return;
      }
      showResults(c.ok, anyExample());
    }

    var chartBox = $('om-chart');
    chartBox.addEventListener('pointermove', function (e) {
      var svg = chartBox.firstChild, r, frac, ml = 62, mr = 14, w;
      if (!svg || !st.cur) return;
      r = svg.getBoundingClientRect(); w = r.width - ml - mr;
      frac = (e.clientX - r.left - ml) / w;
      moveMarker(st.cur.m.lo + Math.round(frac * (st.cur.m.hi - st.cur.m.lo)));
    });
    chartBox.addEventListener('keydown', function (e) {
      var step, base;
      if (!st.cur) return;
      step = Math.max(1, Math.round((st.cur.m.hi - st.cur.m.lo) / 100));
      base = st.marker ? st.marker.S : st.cur.m.lo;
      if (e.key === 'ArrowLeft') moveMarker(base - (e.shiftKey ? 10 * step : step));
      else if (e.key === 'ArrowRight') moveMarker(base + (e.shiftKey ? 10 * step : step));
      else if (e.key === 'Home') moveMarker(st.cur.m.lo);
      else if (e.key === 'End') moveMarker(st.cur.m.hi);
      else return;
      e.preventDefault();
    });
    win.addEventListener('resize', drawChart);
    update();
  }

  return {
    fmtMoney: fmtMoney, toPlain: toPlain, totalWords: totalWords, STRAT: STRAT, EX: EX, EX_CUSTOM: EX_CUSTOM, strat: strat, fieldLabel: fieldLabel, errorText: errorText, optLabel: optLabel,
    axisRange: axisRange, niceTicks: niceTicks, chartModel: chartModel, chartNodes: chartNodes, textWidth: textWidth, labelBox: labelBox, boxesOverlap: boxesOverlap, lineHitsBox: lineHitsBox, topRows: topRows, placeBoxes: placeBoxes, leftMargin: leftMargin, beSide: beSide, analyse: analyse, nameSentence: nameSentence, altText: altText, tableRows: tableRows,
    legSentence: legSentence, summarySentence: summarySentence, inputsLine: inputsLine, CARD_POINTER: CARD_POINTER, pickerSummary: pickerSummary,
    LEARN: LEARN, learnHref: learnHref, maxProfitWhere: maxProfitWhere, maxLossWhere: maxLossWhere, start: start
  };
});
