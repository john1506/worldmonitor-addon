# =============================================================================
# World Monitor — Home Assistant Add-on image
#
# Wraps koala73/worldmonitor (self-hosted build) for HA Supervisor + Ingress.
# Reuses the upstream project's own multi-stage build (builder/runtime-deps)
# unmodified, then adds: a local Redis + Redis-REST proxy (so the dashboard
# has data to show instead of the "0/55 OK" empty state upstream warns about
# without a seeded cache), the seed scripts + full deps to re-seed
# periodically in-container, and an options.json -> env bridge for HA's
# add-on configuration UI. AIS relay (live vessel tracking) is intentionally
# omitted — it's an always-on extra process needing its own API key; every
# other panel is seeded from free public data sources.
# =============================================================================

ARG WORLDMONITOR_REF=396efb905fadda74c4ae77080a1e72658c37aa0e
ARG NODE_BASE=node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd

# ── Stage 1: Builder (upstream's own build steps, verbatim) ─────────────────
FROM ${NODE_BASE} AS builder
ARG WORLDMONITOR_REF
WORKDIR /app

RUN apk add --no-cache git \
    && git clone https://github.com/koala73/worldmonitor.git . \
    && git checkout "${WORLDMONITOR_REF}"

RUN npm ci --ignore-scripts

# Compile TypeScript API handlers → self-contained ESM bundles
RUN node docker/build-handlers.mjs

# Build the crawlable static corpus and Vite frontend (outputs to dist/).
# --base ./ emits relative asset paths (assets/foo.js instead of /assets/foo.js).
# Required for HA Ingress: the dashboard is loaded inside an iframe rooted at
# /api/hassio_ingress/<token>/, and an absolute path resolves against the HA
# frontend's own origin root, not back through the ingress proxy to us — so
# every JS/CSS asset 404s and the app never gets past its own loading skeleton.
RUN npm run build:crawlable-corpus && npm run build:content-corpus && npx tsc && npx vite build --base ./

# globe-render-settings.ts hardcodes its earth-texture paths as absolute
# ("/textures/earth-blue-marble.jpg") — a runtime string literal, not a
# Vite-tracked asset reference, so --base ./ above doesn't touch it. Under
# Ingress that absolute path resolves against the HA frontend's own origin
# root and never reaches this add-on (confirmed: zero /textures/ requests
# ever hit this container's nginx access log, while the JS chunk that
# defines it loaded fine every time — the fetch just goes to the wrong
# origin and silently fails). Works on production only because it's served
# from the domain root, where the absolute path happens to resolve right.
# Patch to the same import.meta.url-relative pattern already used
# correctly elsewhere in this codebase for Worker construction, which
# resolves correctly regardless of ingress path nesting depth.
RUN for f in dist/assets/globe-render-settings-*.js; do \
      sed -i \
        -e 's#"/textures/\([^"]*\)"#new URL("../textures/\1",import.meta.url).href#g' \
        "$f"; \
      grep -q 'textures/earth-blue-marble.jpg",import.meta.url).href' "$f" || \
        (echo "ERROR: globe texture path patch did not apply — upstream source changed, needs re-check" >&2 && exit 1); \
    done

# The app's ~150 fetch("/api/...") call sites (RPC clients, RSS proxy, session
# bootstrap, etc.) are all plain absolute-path string literals too, same class
# of bug as the texture paths above but far too many sites to sed individually
# — and this one has no equivalent already-correct pattern to copy (the Worker
# import.meta.url trick doesn't apply to a runtime fetch() call). Confirmed via
# browser console: every single /api/* and /data/* call 404s under Ingress
# (hits HA's own /api/ REST namespace instead of this add-on), while direct
# non-Ingress access works fine. Fixes it the same way the codebase already
# solves this for its Tauri desktop sidecar (a runtime base-path indirection),
# but done as a tiny inline bootstrap since there's no equivalent web-build
# config for it: detects the Ingress prefix from location.pathname and
# rewrites matching fetch() targets to carry it, before any other script
# (including the app's own Tauri-only fetch patch) can run. No-ops completely
# outside Ingress (the regex requires the /api/hassio_ingress/<token>/ shape).
COPY rootfs/build-patches/ingress-api-patch.mjs /tmp/ingress-api-patch.mjs
RUN node /tmp/ingress-api-patch.mjs dist/dashboard.html && \
    grep -q 'data-wm-ingress-api-patch' dist/dashboard.html || \
      (echo "ERROR: ingress API-path patch did not apply" >&2 && exit 1)

# ── Stage 2: Runtime dependencies for the raw (unbundled) API handlers ──────
FROM ${NODE_BASE} AS runtime-deps
WORKDIR /app
COPY --from=builder /app/docker/runtime-package.json ./package.json
COPY --from=builder /app/docker/runtime-package-lock.json ./package-lock.json
RUN npm ci --omit=dev --omit=optional --ignore-scripts

# ── Stage 3: Redis REST proxy (upstream's own tiny Node shim) ──────────────
FROM ${NODE_BASE} AS redis-rest-deps
WORKDIR /app
COPY --from=builder /app/docker/redis-rest-proxy.mjs ./redis-rest-proxy.mjs
RUN npm init -y >/dev/null && npm install redis@4

# ── Stage 4: Final runtime — nginx + node API + redis + redis-rest + seeders
FROM ${NODE_BASE} AS final

RUN apk add --no-cache nginx supervisor gettext redis jq tini coreutils && \
    mkdir -p /tmp/nginx-client-body /tmp/nginx-proxy /tmp/nginx-fastcgi \
             /tmp/nginx-uwsgi /tmp/nginx-scgi /var/log/supervisor && \
    addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Main app — exact same artifacts upstream's own Dockerfile ships
COPY --from=builder /app/src-tauri/sidecar/local-api-server.mjs ./local-api-server.mjs
COPY --from=builder /app/src-tauri/sidecar/package.json ./package.json
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=builder /app/api ./api
COPY --from=builder /app/data ./data
COPY --from=builder /app/dist /usr/share/nginx/html

# Seed scripts + full source + full node_modules, for the in-container
# periodic re-seed loop (scripts/seed-*.mjs need the full dependency graph,
# not the trimmed runtime-deps set used by the raw API handlers above).
COPY --from=builder /app /app/seed

# Two upstream seeders exist but never run in self-hosted mode:
#  - scripts/fetch-gpsjam.mjs fetches gpsjam.org (free, no auth) but isn't
#    named seed-*.mjs, so seed-loop.sh's glob (run-seeders.sh) skips it.
#  - satellite TLE seeding only exists inside scripts/ais-relay.cjs (the
#    Railway relay service, which this add-on intentionally omits) — no
#    seed-*.mjs equivalent ships upstream at all.
# Both fetch from free/no-key public sources (gpsjam.org, celestrak.org).
# The satellite one is adapted from ais-relay.cjs's seedSatelliteTLEs() to
# the standalone seed-*.mjs convention so it needs no relay/API key either.
COPY rootfs/seed-scripts/seed-gpsjam.mjs rootfs/seed-scripts/seed-satellites.mjs /app/seed/scripts/

# Redis REST proxy (Upstash-compatible shim upstream wrote themselves)
COPY --from=redis-rest-deps /app /app/redis-rest

# Nginx template + our supervisord config (extends upstream's with
# redis / redis-rest / seed-loop programs) + our own entrypoint
COPY --from=builder /app/docker/nginx.conf /etc/nginx/nginx.conf.template
COPY rootfs/supervisord.conf /etc/supervisor/conf.d/worldmonitor.conf
COPY rootfs/entrypoint.sh /app/entrypoint.sh
COPY rootfs/seed-loop.sh /app/seed-loop.sh
RUN chmod +x /app/entrypoint.sh /app/seed-loop.sh

RUN chown -R appuser:appgroup /app /tmp/nginx-client-body /tmp/nginx-proxy \
    /tmp/nginx-fastcgi /tmp/nginx-uwsgi /tmp/nginx-scgi /var/log/supervisor \
    /var/lib/nginx /var/log/nginx

# Stays root: HA Supervisor mounts /data/options.json root-only (0600), and
# entrypoint.sh must read it via jq before anything else starts. Running the
# whole container as root is standard practice for HA add-ons (Supervisor's
# isolation model doesn't rely on in-container UID separation), and sidesteps
# needing gosu/su-exec just to read one config file as a different user.

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/sidecar-health >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/entrypoint.sh"]
