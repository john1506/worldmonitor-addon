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
// Request/response shape matches
// generated/server/worldmonitor/imagery/v1/service_server.ts exactly, so
// no client changes are needed at all.

import http from 'node:http';

const PORT = Number(process.env.IMAGERY_RELAY_PORT || 3006);
const STAC_SEARCH_URL = 'https://earth-search.aws.element84.com/v1/search';
const DEFAULT_COLLECTION = 'sentinel-2-l2a';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min -- be a good citizen of a shared public API
const MAX_LIMIT = 20; // matches the client's own request limit

// bbox-rounded cache: pans within the same ~0.1 degree cell during the TTL
// window reuse the cached result instead of re-querying element84.
const cache = new Map();

function cacheKeyFor(bbox, limit, source) {
  const round = (n) => Math.round(n * 10) / 10;
  return `${bbox.map(round).join(',')}|${limit}|${source}`;
}

function pruneCache() {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (now - v.timestamp > CACHE_TTL_MS) cache.delete(k);
  }
}

function parseBbox(raw) {
  if (!raw) return null;
  const parts = raw.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [west, south, east, north] = parts;
  if (west < -180 || east > 180 || south < -90 || north > 90) return null;
  if (west > east || south > north) return null;
  return [west, south, east, north];
}

function toImageryScene(feature) {
  const assets = feature.assets || {};
  const props = feature.properties || {};
  return {
    id: String(feature.id || ''),
    satellite: 'Sentinel-2',
    datetime: String(props.datetime || ''),
    resolutionM: 10,
    mode: 'visual',
    geometryGeojson: feature.geometry ? JSON.stringify(feature.geometry) : '',
    previewUrl: assets.thumbnail?.href || '',
    assetUrl: assets.visual?.href || '',
  };
}

async function searchStac(bbox, limit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const resp = await fetch(STAC_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collections: [DEFAULT_COLLECTION],
        bbox,
        limit,
        sortby: [{ field: 'properties.datetime', direction: 'desc' }],
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      console.warn(`[imagery-relay] STAC search failed: HTTP ${resp.status}`);
      return [];
    }
    const data = await resp.json();
    const features = Array.isArray(data.features) ? data.features : [];
    return features.map(toImageryScene);
  } catch (err) {
    console.warn('[imagery-relay] STAC search error:', err?.message || err);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', cacheSize: cache.size }));
    return;
  }

  if (url.pathname !== '/api/imagery/v1/search-imagery') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }

  const bbox = parseBbox(url.searchParams.get('bbox'));
  if (!bbox) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid or missing bbox (expected "west,south,east,north")' }));
    return;
  }
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || MAX_LIMIT));
  const source = url.searchParams.get('source') || DEFAULT_COLLECTION;

  pruneCache();
  const key = cacheKeyFor(bbox, limit, source);
  const cached = cache.get(key);
  let scenes;
  let cacheHit = false;
  if (cached) {
    scenes = cached.scenes;
    cacheHit = true;
  } else {
    scenes = await searchStac(bbox, limit);
    cache.set(key, { scenes, timestamp: Date.now() });
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ scenes, totalResults: scenes.length, cacheHit }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[imagery-relay] listening on 127.0.0.1:${PORT} (backing search-imagery with Element84 Earth Search / Sentinel-2 L2A)`);
});
