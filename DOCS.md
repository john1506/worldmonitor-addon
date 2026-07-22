# World Monitor

Self-hosted build of [koala73/worldmonitor](https://github.com/koala73/worldmonitor) — a
real-time geopolitical, financial, and climate intelligence dashboard — packaged as a
Home Assistant add-on.

## What's included / left out

This add-on runs, in one container via supervisord:

- The World Monitor web app (nginx + its Node.js API sidecar)
- A local Redis instance and the project's own Redis-REST proxy (so the caching layer
  the app expects actually exists)
- A background loop that re-runs the project's ~150 `seed-*.mjs` scripts every
  `seed_interval_minutes` (default 30) — most need no API key at all (earthquakes,
  weather, conflicts, prediction markets, crypto, etc.)

**Not included:** the AIS relay (live vessel/ship tracking). That's an always-on
extra process that also needs its own `AISSTREAM_API_KEY`. Every other panel works
without it — the map just won't show live ships. Ask if you want this added later.

Redis is in-memory only (not persisted) — a restart means a few minutes of empty
panels while the seed loop repopulates the cache.

## Configuration

| Option | Purpose |
|---|---|
| `groq_api_key` | Free at https://console.groq.com — powers AI intelligence-assessment summaries |
| `openrouter_api_key` | Optional fallback LLM provider (free tier, 50 req/day) |
| `seed_interval_minutes` | How often to re-run the seed scripts (default 30) |
| `extra_env` | List of `KEY=VALUE` strings for any other upstream env var |

Everything in `extra_env` is exported as-is before the app starts. Useful free-tier keys
worth adding here as your dashboard settles in (see upstream's `.env.example` for the
full ~200-variable list):

```yaml
extra_env:
  - "NASA_FIRMS_API_KEY=..."      # wildfire detections — https://firms.modaps.eosdis.nasa.gov
  - "FINNHUB_API_KEY=..."         # stock quotes — https://finnhub.io
  - "AISSTREAM_API_KEY=..."       # some maritime seeders (not live tracking) — https://aisstream.io
  - "FRED_API_KEY=..."            # US economic data — https://fred.stlouisfed.org
  - "EIA_API_KEY=..."             # energy data — https://www.eia.gov/opendata
  - "ACLED_EMAIL=..."             # conflict/unrest data — https://acleddata.com
  - "ACLED_PASSWORD=..."
```

## Access

This add-on uses Ingress — open it from the Home Assistant sidebar ("World Monitor"),
no separate port or login needed.

## Installing (local add-on)

This folder was staged at `/share/worldmonitor-addon` because the Claude Code add-on
container doesn't have the Supervisor's `/addons/local` folder mounted. To install it:

1. Copy this whole folder into your `addons/local/worldmonitor` directory — e.g. via
   the Samba share add-on, the Studio Code Server add-on, or SSH:
   ```bash
   cp -r /share/worldmonitor-addon /addons/local/worldmonitor
   ```
2. In Home Assistant: **Settings → Add-ons → Add-on Store → ⋮ (top right) → Check for
   updates** (or reload the page) — "World Monitor" should appear under "Local add-ons".
3. Click it → **Install**. The first build compiles the frontend from source (a few
   minutes) — subsequent starts are fast.
4. Set your `groq_api_key` (and any `extra_env` keys you want) under the **Configuration**
   tab, then **Start**.
5. Give the seed loop a few minutes on first start, then open "World Monitor" from the
   sidebar.

## Source

Built from https://github.com/koala73/worldmonitor, pinned to commit
`396efb905fadda74c4ae77080a1e72658c37aa0e`. Update the `WORLDMONITOR_REF` build arg in
the Dockerfile and rebuild to pick up newer upstream commits.
