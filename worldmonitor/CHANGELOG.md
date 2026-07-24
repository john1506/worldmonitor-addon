# Changelog

## 1.0.7

- Fix: after updating to 1.0.6, some previously-public endpoints (news
  digest, displacement summary, forecasts, `bootstrap`, even static
  `manifest.webmanifest`) started returning 401 again. Root cause: 1.0.6
  generated a fresh `WM_SESSION_SECRET` on every container start. The app
  sets its signed session token as a long-lived `wm-session` browser cookie,
  and `bootstrap.js`'s auth check treats a *present but invalid* cookie as a
  hard authentication failure ("Invalid session token", 401) rather than
  falling back to anonymous access — so any browser with a cookie from
  before a restart/update got locked out the moment the secret rotated.
  Confirmed directly (bypassing the browser and Ingress entirely): every one
  of these endpoints returns real 200 data with no session at all, so
  Ingress and the app's own routing were never the problem here. Now
  persists `WM_SESSION_SECRET` under `/data` (survives restarts and
  updates) instead of regenerating it each start; existing cookies stay
  valid across restarts. If you were affected, one hard-refresh/incognito
  load after updating clears it out.
- Note: `oref-alerts` and `telegram-feed` returning 503 ("Service
  Unavailable") is expected and not a bug — both require `WS_RELAY_URL`, a
  real-time WebSocket relay service in the same category as the AIS relay
  this add-on already intentionally omits (see 1.0.0). Not fixable without
  running/pointing to that relay.

## 1.0.6

- Fix: many "anonymous" API calls (news digest, displacement summary,
  forecasts, satellite list, etc.) still failed after the 1.0.5 ingress-path
  fix — some as a real 401/503, but far more than that got suppressed
  client-side. Root cause: `POST /api/wm-session` (which signs a short-lived
  anonymous session token via plain HMAC) always 503'd with "Session service
  not configured" because `WM_SESSION_SECRET` was never set in this add-on's
  environment. The frontend's own client-side circuit breaker then treats
  that failure as a signal to suppress a wide swath of *other* anonymous API
  calls for a cooldown period — including several that would otherwise
  succeed fine. `entrypoint.sh` now generates a fresh 32-byte
  `WM_SESSION_SECRET` on every start, the same way it already does for the
  Redis and local-API secrets. This turned out to be the real explanation for
  the "some background fetches still come back 401" note in 1.0.5 below —
  not an HA Ingress auth-layer issue as speculated there.
- Correction to the 1.0.5 note: confirmed via direct request testing that the
  three genuinely public/anonymous RPCs (news digest, displacement summary,
  forecasts) return real data once reached through the ingress-path fix and
  with a working session token. Other endpoints (risk scores, security
  advisories, humanitarian summary, temporal baseline, etc.) do return a
  real 401 "API key required" — that part is a genuine paid-tier
  entitlement gate on api.worldmonitor.app, not fixable from this add-on.

## 1.0.5

- Fix: almost every data panel was empty under Ingress — every single
  `fetch("/api/...")` and `fetch("/data/...")` call in the app (dozens of RPC
  clients, the RSS proxy, session bootstrap, country-geometry data, etc.) is a
  hardcoded absolute-path string literal, the same class of bug as the 1.0.4
  texture fix but far too widespread to patch site-by-site. Under Ingress
  these resolve against the HA frontend's own origin root and never reach
  this add-on at all (confirmed: zero matching requests ever hit this
  container's nginx log, while direct non-Ingress access worked fine).
  Injects a small inline bootstrap script into `dashboard.html`, running
  before any other script, that detects the Ingress path prefix from
  `location.pathname` and rewrites matching `fetch()` targets to carry it.
  Completely inert outside Ingress.
  - Known remaining issue after this fix: some background fetches still come
    back 401 even though they never reach this container's nginx (confirmed
    via access log) — looks like it may be Home Assistant's own Ingress
    session/auth layer rejecting some background XHR/fetch calls before
    forwarding them, not something this add-on controls. Needs further
    investigation.

## 1.0.4

- Fix: 3D globe view never rendered under Ingress (worked fine on production/
  worldmonitor.app). `globe-render-settings.ts` hardcodes its earth-texture
  paths as an absolute `/textures/...` string literal — not a Vite-tracked
  asset reference, so the 1.0.2 `--base ./` fix didn't touch it. Under Ingress
  that absolute path resolves against the HA frontend's own origin root and
  never reaches this add-on (confirmed zero `/textures/` requests ever hit
  this container's nginx log, while the JS defining the path loaded fine
  every time — it silently fetched from the wrong origin). Only worked on
  production because that's served from the domain root. Patched post-build
  to the same `import.meta.url`-relative pattern already used correctly
  elsewhere in this codebase for Worker construction, which resolves right
  regardless of ingress path nesting depth.

## 1.0.3

- Fix: GPS-jamming layer and satellite tracking layer never had data to show.
  - `scripts/fetch-gpsjam.mjs` (free gpsjam.org source, no key needed) exists upstream
    but isn't named `seed-*.mjs`, so the in-container seed loop's glob skipped it.
    Now installed as `seed-gpsjam.mjs` so it runs on the normal seed cadence.
  - Satellite TLE seeding only existed upstream inside `scripts/ais-relay.cjs` (the
    Railway relay service, which this add-on intentionally omits — see 1.0.0 note).
    Extracted the CelesTrak fetch (free, no key) into a standalone `seed-satellites.mjs`
    following the same `seed-*.mjs` convention.
  - Note: the AI insights/digest panel remains cloud-only — it warms its cache via a
    Vercel RPC gated behind an API key/session token tied to the paid worldmonitor.app
    product, with no local/self-hosted bypass. Not something this add-on can fix.

## 1.0.2

- Fix: dashboard never loaded past its own loading-skeleton screen under Ingress.
  The built frontend referenced all assets with absolute paths (`/assets/...`), which
  resolve against the Home Assistant frontend's own origin root inside the ingress
  iframe instead of back through the ingress proxy to this add-on. Rebuilt with
  `vite build --base ./` for relative asset paths, which resolve correctly under both
  ingress and direct root access.

## 1.0.1

- Fix: container was dropping to a non-root user before the entrypoint could read
  `/data/options.json` (root-only), causing a permission-denied crash on start. Runs as
  root now — standard for HA add-ons.

## 1.0.0

- Initial release: World Monitor (koala73/worldmonitor) packaged as an HA add-on with
  Ingress, bundled Redis + Redis-REST proxy, and an in-container seed loop.
  AIS relay (live vessel tracking) intentionally omitted.
