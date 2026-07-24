#!/bin/sh
# ais-relay.cjs hard-exits (process.exit(1)) if AISSTREAM_API_KEY is unset —
# fine for a one-shot script, but under supervisord that becomes an infinite
# crash-restart loop (startretries exhausted, spammy logs) for anyone who
# hasn't configured a key. Idle quietly instead when it's not set, so the
# rest of the add-on (which doesn't depend on this) is unaffected.
if [ -z "${AISSTREAM_API_KEY:-}" ]; then
  echo "[ais-relay] AISSTREAM_API_KEY not set — get a free key at https://aisstream.io and set it in the add-on's aisstream_api_key option. Ship Traffic layer will stay empty until then."
  exec sleep infinity
fi

exec node /app/seed/scripts/ais-relay.cjs
