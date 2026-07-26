#!/usr/bin/env node
// Standalone replacement for the paywalled /api/imagery/v1/search-imagery
// RPC (proxied by nginx to this service on its own port, bypassing the
// compiled, entitlement-gated handler entirely). Backs the 3D globe's
// "satellite imagery scene" markers/footprints with real, free data:
// Element84's public Earth Search STAC API over Sentinel-2 L2A, the same
// source the client's own hardcoded preview-URL allowlist
// (sentinel-cogs.s3.us-west-2.amazonaws.com, in src/utils/imagery-preview.ts)
// already anticipated -- this wasn't a guess, the client was already built
// to expect exactly this.
//
// Also backs "Imagery Watch": subscribe to an area, get notified when new
// imagery lands for it, and browse the history. Live search (above) stays a
// pure passthrough with no state; Imagery Watch adds a background poll loop
// and Redis-backed subscriptions/history/notification-events on top of the
// exact same search logic, extended to also query NAIP (Microsoft's
// Planetary Computer STAC) for the continental US, where it's available at
// 0.6-1m/px vs Sentinel-2's 10m/px -- verified keyless for both search and
// asset access before relying on it (see FORK.md-adjacent CHANGELOG entry).
//
// Request/response shape for the original search-imagery route matches
// generated/server/worldmonitor/imagery/v1/service_server.ts exactly, so no
// client changes were needed for that route. The new /api/imagery-watch/v1/*
// routes are our own addition, consumed by the new ImageryWatchPanel.

import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.IMAGERY_RELAY_PORT || 3006);
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min -- be a good citizen of shared public APIs
const MAX_LIMIT = 20; // matches the client's own request limit
const IMAGERY_WATCH_INTERVAL_MS = Math.max(5, Number(process.env.IMAGERY_WATCH_INTERVAL_MINUTES) || 60) * 60 * 1000;
const EVENTS_MAX = 200; // capped notification-event log

// Continental US bbox (rough, intentionally generous) -- NAIP has no
// coverage outside this, so skip the extra query entirely for areas that
// can't possibly match rather than round-tripping to Planetary Computer
// just to get an empty result back.
const US_BBOX = [-125, 24, -66, 50];

function bboxIntersects(a, b) {
  const [aw, as_, ae, an] = a;
  const [bw, bs, be, bn] = b;
  return aw <= be && ae >= bw && as_ <= bn && an >= bs;
}

// ---- STAC sources -----------------------------------------------------

const SOURCES = {
  's2': {
    label: 'Sentinel-2',
    searchUrl: 'https://earth-search.aws.element84.com/v1/search',
    collection: 'sentinel-2-l2a',
    resolutionM: 10,
    global: true,
    toScene(feature) {
      const assets = feature.assets || {};
      const props = feature.properties || {};
      return {
        id: `s2:${String(feature.id || '')}`,
        source: 's2',
        satellite: 'Sentinel-2',
        datetime: String(props.datetime || ''),
        resolutionM: 10,
        mode: 'visual',
        geometryGeojson: feature.geometry ? JSON.stringify(feature.geometry) : '',
        previewUrl: assets.thumbnail?.href || '',
        assetUrl: assets.visual?.href || '',
      };
    },
  },
  'naip': {
    label: 'NAIP',
    searchUrl: 'https://planetarycomputer.microsoft.com/api/stac/v1/search',
    collection: 'naip',
    resolutionM: 0.6,
    global: false, // continental US only
    toScene(feature) {
      const assets = feature.assets || {};
      const props = feature.properties || {};
      return {
        id: `naip:${String(feature.id || '')}`,
        source: 'naip',
        satellite: 'NAIP',
        datetime: String(props.datetime || ''),
        resolutionM: Number(props.gsd) || 0.6,
        mode: 'visual',
        geometryGeojson: feature.geometry ? JSON.stringify(feature.geometry) : '',
        previewUrl: assets.rendered_preview?.href || assets.thumbnail?.href || '',
        assetUrl: assets.image?.href || '',
      };
    },
  },
};

// bbox-rounded cache: pans within the same ~0.1 degree cell during the TTL
// window reuse the cached result instead of re-querying upstream.
const cache = new Map();

function cacheKeyFor(sourceKey, bbox, limit) {
  const round = (n) => Math.round(n * 10) / 10;
  return `${sourceKey}|${bbox.map(round).join(',')}|${limit}`;
}

function pruneCache() {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (now - v.timestamp > CACHE_TTL_MS) cache.delete(k);
  }
}

function parseBbox(raw) {
  if (!raw) return null;
  const parts = (Array.isArray(raw) ? raw : raw.split(',')).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [west, south, east, north] = parts;
  if (west < -180 || east > 180 || south < -90 || north > 90) return null;
  if (west > east || south > north) return null;
  return [west, south, east, north];
}

async function searchOneSource(sourceKey, bbox, limit) {
  const source = SOURCES[sourceKey];
  pruneCache();
  const key = cacheKeyFor(sourceKey, bbox, limit);
  const cached = cache.get(key);
  if (cached) return { scenes: cached.scenes, cacheHit: true };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const resp = await fetch(source.searchUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collections: [source.collection],
        bbox,
        limit,
        sortby: [{ field: 'properties.datetime', direction: 'desc' }],
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      console.warn(`[imagery-relay] ${source.label} search failed: HTTP ${resp.status}`);
      return { scenes: [], cacheHit: false };
    }
    const data = await resp.json();
    const features = Array.isArray(data.features) ? data.features : [];
    const scenes = features.map((f) => source.toScene(f));
    cache.set(key, { scenes, timestamp: Date.now() });
    return { scenes, cacheHit: false };
  } catch (err) {
    console.warn(`[imagery-relay] ${source.label} search error:`, err?.message || err);
    return { scenes: [], cacheHit: false };
  } finally {
    clearTimeout(timeout);
  }
}

// Live-viewport search (existing route): single source, picked by the
// client (defaults to Sentinel-2, matches original behavior exactly).
async function searchStac(bbox, limit, sourceKey = 's2') {
  const { scenes } = await searchOneSource(sourceKey, bbox, limit);
  return scenes;
}

// "Auto mode" for Imagery Watch: always query Sentinel-2 (reliable global
// baseline); also query NAIP when the area's bbox could plausibly be in the
// continental US. Merge and sort newest-first -- Imagery Watch cares about
// "what's new", not about picking a single winning source.
async function searchAllSources(bbox, limit) {
  const jobs = [searchOneSource('s2', bbox, limit)];
  if (bboxIntersects(bbox, US_BBOX)) jobs.push(searchOneSource('naip', bbox, limit));
  const results = await Promise.all(jobs);
  const scenes = results.flatMap((r) => r.scenes);
  scenes.sort((a, b) => (b.datetime || '').localeCompare(a.datetime || ''));
  return scenes;
}

// ---- Redis (Upstash REST) ----------------------------------------------

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

async function redisPipeline(commands, timeoutMs = 10_000) {
  if (!REDIS_URL || !REDIS_TOKEN || commands.length === 0) return null;
  try {
    const resp = await fetch(`${REDIS_URL}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (err) {
    console.warn('[imagery-relay] redis pipeline error:', err?.message || err);
    return null;
  }
}

async function redisCmd(...args) {
  const result = await redisPipeline([args]);
  return result?.[0]?.result ?? null;
}

const RK = {
  areas: 'imagery-watch:areas',
  seen: (areaId) => `imagery-watch:area:${areaId}:seen`,
  history: (areaId) => `imagery-watch:area:${areaId}:history`,
  events: 'imagery-watch:events',
  eventsCursor: 'imagery-watch:events:cursor',
};

async function listAreas() {
  const raw = await redisCmd('HGETALL', RK.areas);
  if (!Array.isArray(raw)) return [];
  const areas = [];
  for (let i = 0; i < raw.length; i += 2) {
    try {
      areas.push({ id: raw[i], ...JSON.parse(raw[i + 1]) });
    } catch {
      // corrupt entry, skip
    }
  }
  return areas;
}

async function createArea({ name, bbox, storeHighRes = false, notifyHa = false }) {
  const id = crypto.randomUUID();
  const area = { name, bbox, storeHighRes, notifyHa, createdAt: Date.now() };
  await redisCmd('HSET', RK.areas, id, JSON.stringify(area));
  return { id, ...area };
}

async function deleteArea(id) {
  await redisPipeline([
    ['HDEL', RK.areas, id],
    ['DEL', RK.seen(id)],
    ['DEL', RK.history(id)],
  ]);
}

async function getHistory(areaId, limit = 200) {
  // Sorted set, score = scene datetime as epoch ms, newest first.
  const raw = await redisCmd('ZREVRANGE', RK.history(areaId), 0, limit - 1);
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
}

async function getEvents(since = 0, limit = 100) {
  // List of JSON-encoded {cursor, areaId, areaName, sceneId, datetime, source}.
  // Cursor is a strictly-increasing integer, so "since" filtering happens
  // client-side after a bounded fetch of the most recent EVENTS_MAX entries.
  const raw = await redisCmd('LRANGE', RK.events, 0, EVENTS_MAX - 1);
  if (!Array.isArray(raw)) return [];
  const events = raw.map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
  return events.filter((e) => e.cursor > since).slice(0, limit);
}

async function recordNewScene(area, scene) {
  const datetimeMs = Date.parse(scene.datetime) || Date.now();
  const cursor = await redisCmd('INCR', RK.eventsCursor);
  await redisPipeline([
    ['SADD', RK.seen(area.id), scene.id],
    ['ZADD', RK.history(area.id), datetimeMs, JSON.stringify(scene)],
    ['LPUSH', RK.events, JSON.stringify({
      cursor, areaId: area.id, areaName: area.name,
      sceneId: scene.id, datetime: scene.datetime, source: scene.source,
    })],
    ['LTRIM', RK.events, 0, EVENTS_MAX - 1],
  ]);
}

// ---- Poll loop -----------------------------------------------------------

async function pollArea(area) {
  const bbox = parseBbox(area.bbox);
  if (!bbox) return;
  const scenes = await searchAllSources(bbox, MAX_LIMIT);
  if (scenes.length === 0) return;

  const seen = await redisCmd('SMEMBERS', RK.seen(area.id));
  const seenSet = new Set(Array.isArray(seen) ? seen : []);
  const newScenes = scenes.filter((s) => !seenSet.has(s.id));
  for (const scene of newScenes) {
    await recordNewScene(area, scene);
  }
  if (newScenes.length > 0) {
    console.log(`[imagery-relay] area "${area.name}" (${area.id}): ${newScenes.length} new scene(s)`);
  }
}

async function pollAllAreas() {
  if (!REDIS_URL || !REDIS_TOKEN) return; // no Redis configured, nothing to do
  const areas = await listAreas();
  for (const area of areas) {
    try {
      await pollArea(area);
    } catch (err) {
      console.warn(`[imagery-relay] poll failed for area ${area.id}:`, err?.message || err);
    }
  }
}

// ---- HTTP server -----------------------------------------------------

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch {
    return {};
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/health') {
    return sendJson(res, 200, { status: 'ok', cacheSize: cache.size, redisConfigured: Boolean(REDIS_URL && REDIS_TOKEN) });
  }

  // ---- Original live-viewport search (unchanged behavior) ----
  if (url.pathname === '/api/imagery/v1/search-imagery') {
    const bbox = parseBbox(url.searchParams.get('bbox'));
    if (!bbox) return sendJson(res, 400, { error: 'invalid or missing bbox (expected "west,south,east,north")' });
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || MAX_LIMIT));
    pruneCache();
    const { scenes, cacheHit } = await searchOneSource('s2', bbox, limit);
    return sendJson(res, 200, { scenes, totalResults: scenes.length, cacheHit });
  }

  // ---- Imagery Watch: areas CRUD ----
  if (url.pathname === '/api/imagery-watch/v1/areas') {
    if (req.method === 'GET') {
      const areas = await listAreas();
      return sendJson(res, 200, { areas });
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const bbox = parseBbox(body.bbox);
      const name = String(body.name || '').trim().slice(0, 100);
      if (!bbox || !name) return sendJson(res, 400, { error: 'name and bbox ([west,south,east,north]) are required' });
      const area = await createArea({
        name, bbox,
        storeHighRes: Boolean(body.storeHighRes),
        notifyHa: Boolean(body.notifyHa),
      });
      // Seed immediately so the area isn't empty until the next poll cycle.
      pollArea(area).catch((err) => console.warn('[imagery-relay] initial poll failed:', err?.message || err));
      return sendJson(res, 200, { area });
    }
    if (req.method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) return sendJson(res, 400, { error: 'id is required' });
      await deleteArea(id);
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 405, { error: 'method not allowed' });
  }

  if (url.pathname === '/api/imagery-watch/v1/history') {
    const areaId = url.searchParams.get('areaId');
    if (!areaId) return sendJson(res, 400, { error: 'areaId is required' });
    const history = await getHistory(areaId);
    return sendJson(res, 200, { history });
  }

  if (url.pathname === '/api/imagery-watch/v1/events') {
    const since = Number(url.searchParams.get('since')) || 0;
    const events = await getEvents(since);
    return sendJson(res, 200, { events });
  }

  return sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[imagery-relay] listening on 127.0.0.1:${PORT} (Sentinel-2 + NAIP via Element84/Planetary Computer STAC)`);
  if (REDIS_URL && REDIS_TOKEN) {
    console.log(`[imagery-relay] Imagery Watch poll loop starting (every ${IMAGERY_WATCH_INTERVAL_MS / 60_000}min)`);
    pollAllAreas().catch((err) => console.warn('[imagery-relay] initial poll cycle failed:', err?.message || err));
    setInterval(() => pollAllAreas().catch((err) => console.warn('[imagery-relay] poll cycle failed:', err?.message || err)), IMAGERY_WATCH_INTERVAL_MS);
  } else {
    console.log('[imagery-relay] Imagery Watch disabled -- UPSTASH_REDIS_REST_URL/TOKEN not set');
  }
});
