/* Stepwell Financial: the app shell.
   - Builds the navigation from SW.routes and runs the hash router. Every
     screen's script and stylesheet are in index.html; nothing is loaded at
     run time.
   - Opens the data store (docs/STORE.md) before the first screen, and
     renders the current screen again after every change.
   - Applies the reader's settings from the store: theme (dark on first use),
     Hide amounts, Less motion, More contrast.
   - Shows the lock screen while the passphrase lock is locked, the sample
     data bar while sample records are present, and the storage notice when
     the browser refuses to save.
   Data never goes in the URL or the page title. */
(function () {
  'use strict';
  var SW = window.SW;
  var registry = {};
  SW.screens = { register: function (file, impl) { registry[file] = impl; } };
  if (SW.framed) { SW.app = { start: function () {} }; return; } // the frame check in boot.js has taken over

  var h = SW.dom.h, icon = SW.dom.icon, clear = SW.dom.clear, F = SW.fmt;
  var root = document.documentElement;
  var view = document.getElementById('view');
  var current = null, firstRender = true, quiet = false, store = null;

  // ---------- Routes ----------
  // '#/onboarding/2' -> { route: onboarding, sub: '2' }; exact paths win, then the longest prefix.
  function resolve(path) {
    var best = null;
    SW.routes.forEach(function (r) {
      if (path === r.path) best = { route: r, sub: '' };
      else if (path.indexOf(r.path + '/') === 0 && (!best || (best.sub && r.path.length > best.route.path.length))) best = { route: r, sub: path.slice(r.path.length + 1) };
    });
    return best;
  }
  function routeFor(path) { var x = resolve(path); return x ? x.route : null; }
  function href(r) { return '#/' + r.path; }

  // ---------- Shared pieces for screens ----------
  // The data band (C8.3): "On this device only" for the reader's own
  // figures, "Sample data" while sample records are present, and the
  // storage notice when the browser refuses to save.
  var MODES = {
    device: function () {
      var st = store ? store.status() : null, out = [];
      if (!st || !st.hasSample || st.hasOwnData) out.push(h('span', { class: 'chip device' }, [h('span', { class: 'dot' }), 'On this device only']));
      if (st && st.hasSample) out.push(h('span', { class: 'chip sample', text: 'Sample data' }));
      if (st && st.notice) out.push(h('span', { class: 'chip notice', role: 'status', text: st.notice }));
      return out;
    },
    none: function () { return []; }
  };
  // Screen header: eyebrow, h1, the data band and (prototype builds only) the screen's concept id.
  function screenHeader(route, opts) {
    opts = opts || {};
    var band = (MODES[route.mode] || MODES.none)();
    var proto = SW.flags.prototypeBuild && route.path !== 'screens'
      ? h('p', { class: 'proto-id' }, [route.ref ? 'Screen ' + route.ref + ' · ' : '', h('a', { href: '#/screens', text: 'All screens' })]) : null;
    return h('header', { class: 'screen-head' }, [
      h('div', {}, [
        opts.eyebrow ? h('p', { class: 'eyebrow', text: opts.eyebrow }) : null,
        h('h1', { id: 'view-title', tabindex: '-1', text: opts.title || route.title }),
        proto
      ]),
      band.length ? h('div', { class: 'band', role: 'note', 'aria-label': 'Where these numbers are kept' }, band) : null
    ]);
  }

  // ---------- Navigation ----------
  var GROUPS = [['main', ''], ['learn', 'Learn'], ['you', 'You'], ['start', 'Start']];
  function navList() {
    var wrap = h('div', { class: 'nav' });
    GROUPS.forEach(function (g) {
      var items = SW.routes.filter(function (r) { return r.nav === g[0]; });
      if (!items.length) return;
      if (g[1]) wrap.appendChild(h('p', { class: 'grp', text: g[1] }));
      var ul = h('ul', { role: 'list' });
      items.forEach(function (r) {
        ul.appendChild(h('li', {}, h('a', { href: href(r), 'data-path': r.path }, [icon(r.icon), h('span', { text: r.title })])));
      });
      wrap.appendChild(ul);
    });
    return wrap;
  }
  function buildNav() {
    document.getElementById('rail').appendChild(navList());
    document.getElementById('drawer-nav').appendChild(navList());
    var tb = document.getElementById('tabbar'), ul = h('ul', { role: 'list' });
    SW.routes.filter(function (r) { return r.tab; }).forEach(function (r) {
      ul.appendChild(h('li', {}, h('a', { href: href(r), 'data-path': r.path }, [icon(r.icon), h('span', { text: r.tab })])));
    });
    var more = h('button', { type: 'button', id: 'more-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'drawer' }, [icon('more'), h('span', { text: 'More' })]);
    ul.appendChild(h('li', {}, more));
    tb.appendChild(ul);
    more.addEventListener('click', openDrawer);
  }
  function markNav(path) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-path]'), function (a) {
      if (a.getAttribute('data-path') === path) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    var inTabs = SW.routes.some(function (r) { return r.tab && r.path === path; });
    document.getElementById('more-btn').classList.toggle('current', !inTabs);
  }

  // ---------- Drawer (phones and tablets) ----------
  var drawer = document.getElementById('drawer'), lastFocus = null;
  var skip = document.querySelector('.skip');
  var shellParts = [skip, document.querySelector('.topbar'), document.querySelector('.shell'), document.getElementById('tabbar')];
  function openDrawer() {
    lastFocus = document.activeElement;
    drawer.hidden = false;
    shellParts.forEach(function (el) { el.inert = true; });
    document.getElementById('more-btn').setAttribute('aria-expanded', 'true');
    document.getElementById('drawer-close').focus();
  }
  function closeDrawer(restore) {
    if (drawer.hidden) return;
    drawer.hidden = true;
    shellParts.forEach(function (el) { el.inert = false; });
    document.getElementById('more-btn').setAttribute('aria-expanded', 'false');
    if (restore !== false && lastFocus) lastFocus.focus();
  }
  document.getElementById('drawer-close').addEventListener('click', function () { closeDrawer(); });
  drawer.addEventListener('click', function (e) {
    if (e.target === drawer) closeDrawer();
    if (e.target.closest && e.target.closest('a')) closeDrawer(false);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });

  // The skip link moves focus to the screen and leaves the route alone.
  skip.addEventListener('click', function (e) { e.preventDefault(); document.getElementById('main').focus(); });

  // ---------- Settings: theme, hide amounts, motion, contrast ----------
  var themeBtn = document.getElementById('theme-toggle'), hideBtn = document.getElementById('hide-amounts');
  root.setAttribute('data-theme', 'dark'); // brand rule: dark on first use
  function applySettings() {
    var s = store && store.settings();
    if (!s) return;
    var light = s.theme === 'light';
    root.setAttribute('data-theme', light ? 'light' : 'dark');
    themeBtn.querySelector('use').setAttribute('href', light ? '#i-moon' : '#i-sun');
    themeBtn.querySelector('.tlabel').textContent = light ? 'Night theme' : 'Paper theme';
    themeBtn.setAttribute('aria-label', light ? 'Switch to the Night theme' : 'Switch to the Paper theme');
    F.hidden = !!s.hideAmounts;
    root.classList.toggle('hide-amounts', F.hidden);
    hideBtn.setAttribute('aria-pressed', F.hidden ? 'true' : 'false');
    hideBtn.querySelector('use').setAttribute('href', F.hidden ? '#i-eye-off' : '#i-eye');
    root.classList.toggle('sw-less-motion', !!s.lessMotion);
    root.classList.toggle('sw-more-contrast', !!s.moreContrast);
  }
  themeBtn.addEventListener('click', function () {
    var light = root.getAttribute('data-theme') !== 'light';
    if (!store) return;
    store.setSettings({ theme: light ? 'light' : 'dark' }).then(function () { announce(light ? 'Paper theme' : 'Night theme'); }, function (e) { announce(e.message); });
  });
  hideBtn.addEventListener('click', function () {
    if (!store) return;
    var on = !F.hidden;
    store.setSettings({ hideAmounts: on }).then(function () { announce(on ? 'Amounts hidden' : 'Amounts shown'); }, function (e) { announce(e.message); });
  });
  function announce(msg) {
    var a = document.getElementById('announcer');
    a.textContent = '';
    setTimeout(function () { a.textContent = msg; }, 30);
  }

  // ---------- The reader's name, at the top ----------
  // The only place the name is used. It is set with textContent (never markup),
  // and is not shown while the app is locked or while Hide amounts is on. It is
  // never put in document.title, the address, a file name or any other copy.
  // whoText() is the one place that decides how the name is written.
  function whoText(name) { return name; }
  var whoEl = document.getElementById('who'), topbarEl = document.querySelector('.topbar');
  function updateWho() {
    var st = store ? store.status() : null;
    var name = st && st.ready && !st.locked && !st.deleted && !st.closed && !F.hidden ? store.displayName() : '';
    whoEl.hidden = !name;
    topbarEl.classList.toggle('has-who', !!name);
    if (!name) { whoEl.textContent = ''; whoEl.removeAttribute('title'); whoEl.removeAttribute('aria-label'); return; }
    var text = whoText(name);
    whoEl.textContent = text;
    whoEl.setAttribute('title', text);
    whoEl.setAttribute('aria-label', text);
  }

  // ---------- The sample data bar ----------
  var sampleBar = document.getElementById('sample-bar'), sampleNote = null;
  function updateSampleBar() {
    var st = store && store.status();
    var show = !!(st && st.ready && !st.locked && !st.deleted && (st.hasSample || sampleNote));
    sampleBar.hidden = !show;
    clear(sampleBar);
    if (!show) return;
    if (!st.hasSample) { sampleBar.appendChild(h('p', { role: 'status', text: sampleNote })); return; }
    var btn = h('button', { type: 'button', class: 'btn small quiet', text: 'Remove sample data' });
    btn.addEventListener('click', function () {
      btn.disabled = true;
      store.removeSample().then(function (r) {
        var a = r.removed.accounts || 0, l = r.removed.transactions || 0;
        sampleNote = 'Removed ' + a + (a === 1 ? ' account' : ' accounts') + ' and ' + l + (l === 1 ? ' line.' : ' lines.') + ' Your own records are as they were.';
        updateSampleBar();
        announce(sampleNote);
      }, function (e) { btn.disabled = false; announce(e.message); });
    });
    sampleBar.appendChild(h('p', {}, ['You are looking at sample data. ', btn]));
  }

  // ---------- Built-in views ----------
  function skeleton() {
    return h('div', { class: 'loading', 'aria-busy': 'true' }, [
      h('div', { class: 'card' }, [h('div', { class: 'skeleton sk-line' }), h('div', { class: 'skeleton sk-big' }), h('div', { class: 'skeleton sk-chart' }),
        h('p', { class: 'fine', text: 'Opening this screen' })])
    ]);
  }
  function notFound() {
    return h('div', { class: 'stack' }, [
      h('header', { class: 'screen-head' }, h('h1', { id: 'view-title', tabindex: '-1', text: 'We couldn’t find that screen' })),
      h('section', { class: 'card notice' }, [
        h('p', { text: 'There is no screen at this address. It may have a different name.' }),
        h('p', { class: 'ph-links' }, [h('a', { href: '#/overview', text: 'Go to Overview' })])
      ])
    ]);
  }
  function loadError(route) {
    return h('div', { class: 'stack' }, [
      screenHeader(route),
      h('section', { class: 'card notice' }, [
        h('h2', { text: 'Something went wrong on this screen. Your numbers are safe.' }),
        h('p', { class: 'ph-links' }, [h('a', { href: '#/overview', text: 'Go to Home' })])
      ])
    ]);
  }
  function stateView(title, lines, actions) {
    return h('div', { class: 'stack' }, [
      h('header', { class: 'screen-head' }, h('h1', { id: 'view-title', tabindex: '-1', text: title })),
      h('section', { class: 'card notice' }, lines.map(function (t) { return h('p', { text: t }); }).concat(actions ? [h('p', { class: 'ph-links' }, actions)] : []))
    ]);
  }
  function reloadBtn() { var b = h('button', { type: 'button', class: 'btn', text: 'Reload the page' }); b.addEventListener('click', function () { location.reload(); }); return b; }

  // The lock screen (spec 9.5; layout after the build supplement's K5 and K6).
  // It shows none of the reader's figures and no data band.
  function lockView() {
    var err = h('p', { class: 'field-error', id: 'lock-err', role: 'alert' });
    var input = h('input', { type: 'password', id: 'lock-pass', autocomplete: 'current-password', 'aria-describedby': 'lock-err', spellcheck: 'false' });
    SW.dom.cap(input, 'passphrase');
    var unlock = h('button', { type: 'button', class: 'btn', text: 'Unlock' });
    function go() {
      if (!input.value) { err.textContent = 'Enter your passphrase.'; input.focus(); return; }
      unlock.disabled = true; err.textContent = '';
      store.unlock(input.value).then(function () { input.value = ''; }, function (e) {
        unlock.disabled = false; input.value = ''; err.textContent = e.message; input.focus();
      });
    }
    unlock.addEventListener('click', go);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });

    var forgotBtn = h('button', { type: 'button', class: 'linkbtn', text: 'Forgot your passphrase?' });
    var word = h('input', { type: 'text', id: 'lock-delete-word', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'lock-del-err' });
    word.maxLength = 10;
    var delErr = h('p', { class: 'field-error', id: 'lock-del-err', role: 'alert' });
    var del = h('button', { type: 'button', class: 'btn quiet', text: 'Delete all and start over' });
    del.addEventListener('click', function () {
      if (word.value !== 'DELETE') { delErr.textContent = 'Type DELETE to confirm.'; word.focus(); return; }
      del.disabled = true;
      store.deleteAll('DELETE').then(function (r) {
        clear(view);
        view.appendChild(stateView(r.nothingLeft ? 'Nothing from this app is left on this device.' : 'Everything was deleted.',
          ['Files you downloaded before, such as backups, are not touched.'], [reloadBtn()]));
      }, function (e) { del.disabled = false; delErr.textContent = e.message; });
    });
    var forgot = h('div', { class: 'explainer' }, [
      h('p', { text: 'Your numbers are only on this device, locked with your passphrase, so nobody can recover them, including us.' }),
      h('p', { text: 'You can delete everything on this device and start again, then restore a backup file if you saved one.' }),
      h('div', { class: 'field' }, [h('label', { for: 'lock-delete-word', text: 'Type DELETE to confirm' }), word, delErr]),
      del
    ]);
    SW.dom.disclosure(forgotBtn, forgot);
    return h('div', { class: 'stack lock-screen' }, [
      h('header', { class: 'screen-head' }, h('h1', { id: 'view-title', tabindex: '-1', text: 'Locked' })),
      h('section', { class: 'card lock-card', 'aria-labelledby': 'view-title' }, [
        h('p', { text: 'Enter your passphrase to open your numbers.' }),
        h('div', { class: 'field' }, [h('label', { for: 'lock-pass', text: 'Passphrase' }), input, err]),
        unlock,
        h('div', { class: 'card-foot' }, [forgotBtn]),
        forgot
      ])
    ]);
  }

  // ---------- Router ----------
  // Only hashes that start with "#/" are routes; any other (such as the skip
  // link's "#main") leaves the screen as it is.
  function parse() {
    var hs = location.hash || '';
    if (hs && hs.indexOf('#/') !== 0) return null;
    var raw = hs.slice(2);
    try { raw = decodeURIComponent(raw); } catch (e) { /* keep it as typed */ }
    raw = raw.replace(/\/+$/, '');
    var q = raw.indexOf('?');
    return q >= 0 ? raw.slice(0, q) : raw;
  }
  var lastPath = null;
  function show(node, route, path, fill) {
    if (current && current.destroy) { try { current.destroy(); } catch (e) { /* keep going */ } }
    current = null;
    clear(view);
    view.appendChild(node);
    if (fill) fill();
    document.title = (route ? route.title : 'Not found') + ' | Stepwell Financial';
    markNav(route ? route.path : path);
    if (!firstRender && !quiet) {
      window.scrollTo(0, 0);
      var t = document.getElementById('view-title');
      if (t) t.focus();
    }
    firstRender = false;
  }
  function setShellLocked(locked) {
    ['rail', 'tabbar'].forEach(function (id) { var el = document.getElementById(id); el.hidden = locked; el.inert = locked; });
    hideBtn.hidden = locked;
  }
  function render() {
    var st = store ? store.status() : null;
    updateSampleBar();
    updateWho();
    if (st && st.deleted) { setShellLocked(false); show(stateView('Everything was deleted.', ['Reload the page to start again.'], [reloadBtn()]), null, ''); document.title = 'Stepwell Financial'; return; }
    if (st && st.closed) { show(stateView('This page needs a reload.', ['The app was changed in another tab. Reload this page to carry on.'], [reloadBtn()]), null, ''); document.title = 'Stepwell Financial'; return; }
    if (st && st.locked) { setShellLocked(true); show(lockView(), null, ''); document.title = 'Locked | Stepwell Financial'; return; }
    setShellLocked(false);
    var path = parse();
    if (path === null) { if (lastPath !== null) return; path = ''; }
    if (!path) {
      var s = store && store.settings();
      location.replace(s && !s.onboardingDone && !(st && (st.hasOwnData || st.hasSample)) ? '#/onboarding' : '#/overview');
      return;
    }
    lastPath = path;
    var hit = resolve(path);
    if (!hit) { show(notFound(), null, path); return; }
    var route = hit.route;
    if (!route.ready) { show(notFound(), null, path); return; }
    if (!registry[route.file]) { show(loadError(route), route); return; }
    var wrap = h('div', { class: 'screen screen-' + route.file });
    var ctx = { route: route, sub: hit.sub, data: window.SWData, calc: window.SWCalc, dom: SW.dom, charts: SW.charts, app: SW.app, store: store, flags: SW.flags };
    try {
      show(wrap, route, path, function () { current = registry[route.file].render(wrap, ctx) || null; });
    } catch (err) {
      if (window.console) console.error(err);
      show(loadError(route), route);
    }
  }
  // After a store change: let the screen handle it, or render it again in place.
  function onStoreEvent(ev) {
    var hideChanged = false;
    if (ev.type === 'change' && ev.stores.indexOf('settings') >= 0) {
      var wasHidden = F.hidden;
      applySettings();
      hideChanged = wasHidden !== F.hidden;
    }
    updateWho();
    if (ev.type === 'change' && (ev.reason === 'persist' || ev.reason === 'backup')) return;
    if (ev.type === 'change' && current && typeof current.onStoreChange === 'function') {
      var handled = false;
      try { handled = current.onStoreChange(ev) === true; } catch (e) { if (window.console) console.error(e); }
      if (handled) {
        // Hide amounts always reaches every figure, whatever the screen did:
        // repaint each money element and form field in place, then, if any
        // figure would still be readable, render the screen again.
        if (hideChanged) {
          F.repaint(view);
          if (!F.leaks(view)) { updateSampleBar(); return; }
        } else { updateSampleBar(); return; }
      }
    }
    if (ev.type === 'change' && ev.reason === 'sample' && store.status().hasSample) sampleNote = null;
    var y = window.scrollY, wasLocked = document.title.indexOf('Locked') === 0;
    quiet = ev.type === 'change' && !wasLocked;
    try { render(); } finally { quiet = false; }
    if (ev.type === 'change' && !wasLocked) window.scrollTo(0, y);
  }

  SW.calc = window.SWCalc;
  SW.app = {
    screenHeader: screenHeader, announce: announce, routeFor: routeFor, href: href,
    // Called once by js/start.js, after every screen script has registered.
    // opts.store: store options, for the test page only (tests/shell.html); the page itself passes none.
    start: function (opts) {
      store = SW.store = window.SWStore.create(Object.assign({ sampleMode: SW.flags.sampleMode }, opts && opts.store));
      buildNav();
      clear(view); view.appendChild(skeleton());
      window.addEventListener('hashchange', render);
      store.subscribe(onStoreEvent);
      store.open().then(function () { applySettings(); render(); }, function (e) { if (window.console) console.error(e); render(); });
    }
  };
})();
