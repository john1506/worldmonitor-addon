// Patches dist/dashboard.html to fix absolute /api/... and /data/... fetch()
// calls under HA Ingress. The app hardcodes these as domain-root-absolute
// strings (fine on production/Vercel, served at domain root) with no
// base-path concept outside its Tauri-desktop sidecar path. Under Ingress the
// page is loaded at /api/hassio_ingress/<token>/, so a plain fetch("/api/x")
// resolves against the HA frontend's own origin root and never reaches this
// add-on (HA owns /api/ as its own REST namespace) -- confirmed via zero
// matching requests ever hitting this container's nginx log while every
// other asset loaded fine.
//
// Fix: inject an inline bootstrap (before any other script runs, so it wins
// the race against every fetch() call site in the app) that detects the
// Ingress prefix from location.pathname and rewrites matching absolute paths
// to carry it. No-ops entirely outside Ingress (production, direct docker
// exposure) since the regex won't match.
import { readFileSync, writeFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node ingress-api-patch.mjs <path-to-dashboard.html>');
  process.exit(1);
}

const html = readFileSync(path, 'utf8');
if (html.includes('wm-ingress-api-patch')) {
  console.log('[ingress-api-patch] already patched, skipping');
  process.exit(0);
}

const snippet = `<script nonce="wm-static-bootstrap" data-wm-ingress-api-patch>
(function(){
  var m = location.pathname.match(/^(\\/api\\/hassio_ingress\\/[^\\/]+)\\//);
  if (!m) return;
  var prefix = m[1];
  var origFetch = window.fetch.bind(window);
  function needsRewrite(p) {
    return (p.indexOf('/api/') === 0 || p.indexOf('/data/') === 0) && p.indexOf(prefix) !== 0;
  }
  window.fetch = function(input, init) {
    try {
      if (typeof input === 'string' && input.charAt(0) === '/' && needsRewrite(input)) {
        input = prefix + input;
      } else if (input && typeof input === 'object' && 'url' in input) {
        var u = new URL(input.url, location.href);
        if (u.origin === location.origin && needsRewrite(u.pathname)) {
          u.pathname = prefix + u.pathname;
          input = new Request(u.toString(), input);
        }
      }
    } catch (e) {}
    return origFetch(input, init);
  };
})();
</script>
`;

const newHtml = html.replace('<head>', '<head>\n    ' + snippet, 1);
if (newHtml === html) {
  console.error('[ingress-api-patch] injection point <head> not found');
  process.exit(1);
}
writeFileSync(path, newHtml);
console.log('[ingress-api-patch] patched');
