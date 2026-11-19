/* Options lessons (Calculators > Options > Learn). Draws the website's Option modeler learn pages inside the app.
   The text and example charts are js/options-learn-data.js, made from the website's own learn pages by a read-only converter
   (node lists, nothing is rewritten by hand). This file only draws them with createElement / createElementNS: no HTML string is
   parsed, no network, nothing stored, the address is not changed. The data file is checked here too: only the tags and
   attributes listed below are drawn, so a changed data file cannot add a script, a handler or an unknown element. */
(function () {
  'use strict';
  var SW = window.SW;
  if (!SW) return;
  var DATA = window.SW_OPTIONS_LEARN;
  if (!DATA) return;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var SITE = 'https://stepwellfinancial.com';
  var IN_APP = '#/calculators';   // the app's own Calculators screen (the app keeps nothing in the address, so this is the most a link can name)
  var HTML_TAGS = { h1: 'h3', h2: 'h4', h3: 'h4', p: 1, a: 1, ul: 1, ol: 1, li: 1, dl: 1, dt: 1, dd: 1, table: 1, caption: 1, thead: 1, tbody: 1, tr: 1,
    th: 1, td: 1, strong: 1, em: 1, b: 1, i: 1, span: 1, div: 1, section: 1, figure: 1, figcaption: 1, time: 1, br: 1 };
  var SVG_TAGS = { svg: 1, defs: 1, pattern: 1, rect: 1, line: 1, text: 1, polyline: 1, circle: 1, path: 1, g: 1, title: 1 };
  var OK_ATTR = { 'class': 1, id: 1, scope: 1, datetime: 1, role: 1, focusable: 1, colspan: 1, rowspan: 1, viewBox: 1, width: 1, height: 1,
    x: 1, y: 1, x1: 1, y1: 1, x2: 1, y2: 1, cx: 1, cy: 1, r: 1, rx: 1, ry: 1, points: 1, d: 1, patternUnits: 1, patternTransform: 1, transform: 1,
    'text-anchor': 1 };
  var LEARN_HREF = /^\/options-calculator\/learn\/([a-z0-9-]+)\/$/;

  function has(slug) { return Object.prototype.hasOwnProperty.call(DATA.pages, slug); }   // own keys only: "constructor" is not a lesson

  function create(ctx, api) {
    // api: { toModeler(): switch to the modeler view }
    var dom = ctx.dom, h = dom.h;
    var el = h('div', { class: 'cs-learn' });
    var current = null;   // slug, or null for the index

    function link(a, href) {
      var m = LEARN_HREF.exec(href);
      // A lesson, the lessons index and the modeler are all inside the app, so their links point at the app's own Calculators
      // address (copying one, or opening it in a new tab, stays in the app); the click shows the right view.
      if (m && has(m[1])) {
        a.setAttribute('href', IN_APP);
        a.addEventListener('click', function (e) { e.preventDefault(); show(m[1], true); });
      } else if (href === '/options-calculator/learn/') {
        a.setAttribute('href', IN_APP);
        a.addEventListener('click', function (e) { e.preventDefault(); show(null, true); });
      } else if (href === '/options-calculator/option-modeler/' || href === '/options-calculator/') {
        a.setAttribute('href', IN_APP);
        a.addEventListener('click', function (e) { e.preventDefault(); api.toModeler(); });
      } else if (href.charAt(0) === '/') {
        a.setAttribute('href', SITE + href);
        a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer');
      }
      // any other href (including a scheme) is not drawn: the link stays text only
    }

    function build(node, inSvg) {
      if (typeof node === 'string') return document.createTextNode(node);
      var tag = node[0], at = node[1] || {}, e, i, k, isSvg = inSvg || tag === 'svg';
      if (isSvg ? !SVG_TAGS[tag] : !HTML_TAGS[tag]) return document.createTextNode('');
      var name = (!isSvg && typeof HTML_TAGS[tag] === 'string') ? HTML_TAGS[tag] : tag;
      e = isSvg ? document.createElementNS(SVGNS, name) : document.createElement(name);
      for (k in at) {
        if (!Object.prototype.hasOwnProperty.call(at, k)) continue;
        if (k === 'href') { if (tag === 'a') link(e, String(at[k])); continue; }
        if (OK_ATTR[k] || /^aria-(label|labelledby|describedby|hidden|current)$/.test(k)) e.setAttribute(k, String(at[k]));
      }
      for (i = 2; i < node.length; i++) e.appendChild(build(node[i], isSvg));
      return e;
    }

    function show(slug, user) {
      var page = slug && has(slug) ? DATA.pages[slug] : DATA.index;
      if (!page || page === DATA.index) slug = null;
      current = slug;
      dom.clear(el);
      if (slug) {
        var back = h('button', { type: 'button', class: 'btn small quiet cs-learn-back', text: 'All lessons' });
        back.addEventListener('click', function () { show(null, true); });
        el.appendChild(back);
      }
      var art = h('article', { class: 'cs-learn-art' });
      page.nodes.forEach(function (n) { art.appendChild(build(n, false)); });
      el.appendChild(art);
      var head = art.querySelector('h3');
      if (head) {
        head.setAttribute('tabindex', '-1');
        if (user) { head.focus(); try { head.scrollIntoView({ block: 'start' }); } catch (e) { /* older browsers */ } ctx.app.announce(head.textContent); }
      }
    }
    show(null, false);
    return { el: el, show: function (slug) { show(slug, true); }, has: has, slug: function () { return current; } };
  }

  SW.optionsLearn = { create: create, hrefSlug: function (href) { var m = LEARN_HREF.exec(href || ''); return m ? m[1] : null; } };
})();
