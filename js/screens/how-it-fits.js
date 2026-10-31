/* How it fits together: one example month of money, shown piece by piece, and an
   example savings growth chart. Every figure is an example. This screen never
   reads the store and never shows the reader's own figures: the graphic comes
   from js/money-flow.js (built with createElement and textContent only) and its
   numbers from js/money-flow-calc.js. The route's mode is "none". */
(function () {
  'use strict';
  var SW = window.SW;

  SW.screens.register('how-it-fits', {
    render: function (wrap, ctx) {
      var h = ctx.dom.h;
      wrap.appendChild(ctx.app.screenHeader(ctx.route, { eyebrow: 'Sample data' }));
      var host = h('div', { class: 'mf-host' });
      wrap.appendChild(host);
      var flow = window.MoneyFlow.mount(host, { heading: 'h2', className: 'mf-inset' });
      // A second section under the graphic: the same example month, day by day (js/month-flow.js).
      var monthHost = h('div', { class: 'mm-host' });
      wrap.appendChild(monthHost);
      var month = window.MonthFlow.mount(monthHost, { heading: 'h2', className: 'mm-inset' });
      // A third section: what if the example split changed (js/split-flow.js). Fixed example numbers only.
      var splitHost = h('div', { class: 'sf-host' });
      wrap.appendChild(splitHost);
      var split = window.SplitFlow.mount(splitHost, { heading: 'h2', className: 'sf-inset' });
      return {
        // Nothing here comes from the store, so a store change needs no repaint.
        onStoreChange: function () { return true; },
        destroy: function () { flow.destroy(); month.destroy(); split.destroy(); }
      };
    }
  });
})();
