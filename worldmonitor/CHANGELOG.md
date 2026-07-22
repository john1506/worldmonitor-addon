# Changelog

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
