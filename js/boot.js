/* Stepwell Financial: runs first, before any other script.

   1. The one Trusted Types policy the page allows ("stepwell-worker", the
      only name in the CSP's trusted-types list). It turns exactly one string,
      'js/workers/import-worker.js', into a script URL, and throws on anything
      else: no prefixes, no patterns. It has no createHTML or createScript, so
      every HTML or script sink stays blocked. The policy and every URL it
      makes stay inside this closure; the page only gets startImportWorker(),
      which creates and returns the Worker itself.
   2. The launch config: fixed switches for what Phase 1 shows.
   3. The frame check: shown inside another site's frame, the app renders
      only a link to open it directly, and nothing else starts (no store,
      no screens). It is a build setting here, never a URL or page option. */
(function (root) {
  'use strict';
  var SW = root.SW = root.SW || {};
  var WORKER_URL = 'js/workers/import-worker.js';
  var FRAME_GUARD = true;      // build setting: refuse to run inside a frame
  var PROTOTYPE_BUILD = false; // build setting: reviewer aids (screen ids, the #/screens index, onboarding's step switcher). Off in the launch build
  var policy = null;

  // ---------- Launch config (Phase 1) ----------
  // One static config, set here at build time. There is no URL, storage or
  // page option that changes it. A feature that is off has no route, no
  // navigation entry, no card and no link, and its script and stylesheet are
  // not loaded by index.html. Turning one on later takes this flag AND the
  // matching lines in index.html (see docs/LAUNCH.md).
  //   sampleMode  true: the opt-in "Look around with sample data" demo is
  //               offered. false: every sample entry point is gone (the store
  //               refuses loadSample); a device that already holds sample
  //               records still shows "Remove sample data".
  //   creditScore Settings' credit score card and #/settings/score
  //   markets     the Markets panel on Overview and data/markets.sample.js
  //   linked      the Linked accounts screen
  //   later       the "Later ideas" screens (week, ahead, future)
  //   aiChat      "Ask your money"
  //   pathway     the dated learning pathway on Learn
  var LAUNCH = Object.freeze({
    sampleMode: true,
    creditScore: false,
    markets: false,
    linked: false,
    later: false,
    aiChat: false,
    pathway: false
  });

  // ---------- Frame check ----------
  var framed = false;
  try { framed = root.top !== root.self; } catch (e) { framed = true; }
  if (FRAME_GUARD && framed) {
    var body = root.document.body;
    while (body.firstChild) body.removeChild(body.firstChild);
    var main = root.document.createElement('main');
    main.className = 'framed';
    var p = root.document.createElement('p');
    p.textContent = 'Stepwell Financial opens in its own window, so it can keep your numbers on this device safely. ';
    var a = root.document.createElement('a');
    a.href = root.location.href.split('#')[0];
    a.target = '_top';
    a.rel = 'noopener noreferrer';
    a.textContent = 'Open Stepwell Financial';
    p.appendChild(a);
    main.appendChild(p);
    body.appendChild(main);
  }
  Object.defineProperty(SW, 'framed', { value: FRAME_GUARD && framed, writable: false, configurable: false, enumerable: true });

  if (root.trustedTypes && typeof root.trustedTypes.createPolicy === 'function') {
    policy = root.trustedTypes.createPolicy('stepwell-worker', {
      createScriptURL: function (input) {
        if (input === WORKER_URL) return WORKER_URL;
        throw new TypeError('This script URL is not allowed.');
      }
    });
  }

  // SW.startImportWorker() -> a new Worker running the import parser.
  function startImportWorker() {
    return new root.Worker(policy ? policy.createScriptURL(WORKER_URL) : WORKER_URL);
  }
  Object.defineProperty(SW, 'startImportWorker', { value: startImportWorker, writable: false, configurable: false, enumerable: true });

  // SW.flags: the launch config above, plus
  //   pathwayRoadmap: the same switch as `pathway` (the name Learn reads)
  //   prototypeBuild: reviewer aids (screen ids, the #/screens index)
  Object.defineProperty(SW, 'flags', {
    value: Object.freeze({
      sampleMode: LAUNCH.sampleMode, creditScore: LAUNCH.creditScore, markets: LAUNCH.markets, linked: LAUNCH.linked,
      later: LAUNCH.later, aiChat: LAUNCH.aiChat, pathway: LAUNCH.pathway,
      pathwayRoadmap: LAUNCH.pathway, prototypeBuild: PROTOTYPE_BUILD
    }), writable: false, configurable: false, enumerable: true
  });
})(this);
