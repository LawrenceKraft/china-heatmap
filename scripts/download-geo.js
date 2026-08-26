/**
 * Download provincial-level GeoJSON from DataV GeoAtlas as local fallback files.
 * Reads the country map (data/geo_100000.json) to get every province adcode,
 * then downloads each province's <adcode>_full.json into data/geo_<adcode>.json.
 *
 * Usage: node scripts/download-geo.js
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');

const COUNTRY_FILE = join(DATA_DIR, 'geo_100000.json');
const DATAV_BASE = 'https://geo.datav.aliyun.com/areas_v3/bound';

// Which levels to fetch: province (level 1) -> data/geo_<province>.json
const FETCH_PROVINCES = true;

async function main() {
  if (!existsSync(COUNTRY_FILE)) {
    console.error(`Missing country map: ${COUNTRY_FILE}`);
    process.exit(1);
  }
  mkdirSync(DATA_DIR, { recursive: true });

  const country = JSON.parse(readFileSync(COUNTRY_FILE, 'utf8'));
  const provinces = country.features.filter(
    (f) => f.properties && f.properties.adcode && f.properties.name
  );

  console.log(`Found ${provinces.length} provinces in country map.`);

  let ok = 0;
  let skip = 0;
  let fail = 0;

  for (const p of provinces) {
    const { adcode, name, childrenNum } = p.properties;

    // Skip regions with no children (they cannot be drilled into).
    if (!childrenNum || childrenNum === 0) {
      console.log(`[skip] ${name} (${adcode}) has no children`);
      skip++;
      continue;
    }

    const target = join(DATA_DIR, `geo_${adcode}.json`);
    const url = `${DATAV_BASE}/${adcode}_full.json`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.log(`[fail] ${name} (${adcode}) HTTP ${res.status}`);
        fail++;
        continue;
      }
      const text = await res.text();
      writeFileSync(target, text, 'utf8');
      console.log(`[ok]   ${name} (${adcode}) -> ${(text.length / 1024).toFixed(0)}KB`);
      ok++;
    } catch (err) {
      console.log(`[fail] ${name} (${adcode}) ${err.message}`);
      fail++;
    }
  }

  console.log(`\nDone. ok=${ok} skip=${skip} fail=${fail}`);
}

main();
