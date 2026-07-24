// ais-relay.cjs unconditionally starts 4 loops that keep the upstream
// koala73/worldmonitor.app Vercel deployment's edge caches warm: CII risk
// scores (8min), chokepoint status (30min), cable health (30min), and
// service statuses (15min). Each one is a real HTTPS round-trip to
// api.worldmonitor.app that authenticates as a "trusted internal caller"
// via WORLDMONITOR_RELAY_KEY -- a private credential belonging to koala73's
// own infrastructure that no legitimate self-hoster can or should have.
// Without it every single ping 401s, forever, on a fixed schedule -- pure
// wasted network/CPU/log-noise with zero chance of ever succeeding in this
// context. Skips starting these specific loops when the key isn't set;
// nothing else in the relay is touched (AIS/oref/telegram all keep working
// exactly as before -- confirmed, none of them depend on this key).
import { readFileSync, writeFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node relay-warmping-skip-patch.mjs <path-to-ais-relay.cjs>');
  process.exit(1);
}

const old = `  startCiiWarmPingLoop();
  startChokepointWarmPingLoop();
  startCableHealthWarmPingLoop();
  startPositiveEventsSeedLoop();
  startClassifySeedLoop();
  startServiceStatusesSeedLoop();
  startTheaterPostureSeedLoop();`;

const patched = `  if (RELAY_API_KEY) {
    startCiiWarmPingLoop();
    startChokepointWarmPingLoop();
    startCableHealthWarmPingLoop();
  } else {
    console.log('[Relay] WORLDMONITOR_RELAY_KEY not set — skipping CII/chokepoint/cable-health warm-ping loops (self-hosted deployments never have this key; they would 401 forever)');
  }
  startPositiveEventsSeedLoop();
  startClassifySeedLoop();
  if (RELAY_API_KEY) {
    startServiceStatusesSeedLoop();
  } else {
    console.log('[Relay] WORLDMONITOR_RELAY_KEY not set — skipping ServiceStatuses seed-ping loop (would 401 forever)');
  }
  startTheaterPostureSeedLoop();`;

const content = readFileSync(path, 'utf8');
if (content.includes(`if (RELAY_API_KEY) {\n    startCiiWarmPingLoop();`)) {
  console.log('[relay-warmping-skip-patch] already patched, skipping');
  process.exit(0);
}
if (!content.includes(old)) {
  console.error('[relay-warmping-skip-patch] anchor not found — upstream source changed, needs re-check');
  process.exit(1);
}
writeFileSync(path, content.replace(old, patched));
console.log('[relay-warmping-skip-patch] patched');
