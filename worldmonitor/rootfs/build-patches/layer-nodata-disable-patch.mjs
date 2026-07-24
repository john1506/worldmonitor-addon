// Patches the globe map's setLayerReady() so a layer with no data also gets
// its checkbox disabled, not just a "no-data" CSS class. The class alone
// still lets you check a layer that will never show anything (self-hosted
// mode has no AIS relay, and some upstream feeds are genuinely down) -- this
// makes that state actually unselectable, using the app's own existing
// per-layer data-presence signal (setLayerReady is already called after
// every layer fetch with a real found-data boolean) instead of a hardcoded
// layer list that would go stale as seeders get fixed/broken over time.
import { readFileSync, writeFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node layer-nodata-disable-patch.mjs <path-to-GlobeMap-*.js>');
  process.exit(1);
}

const old = 'setLayerReady(e,t){var n,i;(i=(n=this.layerTogglesEl)==null?void 0:n.querySelector(`.layer-toggle[data-layer="${e}"]`))==null||i.classList.toggle("no-data",!t)}';
const patched = 'setLayerReady(e,t){var n,i,s;(i=(n=this.layerTogglesEl)==null?void 0:n.querySelector(`.layer-toggle[data-layer="${e}"]`))==null||(i.classList.toggle("no-data",!t),(s=i.querySelector("input"))&&(s.disabled=!t))}';

const content = readFileSync(path, 'utf8');
if (content.includes(patched)) {
  console.log('[layer-nodata-disable-patch] already patched, skipping');
  process.exit(0);
}
if (!content.includes(old)) {
  console.error('[layer-nodata-disable-patch] anchor not found — upstream source changed, needs re-check');
  process.exit(1);
}
writeFileSync(path, content.replace(old, patched));
console.log('[layer-nodata-disable-patch] patched');
