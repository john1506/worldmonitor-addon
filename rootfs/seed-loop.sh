#!/bin/sh
# Periodically repopulates the local Redis cache from ~150 upstream seed
# scripts (scripts/seed-*.mjs), most of which need no API key. Runs against
# the in-container Redis REST proxy (127.0.0.1:8079) — see SELF_HOSTING.md's
# "0/55 OK" note: without this loop the dashboard has almost nothing to show.
set -u

cd /app/seed || exit 1

# Give redis / redis-rest a moment on first boot before the first run.
sleep 10

while true; do
  echo "[seed-loop] starting seed run at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  ./scripts/run-seeders.sh
  echo "[seed-loop] seed run complete, sleeping ${SEED_INTERVAL_SECONDS:-1800}s"
  sleep "${SEED_INTERVAL_SECONDS:-1800}"
done
