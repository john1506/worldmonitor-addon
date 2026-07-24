# Changelog

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
