// Routes /api/imagery/v1/search-imagery to the standalone imagery-relay.mjs
// service instead of the generic /api/ -> local-api-server proxy below it.
// nginx's exact-match `location =` always wins over the prefix-match
// `location /api/` regardless of file order, so this cleanly overrides
// just this one path without touching the compiled (paywalled) handler
// at all -- everything else under /api/ still goes through the normal
// proxy unchanged.
import { readFileSync, writeFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node imagery-route-patch.mjs <path-to-nginx.conf.template>');
  process.exit(1);
}

const anchor = `    # API proxy → Node.js local-api-server
    location /api/ {`;

const insertion = `    # Free replacement for the paywalled search-imagery RPC -- see
    # imagery-relay.mjs. Exact match always wins over the /api/ prefix
    # match below, regardless of declaration order.
    location = /api/imagery/v1/search-imagery {
      proxy_pass http://127.0.0.1:3006;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_read_timeout 15s;
      proxy_send_timeout 15s;
    }

    # API proxy → Node.js local-api-server
    location /api/ {`;

const content = readFileSync(path, 'utf8');
if (content.includes('location = /api/imagery/v1/search-imagery')) {
  console.log('[imagery-route-patch] already patched, skipping');
  process.exit(0);
}
if (!content.includes(anchor)) {
  console.error('[imagery-route-patch] anchor not found — upstream source changed, needs re-check');
  process.exit(1);
}
writeFileSync(path, content.replace(anchor, insertion));
console.log('[imagery-route-patch] patched');
