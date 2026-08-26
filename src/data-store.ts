/**
 * Global state management and aggregation cache.
 * Acts as the single source of truth for all modules.
 */
import { RegionData, ViewState, NavItem, RawRow, RegionValueMap, SortState } from './types.js';
import { COUNTRY_ADCODE, NATION_NAME } from './constants.js';
import { normalizeRegionName } from './utils.js';

export interface AppState {
  rawData: RegionData[];
  rawRows: RawRow[];
  currentView: ViewState;
  navStack: NavItem[];
  geoCache: Map<string, unknown>;
  regionValueMap: RegionValueMap;
  selectedRegion: string | null;
  sort: SortState;
  search: string;
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
  geoCache: new Map(),
  regionValueMap: new Map(),
  selectedRegion: null,
  sort: { key: null, dir: 'asc' },
  search: '',
  aggregatedData: null,
  aggValid: false,
  tableData: []
};

/** Rebuild the aggregation cache: group by region, average duplicate regions. */
export function rebuildAggregatedCache(): void {
  const aggMap = new Map<string, number[]>();
  state.rawData.forEach((d) => {
    if (d.value == null) return;
    if (!aggMap.has(d.region)) aggMap.set(d.region, []);
    aggMap.get(d.region)!.push(d.value);
  });
  state.aggregatedData = Array.from(aggMap.entries()).map(([region, values]) => {
    const validValues = values.filter((v) => v != null) as number[];
    const avg = validValues.length
      ? validValues.reduce((s, v) => s + v, 0) / validValues.length
      : null;
    return { region, value: avg };
  });
  state.aggValid = true;
}

/** Get aggregated data (cache-first). */
export function getAggregatedData(): RegionData[] {
  if (!state.aggValid) rebuildAggregatedCache();
  return state.aggregatedData ?? [];
}

/** Invalidate the aggregation cache after rawData changes. */
export function invalidateAggregation(): void {
  state.aggValid = false;
}

/** Build the region->value map from rawData (used by map renderer). */
export function buildRegionValueMap(): void {
  const map: RegionValueMap = new Map();
  state.rawData.forEach((d) => {
    const norm = normalizeRegionName(d.region);
    map.set(norm, d.value);
    map.set(d.region, d.value);
  });
  state.regionValueMap = map;
}

/** Get the value for a region name (with normalized fallback). */
export function getRegionValue(regionName: string): number | null {
  if (state.regionValueMap.has(regionName)) {
    return state.regionValueMap.get(regionName) ?? null;
  }
  const norm = normalizeRegionName(regionName);
  return state.regionValueMap.has(norm) ? state.regionValueMap.get(norm) ?? null : null;
}

/** Get the set of region names visible in the current view (for table filtering). */
export function getCurrentViewRegionSet(): Set<string> {
  const set = new Set<string>();
  const geoJson = state.geoCache.get(state.currentView.adcode) as { features?: { properties: { name: string } }[] } | undefined;
  if (geoJson && geoJson.features) {
    geoJson.features.forEach((f) => {
      const n = f.properties.name;
      set.add(n);
      set.add(normalizeRegionName(n));
    });
  }
  return set;
}
