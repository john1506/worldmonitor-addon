# Changelog

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
