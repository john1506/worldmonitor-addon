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
- **Imagery Watch**: turn on the "Imagery Watch" panel (Settings → Panels, off by
  default) to subscribe to specific areas and get notified when new free satellite
  imagery (Sentinel-2 globally, plus higher-resolution NAIP for US locations) is
  captured there — useful for keeping an eye on a city or region over time. Checks
  every `imagery_watch_interval_minutes` (default 60). In-app notifications work
  out of the box; per-area, you can also opt in to a real Home Assistant
  notification — this add-on requests `homeassistant_api` permission for that,
  which Supervisor will likely ask you to re-approve the first time you update.
  Click any capture in an area's history to open it at full resolution (pan/zoom),
  and optionally opt an area in to keep a local copy of its imagery on disk.

**Not included:** the AIS relay (live vessel/ship tracking). That's an always-on
extra process that also needs its own `AISSTREAM_API_KEY`. Every other panel works
without it — the map just won't show live ships. Ask if you want this added later.

Redis is in-memory only (not persisted) — a restart means a few minutes of empty
panels while the seed loop repopulates the cache.

## Configuration

| Option | Purpose |
|---|---|
| `groq_api_key` | Free at https://console.groq.com — optional fallback LLM provider (see below for the primary path) |
| `openrouter_api_key` | Free at https://openrouter.ai — the primary LLM provider for this add-on's default config (see below) |
| `seed_interval_minutes` | How often to re-run the seed scripts (default 30) |
| `imagery_watch_interval_minutes` | How often Imagery Watch re-checks subscribed areas for new satellite imagery (default 60) |
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

### Which LLM actually answers a given call

There is no `ANTHROPIC_API_KEY` support in the app — its summarization code
(`server/_shared/llm.ts`) only talks to Ollama, OpenRouter, Groq, or a generic
OpenAI-compatible endpoint (`LLM_API_URL`), in that order by default. There are two
separate call "profiles", each independently overridable:

| Profile | Used for | Default provider / model | Override env vars |
|---|---|---|---|
| **tool** | Cheap/fast extraction & parsing | Groq, `llama-3.3-70b-versatile` | `LLM_TOOL_PROVIDER`, `LLM_TOOL_MODEL` |
| **reasoning** | Synthesis / intelligence-assessment writeups | OpenRouter, `deepseek/deepseek-v4-flash` | `LLM_REASONING_PROVIDER`, `LLM_REASONING_MODEL` |

**This add-on is configured to run both profiles on `nvidia/nemotron-3-super-120b-a12b:free`
via OpenRouter** — a free-tier 120B model, confirmed against OpenRouter's own
`/api/v1/models` listing. Set `openrouter_api_key`, then add:

```yaml
extra_env:
  - "LLM_TOOL_PROVIDER=openrouter"
  - "LLM_TOOL_MODEL=nvidia/nemotron-3-super-120b-a12b:free"
  - "LLM_REASONING_PROVIDER=openrouter"
  - "LLM_REASONING_MODEL=nvidia/nemotron-3-super-120b-a12b:free"
```

`groq_api_key` becomes optional at that point — the profile's provider chain still
falls back to Groq (then a generic endpoint) if OpenRouter/nemotron errors or rate-limits,
so it's worth keeping set as a safety net even though it's no longer the primary path.

## Access

This add-on uses Ingress — open it from the Home Assistant sidebar ("World Monitor"),
no separate port or login needed.

## Installing (custom repository)

1. In Home Assistant: **Settings → Add-ons → Add-on Store**
2. **⋮ (top right) → Repositories** → add `https://github.com/john1506/worldmonitor-addon`
3. "World Monitor" appears in the store under this repository. Click it → **Install**.
   `config.yaml` points at a prebuilt image
   (`ghcr.io/john1506/worldmonitor-addon`), so this just pulls it — no on-device build,
   no waiting on npm/vite.
4. Set your `groq_api_key` (and any `extra_env` keys you want) under the **Configuration**
   tab, then **Start**.
5. Give the seed loop a few minutes on first start, then open "World Monitor" from the
   sidebar.

## Source

The add-on packaging itself lives at https://github.com/john1506/worldmonitor-addon —
its `.github/workflows/build.yml` rebuilds and pushes the image to GHCR on every push to
`main`. The Dockerfile it builds clones and compiles
https://github.com/john1506/worldmonitor's `self-hosted` branch from source, pinned to
a specific commit (the `WORLDMONITOR_REF` build arg) — our own fork of
https://github.com/koala73/worldmonitor carrying a set of self-hosted-specific
panel/feature unlocks as normal commits on top of upstream (see the fork's commit
history, and its `FORK.md`, for how those get maintained and how upstream fixes get
pulled in). GitHub Actions rebuilds and re-pushes this add-on's image automatically on
every push to `main`; the Pi only ever pulls the finished image.
