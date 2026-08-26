/**
 * Download ALL district-level (区县级) GeoJSON from DataV GeoAtlas as local
 * fallback files, so district drill-down works fully offline.
 *
 * Strategy:
 *  1. Read each provincial _full.json (data/geo_<province>.json) to get every
 *     prefecture/city adcode (the province file already embeds city boundaries).
 *  2. For each city, fetch <city>_full.json to extract its district adcodes.
 *  3. For each district, fetch <district>.json (district's own boundary) and
 *     save it as data/geo_<district>.json.
 *
 * Features: resume (skips existing files), bounded concurrency, per-file retry.
 *
 * Usage: node scripts/download-districts.js
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');

const DATAV_BASE = 'https://geo.datav.aliyun.com/areas_v3/bound';
const CONCURRENCY = 8; // parallel downloads
const MAX_RETRIES = 3; // retries per request
const TIMEOUT_MS = 20000;

// Use districts only (childrenNum 0 = leaf). Keep as filter, but we still
// download any district that the map can drill into.
const ONLY_LEAF = true;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url) {
  let lastErr;
  for (let i = 0; i < MAX_RETRIES; i++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(t);
      if (res.ok) return await res.text();
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      clearTimeout(t);
      lastErr = err;
    }
    await sleep(300 * (i + 1));
  }
  throw lastErr;
}

/** Extract child adcodes from a FeatureCollection. */
function childAdcodes(geo) {
  const out = [];
  for (const f of geo.features || []) {
    const p = f.properties;
    if (p && p.adcode && p.name) out.push({ adcode: p.adcode, name: p.name, childrenNum: p.childrenNum ?? 0 });
  }
  return out;
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  // ---- Step 1: gather all province files already present ----
  const fs = await import('node:fs');
  const files = fs.readdirSync(DATA_DIR).filter((f) => /^geo_\d{6}\.json$/.test(f));
  const provinceAdcodes = files.map((f) => f.slice(4, 10));

  console.log(`Province files present: ${provinceAdcodes.length}`);

  // ---- Step 2: build the full set of district adcodes ----
  const districtMap = new Map(); // adcode -> {name, cityName, provinceName}
  let cityCount = 0;
  let districtCount = 0;

  for (const pcode of provinceAdcodes) {
    let province;
    try {
      province = JSON.parse(readFileSync(join(DATA_DIR, `geo_${pcode}.json`), 'utf8'));
    } catch (err) {
      console.log(`[skip-province] ${pcode}: ${err.message}`);
      continue;
    }
    const cities = childAdcodes(province).filter((c) => c.childrenNum > 0 && c.adcode !== pcode);
    for (const city of cities) {
      cityCount++;
      // Fetch city _full.json to discover its districts.
      const cityUrl = `${DATAV_BASE}/${city.adcode}_full.json`;
      try {
        const text = await fetchWithRetry(cityUrl);
        const cityGeo = JSON.parse(text);
        const districts = childAdcodes(cityGeo).filter((d) => d.adcode !== city.adcode);
        for (const d of districts) {
          if (!districtMap.has(d.adcode)) {
            districtMap.set(d.adcode, { name: d.name, cityName: city.name, provinceName: province.features[0]?.properties?.name ?? '' });
            districtCount++;
          }
        }
      } catch (err) {
        console.log(`[fail-city] ${city.name} (${city.adcode}): ${err.message}`);
      }
    }
  }

  console.log(`Discovered ${cityCount} cities, ${districtCount} districts.`);

  // ---- Step 3: download every district (resume-safe) ----
  const entries = [...districtMap.entries()];
  let done = 0, skipped = 0, failed = 0;
  const total = entries.length;

  const queue = [...entries];
  async function worker() {
    while (queue.length) {
      const [adcode, meta] = queue.shift();
      const target = join(DATA_DIR, `geo_${adcode}.json`);
      if (existsSync(target)) {
        skipped++;
        done++;
        process.stdout.write(`\r[${done}/${total}] skip ${adcode}`);
        continue;
      }
      try {
        const text = await fetchWithRetry(`${DATAV_BASE}/${adcode}.json`);
        writeFileSync(target, text, 'utf8');
        done++;
        process.stdout.write(`\r[${done}/${total}] ok ${meta.name} (${adcode})`);
      } catch (err) {
        failed++;
        console.log(`\n[fail] ${meta.name} (${adcode}): ${err.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\n\nDistricts: total=${total} downloaded=${total - skipped - failed} skipped=${skipped} failed=${failed}`);

  // ---- Step 4: report storage usage ----
  const stats = fs.statSync.bind(fs);
  let totalBytes = 0;
  for (const f of fs.readdirSync(DATA_DIR).filter((x) => /^geo_\d{6}\.json$/.test(x))) {
    totalBytes += stats(join(DATA_DIR, f)).size;
  }
  console.log(`All geo fallback data total: ${(totalBytes / 1024 / 1024).toFixed(2)} MB (${totalBytes} bytes)`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
