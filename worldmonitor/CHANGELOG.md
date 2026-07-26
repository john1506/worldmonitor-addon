# Changelog

## 1.7.0

- **Imagery Watch, Phase 2** — four additions on top of 1.6.0's core
  subscribe/poll/notify/replay loop:
  - **Home Assistant notifications**: added `homeassistant_api: true` to
    this add-on's permissions (Supervisor will likely prompt you to
    re-approve add-on permissions on update — this is expected). Each
    tracked area can opt in to also fire a real HA `persistent_notification`
    when new imagery lands, on top of the existing in-app badge/toast.
    Suppressed for the initial historical backfill when you first add an
    area — only fires for genuinely new captures afterward.
  - **Full-resolution viewer**: click any capture in an area's history to
    open it beyond the small thumbnail — reads a real, higher-resolution
    layer directly from the source Cloud-Optimized GeoTIFF in your browser
    (no new server-side infrastructure; COGs are designed for exactly this
    kind of partial HTTP-range read), with drag-to-pan and scroll-to-zoom.
    Falls back to the plain preview if that fails for any reason.
  - **Local re-hosting** (per-area opt-in): keeps a local copy of preview
    images on disk so an area's history survives even if it ages out of
    the free upstream source. Capped at 500MB total, oldest evicted first
    — deliberately caches previews only, not the much larger raw imagery,
    to avoid filling a Pi's disk.
  - **Suggested areas**: the "+ Add area" form now surfaces the 5 most
    active conflict zones from the last 60 days (same UCDP conflict-event
    data already powering the UCDP Events panel) as one-click suggestions,
    alongside the existing manual pin/radius flow.
  - Frontend half lives in the `john1506/worldmonitor` fork, same as
    1.6.0; this bumps `WORLDMONITOR_REF` to pick it up.

## 1.6.0

- Add **Imagery Watch**: subscribe to a specific area (a city, a conflict
  zone, anywhere) and get notified when new satellite imagery is captured
  there. New "Imagery Watch" panel (off by default, in the Full/Tech/
  Finance/Commodity variants) lets you name an area, use the current map
  view as its center, and set a radius; from then on it's tracked
  automatically.
  - `imagery-relay.mjs` gained a background poll loop (interval configurable
    via the new `imagery_watch_interval_minutes` option, default 60) that
    re-queries free STAC imagery sources for every subscribed area and
    records anything new to Redis. New "auto mode": queries Sentinel-2
    (10m/px, global) always, and also NAIP (Microsoft's Planetary Computer,
    0.6-1m/px) for areas within the continental US — verified both keyless
    for search *and* actual asset access before relying on them, live
    against the running add-on, not assumed. (Other candidate free sources
    were checked and rejected: Umbra's open SAR data turned out to be a
    small curated demo catalog, not an on-demand searchable archive for
    arbitrary areas.)
  - In-app only for now: an unread badge on the panel plus a toast when new
    imagery lands. No Home Assistant notification integration yet, no
    high-resolution zoomable viewer, no local re-hosting of imagery, no
    suggested-areas feature — those are a following release. Clicking a
    capture currently opens the source image directly.
  - New nginx route (`/api/imagery-watch/v1/*`) alongside the existing
    imagery-relay route, same proxy pattern.
- This is also the first feature built directly in the `john1506/
  worldmonitor` fork (see 1.5.0) rather than as a patch file — bumped
  `WORLDMONITOR_REF` to the fork commit that adds the panel.

## 1.5.0

- Build from a real fork (`github.com/john1506/worldmonitor`, `self-hosted`
  branch) instead of `koala73/worldmonitor` + 7 `git apply`'d patch files.
  The 7 patches shipped through 1.4.4 (vanilla-client, free-tier-uncap,
  playback-unlock, api-keys-tab-remove, flight-search-unlock,
  flights-layer-default-on, panel-key-prune-migration) are now individual
  commits on the fork's `self-hosted` branch, on top of the same pinned
  upstream commit — same behavior, verified with `tsc --noEmit` against the
  migrated fork before switching the Dockerfile over. `rootfs/source-
  patches/` is gone; `WORLDMONITOR_REF` now pins a commit SHA on our own
  fork rather than upstream directly. See `FORK.md` for the rebase workflow
  to pull in upstream fixes going forward. No user-visible behavior change
  — this is purely a maintainability move, made now because the next
  feature (satellite imagery tracking/replay) is real new functionality
  that doesn't fit the patch-file model at all.

## 1.4.4

- Fix: existing users (anyone who had the add-on running before 1.3.0)
  kept seeing Stock Analysis/Backtesting/Daily Market Brief/WM Analyst/
  Global Procurement/Trade Policy/etc. as "PRO" panels after updating,
  despite 1.3.0 removing them from `ALL_PANELS` entirely. Root cause:
  App.ts already has a one-time `worldmonitor-panel-prune-v1` migration
  that deletes saved `panelSettings` entries no longer present in
  `ALL_PANELS` — but it's genuinely one-time (its own localStorage flag),
  and it had already fired for existing users on an earlier version for
  unrelated reasons, before 1.3.0 removed these 11 keys. So their stale
  saved entries — with the old `premium: 'locked'` field baked in from
  before — never got cleaned up and kept rendering forever. Confirmed via
  the actual shipped 1.4.3 image that `ALL_PANELS` itself is clean (no
  trace of these keys in the compiled bundle) — this was purely a stale-
  localStorage issue, not a patch that failed to apply. Adds a second,
  distinctly-keyed one-time migration that reuses the same prune logic, so
  it's guaranteed to run once for every existing installation regardless
  of whether prune-v1 already fired. No-op for fresh installs.

## 1.4.3

- Turn the "Flights" map layer on by default in the variants where the
  Airline Intelligence panel is also on by default (FULL/TECH/FINANCE/
  COMMODITY). `DeckGLMap` only polls live aircraft positions when this
  layer is enabled, so the panel shipped permanently empty until a user
  separately found and toggled an unrelated Layers checkbox — a default-
  value mismatch, not a capability gap or a premium gate (confirmed by
  testing the full ADS-B pipeline live: `ais-relay.cjs` → `local-api-
  server.mjs` → nginx, real aircraft data at every hop). HAPPY/ENERGY,
  which don't ship the panel by default, are left with Flights off.

## 1.4.2

- Unlock CMD+K search's flight-callsign lookup for flights the globe is
  already tracking. `SearchManager.updateFlightSource` takes plain ADS-B/
  military position arrays as parameters (fed by the map's own live
  tracking — no network call inside the function itself) and only formats
  them into the search index; it was gated behind `isProUser()` for no
  functional reason, same category as the 1.4.0 playback fix. The
  "search live flight X" fallback for callsigns *not* currently tracked
  (which calls a paid RPC) is untouched — confirmed via the running add-on
  that `/api/aviation/v1/track-aircraft` genuinely 401s without real
  credentials, same as Resilience Ranking.
- No code change, but worth noting for anyone who thinks ADS-B/flight
  tracking is broken: it isn't. Verified the full pipeline live
  (`ais-relay.cjs` → `local-api-server.mjs` → nginx, each hop tested
  directly) and it correctly serves real aircraft positions end-to-end.
  The "Flights" map layer is just `enabled: false` by default in every
  variant's config — toggle it on in the map's Layers panel to see
  anything. (Requires `opensky_client_id`/`opensky_client_secret` set in
  the add-on's own configuration, same as always.)

## 1.4.1

- Remove the Settings modal's "API Keys" and "MCP Clients" tabs. These
  aren't the free "bring your own third-party API key" settings (Groq,
  OpenRouter, FRED, etc. — unrelated, untouched, always free) — they're for
  generating tokens against worldmonitor.app's *own* cloud REST/MCP API,
  gated by `hasFeature('apiAccess'/'mcpAccess')` reading a real Convex/Dodo
  subscription snapshot. There's no local equivalent this image can offer,
  so rather than leave a "PRO" badge pointing at a real paywall, the two
  tab buttons are removed entirely (`rootfs/source-patches/api-keys-tab-remove.patch`).
  The underlying render methods/handlers are untouched (same low-risk
  pattern as the ProBanner removal in 1.3.0) — just unreachable, since
  nothing else in the app can navigate to these tab IDs.
- Swept the rest of the codebase for other Pro-gated features that might
  have no real capability gap, following the same pattern that led to the
  playback-scrubber fix in 1.4.0. Found two more candidates — the search
  modal's flight-callsign search and the globe's "Resilience Ranking"
  layer — but this time verified live against the running add-on instead
  of assuming from the code shape: both hit local API handlers
  (`/app/api/aviation/v1/`, `/app/api/resilience/v1/`) that genuinely
  return 401 without real worldmonitor.app credentials, same as
  trade-policy/global-procurement before they were removed as panels.
  Left both gated — unlocking them would just surface a broken feature
  instead of a hidden one.

## 1.4.0

- Uncap the free-tier panel/source limits at every enforcement point, not
  just the one already patched in 1.0.8. `FREE_MAX_PANELS`/`FREE_MAX_SOURCES`
  (40/80) turned out to be checked independently in ~4 separate places —
  App.ts's boot-time trim (the only one the existing compiled-bundle sed
  patch touched), the settings-window panel/source toggle handlers, and
  panel-layout.ts's add-panel path — all reading the same two exported
  `panels.ts` constants. Raising both to `Infinity` at the source
  (`rootfs/source-patches/free-tier-uncap.patch`) neutralizes every one of
  them in a single change, so re-enabling a source or panel in Settings no
  longer silently no-ops with a "Free plan: max N" toast. Deliberately did
  NOT patch `isProUser()` itself — that function also gates unrelated Pro
  cloud features (search enhancements, widget entitlements) this add-on has
  no credentials to actually deliver, so faking "everyone is Pro" would
  trade one bug for another.
- Un-hide the "Historical Playback" scrubber. Existed in upstream already —
  15-minute dashboard snapshots (news event clusters, market prices,
  hotspot levels) captured into the browser's own IndexedDB, fully local,
  no cloud dependency — but was hidden with `display: none` behind a direct
  `user?.role === 'pro'` check in `setupPlaybackControl()`, a different
  gate than the panel-lock system the 1.3.0 vanilla-client patch already
  handles. Removed the gate and its auth-state subscription
  (`rootfs/source-patches/playback-unlock.patch`); the control is just
  always shown now. Look for the ⏪ icon in the dashboard header.
- Both changes verified against the pinned commit: `git apply --check`
  applies cleanly stacked on top of the existing vanilla-client patch, and
  `npx tsc --noEmit` passes with all three source patches applied together.

## 1.3.0

- Add a "vanilla" self-hosted client: source-level removal of the panels
  that were unconditionally `premium: 'locked'` and only ever showed an
  upsell stub for self-hosters (no free path exists for them at all,
  unlike `premium: 'enhanced'` panels which already work fully free).
  Applied as a real git patch
  (`rootfs/source-patches/vanilla-client.patch`) to the pinned upstream
  checkout before `npm ci`/`tsc`/`vite build` run, not a post-build patch —
  so the removed panels never appear in search, settings, or category
  lists in the first place, rather than being hidden behind a gate.
  - Removed 11 panels across the 5 variant panel-config blocks: Stock
    Analysis, Backtesting, Daily Market Brief, WM Analyst (chat-analyst),
    Global Procurement, Trade Policy, Latest Brief, WSB Ticker Scanner, AI
    Market Implications, Regional Intelligence, Deduct Situation.
  - Left untouched: the `premium: 'enhanced'` panels (Country
    Instability/`cii`, Strategic Risk, Live Intelligence/`gdelt-intel`,
    Supply Chain) — these already work fully for free/self-hosted users,
    Pro just adds bonus extras on top. Also left untouched the
    desktop-only-locked panels (Forecast, OREF Sirens, Telegram Intel) —
    these are never locked on web/self-hosted builds regardless of this
    patch.
  - Dropped the single `showProBanner()` call site in `App.ts` (plus its
    import) so the "Upgrade to Pro" banner never mounts.
    `src/components/ProBanner.ts` itself is left completely untouched —
    its exports are simply never called, which avoids a `tsc`
    `strictNullChecks` regression that showed up when gutting the
    function body directly (an early `return` before existing code left
    now-dead-but-still-typechecked branches newly flagged as "possibly
    null").
  - Verified against the pinned commit: `git apply --check` applies
    cleanly to a fresh checkout, `npx tsc --noEmit` passes with the patch
    applied, and the Dockerfile build now fails loudly (rather than
    silently) if a future `WORLDMONITOR_REF` bump causes the patch to stop
    matching the removed panel keys or the `showProBanner` call site.
  - This pins to the current upstream commit rather than tracking
    upstream automatically; bumping `WORLDMONITOR_REF` in the future may
    require manually re-resolving conflicts in this patch file.

## 1.2.1

- Fix: the new imagery-scene feature from 1.2.0 404'd under Ingress —
  `src/services/imagery.ts` builds its request via
  `new URL('/api/imagery/v1/search-imagery', window.location.origin).toString()`
  and calls `fetch()` with the resulting *full absolute URL string*, unlike
  every other call site in the app which passes a bare `/api/...` relative
  path. The ingress-fetch-patch (from 1.0.5) only rewrote bare relative
  paths and `Request` objects — an absolute URL string fell through both
  branches silently, so this one call site never got the ingress token
  prefix while everything else worked fine. Now also rewrites same-origin
  absolute URL strings. Confirmed live: the failing request now carries the
  ingress prefix like every other `/api/` call.

## 1.2.0

- Add free satellite imagery scenes to the 3D globe. `/api/imagery/v1/search-imagery`
  was entitlement-gated in the compiled handler (401, needs a real
  worldmonitor.app account) — but the feature itself is a scene-footprint
  overlay with click-to-preview thumbnails (not a base-texture system), and
  the client's own hardcoded preview-URL allowlist
  (`src/utils/imagery-preview.ts`) already listed
  `sentinel-cogs.s3.us-west-2.amazonaws.com`, meaning the original feature
  was already built around this exact free data source.
  - New standalone service (`imagery-relay.mjs`, same pattern as
    `ais-relay.cjs`) queries Element84's free, keyless Earth Search STAC
    API for recent Sentinel-2 L2A scenes and maps them to the exact
    `ImageryScene` response shape the client expects — no client changes
    needed at all.
  - A single nginx `location =` block routes just this one path to the new
    service; every other `/api/` route is untouched, and the existing
    (paywalled) compiled handler is completely bypassed rather than
    modified.
  - With the "satellites" layer on, panning/zooming the 3D globe now shows
    real Sentinel-2 footprint outlines with click-to-preview thumbnails —
    often from the same day. Note the resolution ceiling: Sentinel-2 is
    10m/pixel, genuinely useful real satellite imagery but not
    Google-Earth-level building detail (that needs a commercial imagery
    provider, out of scope for a free self-hosted setup). 5-minute
    in-memory cache to stay a good citizen of Element84's shared public API.

## 1.1.6

- Replace both stock 4096x2048 globe textures with 8192x4096 versions (2x
  linear, 4x pixel count) built from NASA's own public-domain source data —
  the fixed low resolution was the real ceiling on zoomed-in detail that
  1.1.3's render-scale unlock alone couldn't fix.
  - `earth-blue-marble.jpg` (daytime view): re-sourced from NASA Blue Marble
    Next Generation, the same composite family the original file was
    already a lower-res crop of.
  - `earth-topo-bathy.jpg` (the default view — despite the filename, this
    is actually the night-lights texture, not topography/bathymetry,
    confirmed by inspection): re-sourced from NASA Black Marble 2016 color.
  - Both Lanczos-downsampled from NASA's originals with a light unsharp
    mask to counter resampling/JPEG softening. Stopped at 8192 rather than
    the full 16384/21600-wide source: large enough for a real, visible
    detail upgrade (confirmed with matched-zoom UK-region crops), small
    enough to stay within WebGL max-texture-size limits on phone/Pi-class
    GPUs and keep the download reasonable (~5.8MB / ~2.5MB vs. NASA's
    26MB/8MB originals). Both are US government work, public domain.

## 1.1.5

- Stop the relay's 4 permanently-doomed warm-ping loops (CII risk scores
  every 8min, chokepoint status + cable health every 30min, service
  statuses every 15min). Each is a real HTTPS round-trip to
  api.worldmonitor.app that authenticates as a "trusted internal caller"
  via `WORLDMONITOR_RELAY_KEY` — a private credential belonging to
  koala73's own infrastructure that no self-hoster can or should have.
  Without it, every single ping 401s, forever, on a fixed schedule — not a
  Pro/paid-tier gate (the underlying features are non-premium), just an
  auth mechanism that only makes sense for the hosted product's own
  Vercel/CDN cache-warming, wasted entirely in self-hosted mode. Skips
  starting these four loops when the key is unset. Confirmed live over
  several minutes: AIS, oref-alerts, and telegram-feed are all unaffected
  (none of them depend on this key) — only the guaranteed-401 noise stops.

## 1.1.4

- Persist Redis across restarts. Redis previously ran with `--save "" --dir
  /tmp` (RDB snapshotting disabled entirely, and even if it weren't, /tmp
  doesn't survive a container recreation) — every add-on restart or update
  silently wiped the entire seeded dataset, forcing a full ~45-70 minute
  reseed across all ~140 seed scripts from empty before any panel had data
  again. Now snapshots to `/data/redis` (the one directory HA Supervisor
  actually persists across restarts/updates), with a standard save policy
  (`60 100 300 10`). `REDIS_PASSWORD` still regenerates fresh every boot as
  before — it's just an auth credential, not part of the dataset, so
  reloading old data under a new password is fine.

## 1.1.3

- Unlock the 3D globe's "4K (2x)" and "Insane (3x)" render-scale options.
  These were hardcoded `disabled: true` in the render-scale picker, and the
  scale function itself clamped every selection (including "auto", derived
  from devicePixelRatio) to a hard max of 1.5x regardless of what was
  picked — the same free-tier-cap pattern as the 80-source limit removed
  in 1.0.8, except here the extra supersampling only costs the *viewer's*
  own GPU, nothing on worldmonitor.app's side either way. Raises the clamp
  to 3x (the UI's own declared max) so picking "4K" or "Insane" actually
  takes effect. Note: this improves overall rendering sharpness/anti-
  aliasing via supersampling: it does not increase the base earth
  texture's fixed 4096x2048 resolution, which is the same file at every
  render scale and the true ceiling on texture detail at extreme zoom.

## 1.1.2

- Fix: AIS vessel data, oref-alerts, and telegram-feed all silently returned
  empty/error responses even with the relay running and correctly credentialed
  (v1.1.0/v1.1.1). Root cause: `local-api-server.mjs` wraps `fetch` with an
  SSRF guard that blocks requests to private/loopback IPs — it already
  allowlists `UPSTASH_REDIS_REST_URL`'s origin in docker mode for this exact
  reason, but never did the same for `WS_RELAY_URL`. Since `ais-relay.cjs`
  runs on `127.0.0.1:3004` in-container, every call to it was silently
  SSRF-blocked and swallowed by a bare `catch { return undefined; }`,
  presenting as "no data" (vessel snapshot), 503 (oref-alerts), or 502
  (telegram-feed) with no actual error surfaced anywhere. Adds the same
  allowlist treatment for `WS_RELAY_URL`, gated identically (docker mode
  only — desktop/production SSRF posture untouched). Confirmed live: all
  three now return real data (vessels, density zones, live oref/telegram
  feed items) immediately after the fix, no further seed loop or relay
  changes needed.

## 1.1.1

- Add options for five more free data-source keys, all backing seed-*.mjs
  scripts that already ship upstream and already run every seed cycle —
  they've just been silently skipping with no key configured, no new
  seeders or Dockerfile changes needed:
  - `nasa_firms_api_key` — fire detections (NASA FIRMS, free registration;
    `seed-fire-detections.mjs` exits non-zero without it)
  - `ucdp_access_token` — armed conflict events (Uppsala Conflict Data
    Program, free registration since 2025)
  - `eia_api_key` — oil price/production/inventory (US EIA, instant free key)
  - `fred_api_key` — Federal Reserve economic data, feeds four separate
    macro seeders (instant free key)
  - `opensky_client_id` / `opensky_client_secret` — OAuth2 credentials for
    higher OpenSky rate limits; likely the actual cause of the recurring
    "Military Flight Tracking Failed: No flights returned" — the
    unauthenticated tier is heavily rate-limited (free registration)

## 1.1.0

- Add optional AIS ship-tracking support via a new `aisstream_api_key` option
  (free key from https://aisstream.io). Runs the upstream project's own
  relay process (`scripts/ais-relay.cjs`) in-container, wired up the same
  way the hosted product uses it: `get-vessel-snapshot.ts` (Ship Traffic
  layer), `oref-alerts.js`, and `telegram-feed.js` all read from it via
  `WS_RELAY_URL`/`RELAY_SHARED_SECRET` rather than talking to their
  upstreams directly, so this should also clear the `oref-alerts` 503 as a
  side effect (Telegram intel still needs its own `TELEGRAM_API_ID`/
  `TELEGRAM_API_HASH`/`TELEGRAM_SESSION`, not covered by this). No nginx
  changes needed — the relay is only ever called server-side by our
  existing API handlers, never directly by the browser. Idles quietly
  (`ais-relay-wrapper.sh`) if no key is configured, rather than crash-
  looping (the upstream script hard-exits without one). `RELAY_SHARED_SECRET`
  is freshly generated per boot like the Redis/local-API secrets — it only
  needs to match between our own processes, nothing external caches it.

## 1.0.9

- Globe map "Layers" panel: disable the checkbox for any layer with no data,
  not just dim its label. The app already tracks per-layer data presence
  (`setLayerReady(layer, hasData)`, called after every layer fetch resolves)
  and used it only to toggle a `no-data` CSS class — the checkbox stayed
  fully clickable either way, so you could still turn on a layer that will
  never render anything (e.g. Ship Traffic, since the AIS relay is
  intentionally omitted from this self-hosted image). Hooks the same
  existing signal to also set the checkbox's `disabled` state, so it stays
  correct automatically as seeders get fixed or break over time, rather
  than hardcoding a static list of known-broken layers. Only patches the
  3D globe view's layer list for now — the 2D deck.gl map view doesn't
  implement the no-data class at all currently, so its checkboxes are
  unaffected by this change.

## 1.0.8

- Remove the free-tier 80-source / 40-panel display cap. `enforceFreeTierLimits()`
  in the frontend disables sources/panels over those counts whenever it doesn't
  detect a Pro/entitlement subscription — a purely client-side check, no server
  call involved. Since this add-on runs its own complete data pipeline (own
  Redis, own seeders, own compute), the sources it was hiding are ones we
  already fetch ourselves at our own cost — not something worldmonitor.app
  serves or pays for. Patched post-build to make `enforceFreeTierLimits()`
  always return immediately, the same way the ingress/texture fixes patch
  compiled output rather than touching build config. Does not touch (and
  cannot unlock) the genuinely paywalled endpoints — risk-scores, security
  advisories, AI insights, etc. — those require real api.worldmonitor.app
  credentials this add-on doesn't have and won't attempt to bypass.

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
