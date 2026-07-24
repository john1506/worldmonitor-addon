// local-api-server.mjs wraps global fetch with an SSRF guard that blocks
// requests to private/loopback IPs by default -- a legitimate protection
// against user-supplied URLs (webcams, RSS feeds, etc). It already
// allowlists UPSTASH_REDIS_REST_URL's origin in docker mode for exactly
// this reason (otherwise every Redis call would be SSRF-blocked), but
// never did the same for WS_RELAY_URL. Since our ais-relay.cjs runs on
// 127.0.0.1 in-container, every handler that calls the relay
// (get-vessel-snapshot.ts, oref-alerts.js, telegram-feed.js) silently got
// SSRF-blocked -- caught by their own bare `catch { return undefined; }`,
// so it looked like "no data" / random 502s/503s rather than a clear error.
// Adds the same allowlist treatment for WS_RELAY_URL, gated the same way
// (mode === 'docker' only, so desktop/production SSRF posture is untouched).
import { readFileSync, writeFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node relay-ssrf-allowlist-patch.mjs <path-to-local-api-server.mjs>');
  process.exit(1);
}

const anchor = `      if (context.allowPrivateRemoteBase) {`;
const insertion = `      if (context.mode === 'docker' && process.env.WS_RELAY_URL) {
        try {
          extraAllowedPrivateOrigins.push(new URL(process.env.WS_RELAY_URL).origin);
        } catch (err) {
          context.logger.warn(
            \`[local-api] WS_RELAY_URL is not a valid URL; not added to the private-fetch allowlist (AIS/oref/telegram relay calls will be SSRF-blocked): \${err.message}\`,
          );
        }
      }
      if (context.allowPrivateRemoteBase) {`;

const content = readFileSync(path, 'utf8');
if (content.includes(`process.env.WS_RELAY_URL).origin`)) {
  console.log('[relay-ssrf-allowlist-patch] already patched, skipping');
  process.exit(0);
}
if (!content.includes(anchor)) {
  console.error('[relay-ssrf-allowlist-patch] anchor not found — upstream source changed, needs re-check');
  process.exit(1);
}
writeFileSync(path, content.replace(anchor, insertion));
console.log('[relay-ssrf-allowlist-patch] patched');
