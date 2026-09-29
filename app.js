/* Compatibility entry point for pages that previously loaded the root script. */
(() => {
  'use strict';
  const script = document.createElement('script');
  script.src = new URL('js/app.js', document.currentScript.src).href;
  document.body.append(script);
})();
