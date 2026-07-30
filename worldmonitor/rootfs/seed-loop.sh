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
  run_start=$(date +%s)
  ./scripts/run-seeders.sh
  elapsed=$(( $(date +%s) - run_start ))
  interval="${SEED_INTERVAL_SECONDS:-1800}"
  echo "[seed-loop] seed run complete in ${elapsed}s, sleeping ${interval}s"
  # run-seeders.sh has no overall wall-clock budget of its own (only a
  # per-seeder timeout -- see run-seeders.sh's SEED_TIMEOUT, and note bundle
  # seeders are exempt from even that) so a slow cycle degrades silently
  # otherwise: this is the only place that would ever tell you the "refresh
  # every SEED_INTERVAL_MINUTES" promise has quietly stopped holding.
  if [ "$elapsed" -ge "$interval" ]; then
    echo "[seed-loop] WARNING: seed run took ${elapsed}s, >= the ${interval}s interval -- cycles are running back-to-back with no rest gap"
  fi
  sleep "$interval"
done
