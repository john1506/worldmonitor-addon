#!/bin/sh
set -e

OPTIONS=/data/options.json

json_str() {
  # $1 = key, prints "" if missing/null instead of the literal string "null"
  jq -r --arg k "$1" '.[$k] // ""' "$OPTIONS"
}

if [ -f "$OPTIONS" ]; then
  GROQ_API_KEY="$(json_str groq_api_key)"
  OPENROUTER_API_KEY="$(json_str openrouter_api_key)"
  AISSTREAM_API_KEY="$(json_str aisstream_api_key)"
  # These five all already have working seed-*.mjs scripts shipped upstream
  # (they run every seed cycle regardless) — they've just been silently
  # failing/skipping this whole time with no key configured. No new seeders
  # or Dockerfile changes needed, just wiring the option through.
  NASA_FIRMS_API_KEY="$(json_str nasa_firms_api_key)"
  UCDP_ACCESS_TOKEN="$(json_str ucdp_access_token)"
  EIA_API_KEY="$(json_str eia_api_key)"
  FRED_API_KEY="$(json_str fred_api_key)"
  OPENSKY_CLIENT_ID="$(json_str opensky_client_id)"
  OPENSKY_CLIENT_SECRET="$(json_str opensky_client_secret)"
  SEED_INTERVAL_MINUTES="$(jq -r '.seed_interval_minutes // 30' "$OPTIONS")"
  export GROQ_API_KEY OPENROUTER_API_KEY AISSTREAM_API_KEY \
    NASA_FIRMS_API_KEY UCDP_ACCESS_TOKEN EIA_API_KEY FRED_API_KEY \
    OPENSKY_CLIENT_ID OPENSKY_CLIENT_SECRET

  # extra_env: list of "KEY=VALUE" strings for anything not exposed as its
  # own option (NASA_FIRMS_API_KEY, FINNHUB_API_KEY, ACLED_*, etc. — see
  # DOCS.md for the full upstream list).
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    key="${line%%=*}"
    case "$key" in
      *[!A-Za-z0-9_]*|"") continue ;;
    esac
    export "$line"
  done <<EOF
$(jq -r '.extra_env[]? // empty' "$OPTIONS")
EOF
else
  SEED_INTERVAL_MINUTES=30
fi

export SEED_INTERVAL_SECONDS=$((SEED_INTERVAL_MINUTES * 60))

# Internal-only secrets wiring Redis <-> the REST proxy <-> the app.
# Neither Redis (6379) nor the REST proxy (8079) are published outside the
# container — only nginx's 8080 is reachable, via Ingress — so these can be
# freshly generated on every start with no external caller to break.
export REDIS_PASSWORD="$(node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))")"
export REDIS_TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")"

export UPSTASH_REDIS_REST_URL="http://127.0.0.1:8079"
export UPSTASH_REDIS_REST_TOKEN="$REDIS_TOKEN"
export LOCAL_API_MODE="docker"
export LOCAL_API_CLOUD_FALLBACK="false"

export LOCAL_API_PORT="${LOCAL_API_PORT:-46123}"
if [ -z "${LOCAL_API_TOKEN:-}" ]; then
  LOCAL_API_TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")"
  export LOCAL_API_TOKEN
fi

# api/wm-session.js signs anonymous session tokens with this (plain HMAC,
# no external auth service) — without it every /api/wm-session call 503s
# "Session service not configured", and the frontend's own client-side
# circuit breaker then suppresses a wide swath of OTHER anonymous API calls
# (including ones that would otherwise work, like the public news digest)
# for a cooldown period. Fixes far more than just the session endpoint.
#
# Unlike the Redis/local-API secrets above, this one MUST persist across
# restarts: the app sets the signed session token as a long-lived `wm-session`
# cookie in the browser, and bootstrap.js treats a present-but-invalid cookie
# as a hard authentication failure (401 "Invalid session token"), not a
# fall-through to anonymous access. Regenerating the secret on every start
# (as originally shipped in 1.0.6) silently invalidates every browser's
# existing cookie on the next restart/update, reproducing the exact 401s this
# fix was meant to solve. Persist it under /data (survives restarts/updates)
# and only generate once.
WM_SESSION_SECRET_FILE="/data/wm_session_secret"
if [ ! -s "$WM_SESSION_SECRET_FILE" ]; then
  node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))" > "$WM_SESSION_SECRET_FILE"
fi
export WM_SESSION_SECRET="$(cat "$WM_SESSION_SECRET_FILE")"

# ais-relay.cjs (scripts/ais-relay.cjs) is the upstream project's general
# proxy relay — AIS vessel tracking, oref-alerts, telegram-feed, etc. all
# read from it via WS_RELAY_URL rather than talking to their upstreams
# directly. Runs in-container (ais-relay-wrapper.sh no-ops if
# AISSTREAM_API_KEY isn't set — see that script and its own supervisord
# entry). RELAY_SHARED_SECRET only needs to match between the relay and the
# handlers that call it (get-vessel-snapshot.ts, oref-alerts.js, etc.) —
# both are children of this same entrypoint, so a fresh per-boot secret is
# fine here (unlike WM_SESSION_SECRET, nothing external caches this one).
export RELAY_SHARED_SECRET="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")"
export WS_RELAY_URL="http://127.0.0.1:3004"

envsubst '$LOCAL_API_PORT $LOCAL_API_TOKEN' < /etc/nginx/nginx.conf.template > /tmp/nginx.conf

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/worldmonitor.conf
