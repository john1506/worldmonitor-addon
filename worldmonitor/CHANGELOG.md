# Changelog

## 1.0.1

- Fix: container was dropping to a non-root user before the entrypoint could read
  `/data/options.json` (root-only), causing a permission-denied crash on start. Runs as
  root now — standard for HA add-ons.

## 1.0.0

- Initial release: World Monitor (koala73/worldmonitor) packaged as an HA add-on with
  Ingress, bundled Redis + Redis-REST proxy, and an in-container seed loop.
  AIS relay (live vessel tracking) intentionally omitted.
