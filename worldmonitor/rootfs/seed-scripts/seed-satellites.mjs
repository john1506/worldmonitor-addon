/**
 * Fetches NORAD TLEs from CelesTrak (free, no-auth) for military/ISR/SAR/optical
 * reconnaissance satellites and seeds Redis key `intelligence:satellites:tle:v1`,
 * which server/worldmonitor/intelligence/v1/list-satellites.ts reads.
 *
 * Recovered from scripts/ais-relay.cjs's seedSatelliteTLEs() (the Railway relay
 * service, which isn't part of this self-hosted add-on) and adapted to the
 * standalone scripts/seed-*.mjs convention (see fetch-gpsjam.mjs) so the
 * seed-loop picks it up on its own — no relay, no API key required.
 *
 * Source: celestrak.org/NORAD/elements/gp.php?GROUP={military,resource}&FORMAT=tle
 *
 * Run: node scripts/seed-satellites.mjs
 */

import { extendExistingTtl } from './_seed-utils.mjs';

const REDIS_KEY = 'intelligence:satellites:tle:v1';
const REDIS_TTL = 21_600; // 6h — matches ais-relay.cjs SAT_SEED_TTL
const UA = 'Mozilla/5.0 (compatible; WorldMonitor/1.0)';
const GROUPS = ['military', 'resource'];

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

function classify(name) {
  const n = name.toUpperCase();
  let type = 'military';
  if (/COSMO-SKYMED|TERRASAR|PAZ|SAR-LUPE|YAOGAN/i.test(n)) type = 'sar';
  else if (/WORLDVIEW|SKYSAT|PLEIADES|KOMPSAT|GAOFEN|JILIN|CARTOSAT|ZIYUAN/i.test(n)) type = 'optical';
  else if (/SAPPHIRE|PRAETORIAN|USA|GOKTURK/i.test(n)) type = 'military';

  let country = 'OTHER';
  if (/^YAOGAN|^GAOFEN|^JILIN|^ZIYUAN/i.test(n)) country = 'CN';
  else if (/^COSMOS/i.test(n)) country = 'RU';
  else if (/^WORLDVIEW|^SAPPHIRE|^PRAETORIAN|^USA|^SKYSAT/i.test(n)) country = 'US';
  else if (/^SENTINEL|^COSMO-SKYMED|^TERRASAR|^SAR-LUPE|^PAZ|^PLEIADES/i.test(n)) country = 'EU';
  else if (/^KOMPSAT/i.test(n)) country = 'KR';
  else if (/^CARTOSAT/i.test(n)) country = 'IN';
  else if (/^GOKTURK|^RASAT/i.test(n)) country = 'TR';

  return { type, country };
}

async function fetchGroup(group) {
  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`CelesTrak ${group}: HTTP ${resp.status}`);
  return resp.text();
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

  for (const group of GROUPS) {
    let text;
    try {
      text = await fetchGroup(group);
    } catch (e) {
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

  const satellites = [];
  for (const sat of byNorad.values()) {
    if (!NAME_FILTERS.some(rx => rx.test(sat.name))) continue;
    const { type, country } = classify(sat.name);
    satellites.push({ ...sat, type, country });
  }

  if (satellites.length === 0) {
    throw new Error('No matching TLEs found across all groups');
  }

  const payload = { satellites, fetchedAt: Date.now() };
  console.error(`[satellites] ${satellites.length} matching satellites from ${byNorad.size} total TLEs`);
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
