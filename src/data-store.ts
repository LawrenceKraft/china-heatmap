/**
 * Global state management and aggregation cache.
 * Acts as the single source of truth for all modules.
 *
 * Aggregation model
 * -----------------
 * A single CSV row can sit at any level of the hierarchy:
 *   - province only                (city & district empty)  -> direct province value
 *   - province + city              (district empty)         -> direct city value
 *   - province + city + district                              -> direct district value
 *
 * Final value rules for each region:
 *   - district:   the direct value (no children to roll up)
 *   - city:       direct city value, else sum of direct district values in that city
 *   - province:   direct province value, else sum of all city/district values in that province
 *
 * The "father has data, use father's data" rule prevents double counting when
 * a user supplies both a parent value and its child values.
 */
import { RegionData, ViewState, NavItem, RawRow, ViewPath, HierarchicalRegion } from './types.js';
import { COUNTRY_ADCODE, NATION_NAME, isMunicipality } from './constants.js';
import { normalizeRegionName } from './utils.js';

export interface AppState {
  /** 4-column parsed rows: province / city / district / value. */
  rawData: HierarchicalRegion[];
  rawRows: RawRow[];
  currentView: ViewState;
  navStack: NavItem[];
  /** Full hierarchy path of the current view (drives value lookup). */
  currentPath: ViewPath;
  geoCache: Map<string, unknown>;
  /** Final province values (key = province name, possibly normalized). */
  provinceValueMap: Map<string, number | null>;
  /** Final city values (key = "province|city", possibly normalized). */
  cityValueMap: Map<string, number | null>;
  /** Final district values (key = "province|city|district", possibly normalized). */
  districtValueMap: Map<string, number | null>;
  selectedRegion: string | null;
  sort: { key: 'region' | 'value' | null; dir: 'asc' | 'desc' };
  /** Cached view-level filtered data. Recomputed whenever currentPath changes. */
  viewLevelData: RegionData[] | null;
  /** Cached flat table data (one row per region with a final value). */
  aggregatedData: RegionData[] | null;
  aggValid: boolean;
  tableData: RegionData[];
}

export const state: AppState = {
  rawData: [],
  rawRows: [],
  currentView: {
    level: 0,
    adcode: COUNTRY_ADCODE,
    name: NATION_NAME
  },
  navStack: [{ level: 0, adcode: COUNTRY_ADCODE, name: NATION_NAME }],
  currentPath: { province: null, city: null, district: null },
  geoCache: new Map(),
  provinceValueMap: new Map(),
  cityValueMap: new Map(),
  districtValueMap: new Map(),
  selectedRegion: null,
  sort: { key: null, dir: 'asc' },
  viewLevelData: null,
  aggregatedData: null,
  aggValid: false,
  tableData: []
};

/** Build the canonical "省|市|区" key for a row at any level. */
function keyOf(p: string, c: string | null, d: string | null, level: 'p' | 'c' | 'd'): string {
  if (level === 'p') return p;
  if (level === 'c') return `${p}|${c ?? ''}`;
  return `${p}|${c ?? ''}|${d ?? ''}`;
}

/** Add a value to a running sum, ignoring nulls. */
function addTo(map: Map<string, number>, key: string, value: number | null): void {
  if (value == null) return;
  map.set(key, (map.get(key) ?? 0) + value);
}

/** Insert into a Map only if the key is not already present (parent wins). */
function setIfAbsent(map: Map<string, number | null>, key: string, value: number | null): void {
  if (value == null) return;
  if (!map.has(key)) map.set(key, value);
}

/**
 * Rebuild all three level value maps from rawData.
 * See file-level comment for the "parent wins" aggregation rules.
 */
export function rebuildAggregatedCache(): void {
  const directProvince = new Map<string, number>();
  const directCity = new Map<string, number>();
  const directDistrict = new Map<string, number>();

  // 1) Bucket direct values by level.
  for (const row of state.rawData) {
    if (row.value == null || !row.province) continue;
    if (!row.city && !row.district) {
      directProvince.set(row.province, row.value);
    } else if (row.city && !row.district) {
      directCity.set(keyOf(row.province, row.city, null, 'c'), row.value);
    } else if (row.city && row.district) {
      directDistrict.set(keyOf(row.province, row.city, row.district, 'd'), row.value);
    }
  }

  // 2) Roll up: district -> city -> province.
  const districtSumByCity = new Map<string, number>();
  for (const [dKey, value] of directDistrict) {
    // dKey = "省|市|区", split off the last segment to get "省|市"
    const lastPipe = dKey.lastIndexOf('|');
    const cityKey = dKey.substring(0, lastPipe);
    addTo(districtSumByCity, cityKey, value);
  }

  const sumByProvince = new Map<string, number>();
  for (const [cKey, value] of directCity) {
    // cKey = "省|市", split off the last segment to get "省"
    const lastPipe = cKey.lastIndexOf('|');
    const pKey = cKey.substring(0, lastPipe);
    addTo(sumByProvince, pKey, value);
  }
  // District sums also flow up to the province level.
  for (const [cKey, value] of districtSumByCity) {
    const lastPipe = cKey.lastIndexOf('|');
    const pKey = cKey.substring(0, lastPipe);
    addTo(sumByProvince, pKey, value);
  }

  // 3) Compose final maps: direct value wins, otherwise the rolled-up sum.
  const finalProvince = new Map<string, number | null>();
  for (const [k, v] of directProvince) setIfAbsent(finalProvince, k, v);
  for (const [k, v] of sumByProvince) setIfAbsent(finalProvince, k, v);

  const finalCity = new Map<string, number | null>();
  for (const [k, v] of directCity) setIfAbsent(finalCity, k, v);
  for (const [k, v] of districtSumByCity) setIfAbsent(finalCity, k, v);

  const finalDistrict = new Map<string, number | null>();
  for (const [k, v] of directDistrict) finalDistrict.set(k, v);

  state.provinceValueMap = finalProvince;
  state.cityValueMap = finalCity;
  state.districtValueMap = finalDistrict;

  state.aggregatedData = buildFlatTableData();
  state.viewLevelData = null; // force re-filter on next read
  state.aggValid = true;
}

/** Get aggregated data (cache-first). */
export function getAggregatedData(): RegionData[] {
  if (!state.aggValid) rebuildAggregatedCache();
  return state.aggregatedData ?? [];
}

/**
 * Filter aggregated data down to rows belonging to the current map view level.
 *
 *   Level 0 (country):     only province rows
 *   Level 1 (province):    only city rows in the current province
 *   Level 2 (city):        only district rows in the current (province, city)
 *   Level 3 (district):    the single current district row (rare; usually empty)
 *
 * Name matching is tolerant of suffix differences (e.g. "朝阳区" vs "北京市/北京市/朝阳区")
 * by also comparing the normalized form (suffix-stripped).
 */
export function getRowsForCurrentView(): RegionData[] {
  if (state.viewLevelData) return state.viewLevelData;
  const all = getAggregatedData();
  const { province, city, district } = state.currentPath;

  let filtered: RegionData[];
  if (province == null) {
    filtered = all.filter((r) => !r.city && !r.district);
  } else if (city == null && isMunicipality(province)) {
    // 直辖市省级视图：地图要素即区县，表格直接列出区县行。
    filtered = all.filter((r) => r.district && provinceMatches(r.province, province));
  } else if (city == null) {
    filtered = all.filter(
      (r) => r.city && !r.district && provinceMatches(r.province, province)
    );
  } else if (district == null) {
    filtered = all.filter(
      (r) =>
        r.district &&
        provinceMatches(r.province, province) &&
        cityMatches(r.city, city)
    );
  } else {
    filtered = all.filter(
      (r) =>
        r.district &&
        provinceMatches(r.province, province) &&
        cityMatches(r.city, city) &&
        districtMatches(r.district, district)
    );
  }
  state.viewLevelData = filtered;
  return filtered;
}

/** Clear the view-level cache (call this whenever currentPath changes). */
export function invalidateViewLevelCache(): void {
  state.viewLevelData = null;
}

/** Tolerant name match: raw equal OR normalized equal (suffix-stripped). */
function provinceMatches(a: string, b: string): boolean {
  if (a === b) return true;
  return normalizeRegionName(a) === normalizeRegionName(b);
}
function cityMatches(a: string | null, b: string): boolean {
  if (a == null) return false;
  if (a === b) return true;
  return normalizeRegionName(a) === normalizeRegionName(b);
}
function districtMatches(a: string | null, b: string): boolean {
  if (a == null) return false;
  if (a === b) return true;
  return normalizeRegionName(a) === normalizeRegionName(b);
}

/** Invalidate the aggregation cache after rawData changes. */
export function invalidateAggregation(): void {
  state.aggValid = false;
  state.viewLevelData = null;
}

/** Reset all data state (called when the file is removed or replaced). */
export function clearAllData(): void {
  state.rawData = [];
  state.rawRows = [];
  state.provinceValueMap = new Map();
  state.cityValueMap = new Map();
  state.districtValueMap = new Map();
  state.aggregatedData = null;
  state.viewLevelData = null;
  state.aggValid = false;
  state.selectedRegion = null;
  state.sort = { key: null, dir: 'asc' };
}

/** 展示路径：直辖市行（市位与省名相同）省略重复的市段，输出 北京市/朝阳区。 */
function displayPath(province: string, city: string | null, district: string | null): string {
  const parts = [province];
  if (city && city !== province) parts.push(city);
  if (district) parts.push(district);
  return parts.join('/');
}

/**
 * Build a flat list of {region, value} for the table. One row per unique
 * (province, city, district) tuple that has a final value.
 */
function buildFlatTableData(): RegionData[] {
  const rows: RegionData[] = [];
  const seen = new Set<string>();

  for (const [k, value] of state.districtValueMap) {
    const parts = k.split('|');
    const province = parts[0];
    const city = parts[1];
    const district = parts[2];
    const tag = `d|${k}`;
    if (seen.has(tag)) continue;
    seen.add(tag);
    rows.push({
      region: displayPath(province, city, district),
      value,
      province,
      city,
      district
    });
  }
  for (const [k, value] of state.cityValueMap) {
    const lastPipe = k.lastIndexOf('|');
    const province = k.substring(0, lastPipe);
    const city = k.substring(lastPipe + 1);
    const tag = `c|${k}`;
    if (seen.has(tag)) continue;
    seen.add(tag);
    rows.push({
      region: displayPath(province, city, null),
      value,
      province,
      city,
      district: null
    });
  }
  for (const [province, value] of state.provinceValueMap) {
    const tag = `p|${province}`;
    if (seen.has(tag)) continue;
    seen.add(tag);
    rows.push({
      region: province,
      value,
      province,
      city: null,
      district: null
    });
  }
  return rows;
}

/**
 * Get the value for a region name in the context of the current view.
 *
 * The map-renderer calls this for each feature in the current GeoJSON. The
 * decision of which aggregated map to query is driven by currentView.level and
 * currentPath. Both the raw key and the "省|市" / "省|市|区" composite key are
 * tried (with normalized fallback) so that minor suffix differences still
 * match (e.g. "朝阳区" vs "北京市/北京市/朝阳区").
 */
export function getRegionValueForCurrentView(regionName: string): number | null {
  const { province, city, district } = state.currentPath;

  if (province == null) {
    return lookup(state.provinceValueMap, regionName);
  }
  if (city == null) {
    // 直辖市省级视图：地图要素即区县（geo_110000 直接是各区），
    // 数据存于区级表，键为 "省|省|区名"（如 北京市|北京市|朝阳区）。
    if (isMunicipality(province)) {
      return lookupCompositeTriple(state.districtValueMap, province, province, regionName);
    }
    return lookupComposite(state.cityValueMap, province, regionName);
  }
  if (district == null) {
    return lookupCompositeTriple(state.districtValueMap, province, city, regionName);
  }
  return null;
}

/** Look up a single-key value map (try raw, then normalized). */
function lookup(map: Map<string, number | null>, key: string): number | null {
  if (map.has(key)) return map.get(key) ?? null;
  const norm = normalizeRegionName(key);
  return map.has(norm) ? map.get(norm) ?? null : null;
}

/** Composite key lookup for "省|市" with a couple of fallback shapes. */
function lookupComposite(
  map: Map<string, number | null>,
  province: string,
  cityName: string
): number | null {
  const normCity = normalizeRegionName(cityName);
  const exact = `${province}|${cityName}`;
  if (map.has(exact)) return map.get(exact) ?? null;
  const normKey = `${province}|${normCity}`;
  if (map.has(normKey)) return map.get(normKey) ?? null;
  const np = normalizeRegionName(province);
  if (np !== province) {
    const v1 = map.get(`${np}|${cityName}`);
    if (v1 != null) return v1;
    const v2 = map.get(`${np}|${normCity}`);
    if (v2 != null) return v2;
  }
  return null;
}

/** Composite "省|市|区" lookup. */
function lookupCompositeTriple(
  map: Map<string, number | null>,
  province: string,
  city: string,
  districtName: string
): number | null {
  const norm = normalizeRegionName(districtName);
  const exact = `${province}|${city}|${districtName}`;
  if (map.has(exact)) return map.get(exact) ?? null;
  const normKey = `${province}|${city}|${norm}`;
  if (map.has(normKey)) return map.get(normKey) ?? null;
  const np = normalizeRegionName(province);
  const nc = normalizeRegionName(city);
  if (np !== province || nc !== city) {
    const v1 = map.get(`${np}|${nc}|${districtName}`);
    if (v1 != null) return v1;
    const v2 = map.get(`${np}|${nc}|${norm}`);
    if (v2 != null) return v2;
  }
  return null;
}
