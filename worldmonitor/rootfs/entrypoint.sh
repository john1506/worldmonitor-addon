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
  SEED_INTERVAL_MINUTES="$(jq -r '.seed_interval_minutes // 30' "$OPTIONS")"
  export GROQ_API_KEY OPENROUTER_API_KEY

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
# Freshly generated per start like the Redis/local-API secrets above — only
# backs short-lived anonymous session tokens, nothing persisted needs it.
export WM_SESSION_SECRET="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")"

envsubst '$LOCAL_API_PORT $LOCAL_API_TOKEN' < /etc/nginx/nginx.conf.template > /tmp/nginx.conf

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/worldmonitor.conf
