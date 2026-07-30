/**
 * Fetches NORAD TLEs from CelesTrak (free, no-auth) for military/ISR/SAR/optical
 * reconnaissance satellites (plus, opt-in, Starlink and any add-on-configured
 * extra constellations -- see below) and seeds Redis key
 * `intelligence:satellites:tle:v1`, which
 * server/worldmonitor/intelligence/v1/list-satellites.ts reads.
 *
 * Recovered from scripts/ais-relay.cjs's seedSatelliteTLEs() (the Railway relay
 * service, which isn't part of this self-hosted add-on) and adapted to the
 * standalone scripts/seed-*.mjs convention (see fetch-gpsjam.mjs) so the
 * seed-loop picks it up on its own — no relay, no API key required.
 *
 * Source: celestrak.org/NORAD/elements/gp.php?GROUP={military,resource,active}&FORMAT=tle
 *
 * `active` was added after confirming directly against CelesTrak (2026-07-28)
 * that its `military`/`resource` groups currently contain zero COSMOS entries
 * at all -- meaning classify()'s `COSMOS 2[4-9]\d{2}` -> country 'RU' branch
 * below could never actually fire, regardless of the regex being correct.
 * The real Russian ISR/recon birds (Persona `COSMOS 2506`, Bars-M `COSMOS
 * 2503/2515/2556`, GEO-IK `COSMOS 2517`, etc.) exist in CelesTrak's data but
 * aren't tagged into either curated group; they're only reachable via the
 * full `active` catalog. This fetch/parse pass always runs regardless of the
 * Starlink/extra-filter options below -- those only control what gets kept
 * out of the same `active` response, not whether it's fetched.
 *
 * Starlink: `active` already contains all ~7,000 Starlink satellites (no
 * separate GROUP fetch needed for it), classified under their own 'STARLINK'
 * bucket (not folded into 'US', which stays reserved for actual US ISR birds
 * -- see FlatEarthView.ts's satelliteCountryFilter, which lets each bucket be
 * toggled independently). At ~7,000 markers this is a real cost on two axes:
 * client-side rendering (CSS2DObject markers are real DOM elements
 * repositioned every animation frame) AND server-side -- every
 * list-satellites.ts request re-parses and re-maps the full cached array in
 * the long-lived worldmonitor-api process, not just this seeder's own
 * (short-lived, memory-releasing-on-exit) fetch/filter pass. That server-side
 * cost is what actually drove sustained RSS growth on constrained hosts, not
 * a leak in this script. Gated behind ENABLE_STARLINK_SATELLITES (add-on
 * option `enable_starlink_satellites`, default off) for exactly that reason
 * -- opt back in via the HA add-on configuration panel.
 *
 * EXTRA_SATELLITE_FILTERS (add-on option `extra_satellite_filters`, default
 * empty): arbitrary additional name-prefix strings, matched the same
 * case-insensitive `^PREFIX` way as the curated list above, each getting its
 * own 'country' bucket (the literal prefix) so it can be toggled
 * independently client-side too -- e.g. ["IRIDIUM","ONEWEB"] tracks those
 * constellations without editing this script. Same recurring-cost caveat as
 * Starlink applies per constellation size: a few hundred satellites is
 * fine, another multi-thousand-satellite constellation isn't free.
 *
 * Run: node scripts/seed-satellites.mjs
 */

import { extendExistingTtl } from './_seed-utils.mjs';

const REDIS_KEY = 'intelligence:satellites:tle:v1';
const REDIS_TTL = 21_600; // 6h — matches ais-relay.cjs SAT_SEED_TTL
const UA = 'Mozilla/5.0 (compatible; WorldMonitor/1.0)';
const GROUPS = ['military', 'resource', 'active'];

const ENABLE_STARLINK = process.env.ENABLE_STARLINK_SATELLITES === 'true';

// Escapes regex metacharacters so add-on-configured extra filters are always
// matched as literal name prefixes, never interpreted as regex syntax.
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let extraFiltersRaw;
try {
  extraFiltersRaw = JSON.parse(process.env.EXTRA_SATELLITE_FILTERS_JSON || '[]');
} catch {
  extraFiltersRaw = [];
}
// Normalized (trimmed, uppercased) prefixes — reused by classify() below to
// bucket each extra filter under its own 'country' rather than lumping them
// all into 'OTHER'.
const EXTRA_FILTERS = Array.isArray(extraFiltersRaw)
  ? extraFiltersRaw.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim().toUpperCase())
  : [];

const NAME_FILTERS = [
  /^YAOGAN/i, /^GAOFEN/i, /^JILIN/i,
  /^COSMOS 2[4-9]\d{2}/i,
  /^COSMO-SKYMED/i, /^TERRASAR/i, /^PAZ$/i, /^SAR-LUPE/i,
  /^WORLDVIEW/i, /^SKYSAT/i, /^PLEIADES/i, /^KOMPSAT/i,
  /^SAPPHIRE/i, /^PRAETORIAN/i,
  /^SENTINEL/i,
  /^CARTOSAT/i,
  /^GOKTURK/i, /^RASAT/i,
  /^USA[ -]?\d/i,
  /^ZIYUAN/i,
];
if (ENABLE_STARLINK) NAME_FILTERS.push(/^STARLINK/i);
for (const prefix of EXTRA_FILTERS) NAME_FILTERS.push(new RegExp('^' + escapeRegExp(prefix), 'i'));

function classify(name) {
  const n = name.toUpperCase();
  let type = 'military';
  if (/COSMO-SKYMED|TERRASAR|PAZ|SAR-LUPE|YAOGAN/i.test(n)) type = 'sar';
  else if (/WORLDVIEW|SKYSAT|PLEIADES|KOMPSAT|GAOFEN|JILIN|CARTOSAT|ZIYUAN/i.test(n)) type = 'optical';
  else if (/SAPPHIRE|PRAETORIAN|USA|GOKTURK/i.test(n)) type = 'military';
  else if (/^STARLINK/i.test(n)) type = 'comms';

  let country = 'OTHER';
  if (/^YAOGAN|^GAOFEN|^JILIN|^ZIYUAN/i.test(n)) country = 'CN';
  else if (/^COSMOS/i.test(n)) country = 'RU';
  else if (/^WORLDVIEW|^SAPPHIRE|^PRAETORIAN|^USA|^SKYSAT/i.test(n)) country = 'US';
  else if (/^SENTINEL|^COSMO-SKYMED|^TERRASAR|^SAR-LUPE|^PAZ|^PLEIADES/i.test(n)) country = 'EU';
  else if (/^KOMPSAT/i.test(n)) country = 'KR';
  else if (/^CARTOSAT/i.test(n)) country = 'IN';
  else if (/^GOKTURK|^RASAT/i.test(n)) country = 'TR';
  // Its own bucket, not 'US' -- Starlink is ~7,000 satellites, and folding
  // it into 'US' would make that one checkbox toggle actual US ISR birds
  // and the entire Starlink constellation together, defeating the point of
  // per-country filtering.
  else if (/^STARLINK/i.test(n)) country = 'STARLINK';
  else {
    // Add-on-configured extra filters: bucket each under its own literal
    // prefix (same reasoning as STARLINK above) rather than 'OTHER', so
    // every custom-tracked constellation gets an independent toggle too.
    const extra = EXTRA_FILTERS.find(prefix => n.startsWith(prefix));
    if (extra) { type = 'custom'; country = extra; }
  }

  return { type, country };
}

async function fetchGroup(group) {
  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': UA },
    // 25s, not 15s -- `active` is CelesTrak's full public catalog (~16k
    // satellites, a few MB of TLE text), noticeably bigger than the
    // `military`/`resource` groups this used to be limited to.
    signal: AbortSignal.timeout(25_000),
  });
  if (!resp.ok) throw new Error(`CelesTrak ${group}: HTTP ${resp.status}`);
  return resp.text();
}

// Reads back whatever satellite list is currently seeded, so a cycle where
// one of GROUPS gets throttled (see the fetchGroup/main comments below) can
// carry over previously-found satellites instead of silently dropping them
// for this write. Best-effort: any failure just yields an empty list, same
// as "nothing to carry over".
async function fetchExistingSatellites() {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) return [];
  try {
    const resp = await fetch(`${redisUrl}/get/${encodeURIComponent(REDIS_KEY)}`, {
      headers: { Authorization: `Bearer ${redisToken}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    if (!data.result) return [];
    const parsed = JSON.parse(data.result);
    return Array.isArray(parsed.satellites) ? parsed.satellites : [];
  } catch {
    return [];
  }
}

async function seedRedis(payload) {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) {
    console.error('[satellites] No UPSTASH_REDIS_REST_URL/TOKEN — skipping Redis seed');
    return;
  }

  const resp = await fetch(redisUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SET', REDIS_KEY, JSON.stringify(payload), 'EX', REDIS_TTL]),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error(`[satellites] Redis SET failed: HTTP ${resp.status} — ${text.slice(0, 200)}`);
    return;
  }
  console.error('[satellites] Redis SET result:', await resp.json());

  const metaKey = 'seed-meta:intelligence:satellites';
  const meta = { fetchedAt: Date.now(), recordCount: payload.satellites.length };
  await fetch(redisUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SET', metaKey, JSON.stringify(meta), 'EX', 604800]),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => console.error('[satellites] seed-meta write failed'));
  console.error(`[satellites] Wrote seed-meta: ${metaKey}`);

  const getResp = await fetch(`${redisUrl}/get/${encodeURIComponent(REDIS_KEY)}`, {
    headers: { Authorization: `Bearer ${redisToken}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (getResp.ok) {
    const getData = await getResp.json();
    if (getData.result) {
      const parsed = JSON.parse(getData.result);
      console.error(`[satellites] Verified: ${parsed.satellites?.length} satellites in Redis`);
    }
  }
}

async function main() {
  const byNorad = new Map();
  // CelesTrak enforces a per-IP, per-group ~2h throttle: repeat requests for
  // the same GROUP before its own next data refresh get back a plain-text
  // "has not updated" message with HTTP 403, not TLE data (confirmed
  // directly 2026-07-28). This seeder's default 30-minute cycle re-queries
  // far more often than that 2h cadence, so hitting this on any given group
  // is the normal case, not a rare failure -- fetchGroup already throws on
  // it and the loop below already tolerates a per-group failure, but a
  // throttled cycle still means fewer raw TLEs to filter from *this* run.
  const throttledGroups = [];

  for (const group of GROUPS) {
    let text;
    try {
      text = await fetchGroup(group);
    } catch (e) {
      throttledGroups.push(group);
      console.error(`[satellites] Skipping group ${group}:`, e?.message || e);
      continue;
    }

    const lines = text.split('\n').map(l => l.trimEnd());
    for (let i = 0; i < lines.length - 2; i++) {
      const l1 = lines[i + 1];
      const l2 = lines[i + 2];
      if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) continue;
      if (l1.length !== 69 || l2.length !== 69) continue;
      const name = lines[i].trim();
      const noradId = l1.substring(2, 7).trim();
      if (!byNorad.has(noradId)) {
        byNorad.set(noradId, { noradId, name, line1: l1, line2: l2 });
      }
      i += 2;
    }
  }

  const fresh = [];
  for (const sat of byNorad.values()) {
    if (!NAME_FILTERS.some(rx => rx.test(sat.name))) continue;
    const { type, country } = classify(sat.name);
    fresh.push({ ...sat, type, country });
  }

  // Merge with the last-known-good seeded set rather than fully replacing
  // it -- otherwise a cycle where the `active` group specifically gets
  // throttled would silently drop every satellite only `active` can reach
  // (Russian ones especially, see the GROUPS comment above) even though an
  // earlier successful cycle already found them. Only bothers reading the
  // previous set back when something was actually throttled this cycle;
  // TLEs stay reasonably accurate for days, so carrying one over for a
  // cycle or two costs negligible position accuracy.
  const merged = new Map(fresh.map(s => [s.noradId, s]));
  if (throttledGroups.length > 0) {
    for (const sat of await fetchExistingSatellites()) {
      if (!merged.has(sat.noradId)) merged.set(sat.noradId, sat);
    }
  }
  const satellites = [...merged.values()];

  if (satellites.length === 0) {
    throw new Error('No matching TLEs found across all groups');
  }

  const payload = { satellites, fetchedAt: Date.now() };
  console.error(`[satellites] ${fresh.length} fresh + ${satellites.length - fresh.length} carried over from cache = ${satellites.length} total (${byNorad.size} raw TLEs this cycle)`);
  await seedRedis(payload);
}

main().catch(async err => {
  // Preserve-last-good: extend TTL rather than blow away the last good set on
  // a transient CelesTrak failure, matching the seeder convention.
  console.error(`[satellites] Fetch failed: ${err.message} — extending TTL on stale data`);
  await extendExistingTtl([REDIS_KEY, 'seed-meta:intelligence:satellites'], REDIS_TTL)
    .catch(e => console.error(`[satellites] TTL extend failed: ${e.message}`));
  process.exit(0);
});
