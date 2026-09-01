/**
 * Drill-down navigation: map clicks, breadcrumb, back navigation, and the
 * cross-level search jump (drillToPath).
 *
 * Every successful map change (drill down, go back, breadcrumb jump, search
 * jump) updates state.currentView AND state.currentPath BEFORE calling
 * loadMap — loadMap's onMapLoaded callback renders immediately and reads
 * currentPath to resolve values, so updating state after the call would
 * render one frame with the previous level's path (all-gray map bug).
 */
import { getEls } from './ui.js';
import { state, invalidateViewLevelCache } from './data-store.js';
import { normalizeRegionName, escapeHtml } from './utils.js';
import { MAX_LEVEL, COUNTRY_ADCODE, NATION_NAME } from './constants.js';
import { loadMap, setLoading } from './map-loader.js';
import { renderTable } from './table.js';

const els = () => getEls();

function setStatus(text: string, type: 'info' | 'loading' | 'error' | 'ok' = 'info'): void {
  els().statusText.textContent = text;
  els().statusDot.className = 'status-dot';
  if (type === 'loading') els().statusDot.classList.add('loading');
  if (type === 'error') els().statusDot.classList.add('error');
}

/** Minimal GeoJSON feature shape used for lookups. */
interface GeoFeatureLite {
  properties: {
    name: string;
    adcode?: number | string;
    adcode_new?: number | string;
  };
}

function asGeo(geoJson: unknown): { features?: GeoFeatureLite[] } {
  return (geoJson ?? {}) as { features?: GeoFeatureLite[] };
}

/** Find a feature by name, tolerating suffix differences ("广州" vs "广州市"). */
function findFeatureByName(geoJson: unknown, name: string): GeoFeatureLite | undefined {
  const g = asGeo(geoJson);
  if (!g.features) return undefined;
  const norm = normalizeRegionName(name);
  return g.features.find(
    (f) => f.properties.name === name || normalizeRegionName(f.properties.name) === norm
  );
}

function featureAdcode(f: GeoFeatureLite): string {
  return String(f.properties.adcode ?? f.properties.adcode_new ?? '');
}

/** Handle a map region click: drill down to the next level, or highlight at max level. */
export function handleMapClick(params: { name?: string }): void {
  const name = params && params.name;
  if (!name) return;
  if (state.currentView.level >= MAX_LEVEL) {
    highlightRegion(name);
    return;
  }
  drillDown(name);
}

/** Generic drill-down by region name from the current level. */
export async function drillDown(regionName: string): Promise<void> {
  const geoJson = state.geoCache.get(state.currentView.adcode);
  if (!geoJson) return;

  const feature = findFeatureByName(geoJson, regionName);
  if (!feature) {
    setStatus(`未找到 ${regionName} 的地图数据`, 'error');
    return;
  }

  const adcode = featureAdcode(feature);
  if (!adcode || adcode === 'undefined') {
    highlightRegion(regionName);
    return;
  }
  setStatus(`下钻至 ${regionName}...`, 'loading');

  const nextLevel = state.currentView.level + 1;
  // IMPORTANT: update currentView AND currentPath BEFORE loadMap (see file comment).
  state.currentView = { level: nextLevel, adcode, name: regionName };
  if (nextLevel === 1) {
    state.currentPath = { province: regionName, city: null, district: null };
  } else if (nextLevel === 2) {
    state.currentPath = { province: state.currentPath.province, city: regionName, district: null };
  } else if (nextLevel === 3) {
    state.currentPath = { province: state.currentPath.province, city: state.currentPath.city, district: regionName };
  }
  invalidateViewLevelCache();
  state.navStack.push(state.currentView);

  const ok = await loadMap(adcode, regionName, nextLevel);
  if (!ok) {
    state.navStack.pop();
    const prev = state.navStack[state.navStack.length - 1];
    state.currentView = prev;
    state.currentPath = pathForLevel(prev.level, prev.name);
    invalidateViewLevelCache();
    highlightRegion(regionName);
    return;
  }
}

/**
 * Cross-level jump to a region identified by its full hierarchy path.
 * Used by the search suggestion list — works from ANY current level,
 * including jumping "up" (e.g. from inside Guangdong straight to Shanghai).
 *
 * Steps:
 *   1. Reset the navigation stack to the country; ensure country GeoJSON.
 *   2. Find the province feature -> update state -> load province (level 1).
 *   3. If the target has a city, find the city feature -> load city (level 2).
 *   4. If the target has a district, highlight it on the city map.
 *
 * Returns false when a hop fails (e.g. DataV 403 on hosted sites where
 * city-level GeoJSON is unavailable); the map rolls back to the last
 * successful level and the status bar explains the failure.
 */
export async function drillToPath(target: {
  province: string;
  city: string | null;
  district: string | null;
}): Promise<boolean> {
  // 直辖市目标（如 北京市/北京市/朝阳区）：市位与省名相同，视为无市级，
  // 跳过市级 hop，直接在省级地图（要素即区县）高亮区县。
  const t: {
    province: string;
    city: string | null;
    district: string | null;
  } = {
    province: target.province,
    city:
      target.city && normalizeRegionName(target.city) !== normalizeRegionName(target.province)
        ? target.city
        : null,
    district: target.district
  };
  const label = [t.province, t.city, t.district].filter(Boolean).join('/');
  setStatus(`跳转至 ${label}...`, 'loading');
  state.selectedRegion = null;

  // Step 1: reset to country and make sure its GeoJSON is cached.
  state.navStack = [{ level: 0, adcode: COUNTRY_ADCODE, name: NATION_NAME }];
  state.currentView = { level: 0, adcode: COUNTRY_ADCODE, name: NATION_NAME };
  state.currentPath = { province: null, city: null, district: null };
  invalidateViewLevelCache();
  if (!state.geoCache.has(COUNTRY_ADCODE)) {
    const ok = await loadMap(COUNTRY_ADCODE, NATION_NAME, 0);
    if (!ok) return false;
  }
  const countryGeo = state.geoCache.get(COUNTRY_ADCODE);

  // Step 2: province hop.
  const provFeature = findFeatureByName(countryGeo, target.province);
  if (!provFeature) {
    setStatus(`未找到省份: ${target.province}`, 'error');
    await loadMap(COUNTRY_ADCODE, NATION_NAME, 0);
    return false;
  }
  const provName = provFeature.properties.name;
  const provAdcode = featureAdcode(provFeature);
  if (!provAdcode) {
    setStatus(`省份 ${provName} 缺少行政区划代码，无法跳转`, 'error');
    await loadMap(COUNTRY_ADCODE, NATION_NAME, 0);
    return false;
  }

  state.currentView = { level: 1, adcode: provAdcode, name: provName };
  state.currentPath = { province: provName, city: null, district: null };
  invalidateViewLevelCache();
  state.navStack.push(state.currentView);

  const provOk = await loadMap(provAdcode, provName, 1);
  if (!provOk) {
    await rollbackOne();
    return false;
  }

  // Step 3: city hop (optional — t.city present).
  if (t.city) {
    const provGeo = state.geoCache.get(provAdcode);
    const cityFeature = findFeatureByName(provGeo, t.city);
    if (!cityFeature) {
      setStatus(`已跳转至 ${provName}，但未找到城市: ${t.city}`, 'error');
      return false; // Stay at province level — still a useful partial result.
    }
    const cityName = cityFeature.properties.name;
    const cityAdcode = featureAdcode(cityFeature);
    if (!cityAdcode) {
      setStatus(`城市 ${cityName} 缺少行政区划代码，无法继续下钻`, 'error');
      return false;
    }

    state.currentView = { level: 2, adcode: cityAdcode, name: cityName };
    state.currentPath = { province: provName, city: cityName, district: null };
    invalidateViewLevelCache();
    state.navStack.push(state.currentView);

    const cityOk = await loadMap(cityAdcode, cityName, 2);
    if (!cityOk) {
      await rollbackOne();
      return false;
    }

    // Step 4: district highlight (optional — t.district present).
    if (t.district) {
      state.selectedRegion = t.district;
      window.echarts.getInstanceByDom(els().chart)?.dispatchAction({
        type: 'highlight',
        seriesIndex: 0,
        name: t.district
      });
      renderTable();
      setStatus(`已跳转至 ${provName}/${cityName}，已高亮 ${t.district}`, 'ok');
      return true;
    }
    setStatus(`已跳转至 ${provName}/${cityName}`, 'ok');
    return true;
  }

  // 直辖市等无市级目标：直接在省级地图高亮区县（省级地图要素即区县）。
  if (t.district) {
    state.selectedRegion = t.district;
    window.echarts.getInstanceByDom(els().chart)?.dispatchAction({
      type: 'highlight',
      seriesIndex: 0,
      name: t.district
    });
    renderTable();
    setStatus(`已跳转至 ${provName}，已高亮 ${t.district}`, 'ok');
    return true;
  }

  setStatus(`已跳转至 ${provName}`, 'ok');
  return true;
}

/** Pop the navigation stack once and re-render the new top level. */
async function rollbackOne(): Promise<void> {
  if (state.navStack.length > 1) state.navStack.pop();
  const target = state.navStack[state.navStack.length - 1];
  state.currentView = target;
  state.currentPath = pathForLevel(target.level, target.name);
  invalidateViewLevelCache();
  await loadMap(target.adcode, target.name, target.level);
}

/** Highlight a region on the map and sync the table selection. */
function highlightRegion(name: string): void {
  state.selectedRegion = name;
  window.echarts.getInstanceByDom(els().chart)?.dispatchAction({
    type: 'highlight',
    seriesIndex: 0,
    name
  });
  renderTable();
}

/** Go back one navigation level (or reset to country if at the root). */
export function goBack(): void {
  if (state.navStack.length <= 1) {
    state.navStack = [{ level: 0, adcode: COUNTRY_ADCODE, name: NATION_NAME }];
    state.currentView = { level: 0, adcode: COUNTRY_ADCODE, name: NATION_NAME };
    state.currentPath = { province: null, city: null, district: null };
    invalidateViewLevelCache();
    loadMap(COUNTRY_ADCODE, NATION_NAME, 0);
    return;
  }
  state.navStack.pop();
  const target = state.navStack[state.navStack.length - 1];
  state.selectedRegion = null;
  state.currentView = target;
  state.currentPath = pathForLevel(target.level, target.name);
  invalidateViewLevelCache();
  loadMap(target.adcode, target.name, target.level);
}

/** Compute the currentPath that matches a target navigation level. */
function pathForLevel(level: number, name: string): { province: string | null; city: string | null; district: string | null } {
  if (level <= 0) return { province: null, city: null, district: null };
  if (level === 1) return { province: name, city: null, district: null };
  if (level === 2) {
    return { province: state.currentPath.province, city: name, district: null };
  }
  return {
    province: state.currentPath.province,
    city: state.currentPath.city,
    district: name
  };
}

/** Rebuild the breadcrumb from the navigation stack. */
export function updateBreadcrumb(): void {
  const items: string[] = [];
  state.navStack.forEach((v, idx) => {
    if (idx > 0) items.push('<span class="crumb crumb-sep">/</span>');
    const isCurrent = idx === state.navStack.length - 1;
    const name = escapeHtml(v.name);
    items.push(
      isCurrent
        ? `<span class="crumb crumb-current">${name}</span>`
        : `<span class="crumb crumb-link" data-level="${idx}">${name}</span>`
    );
  });
  els().breadcrumb.innerHTML = items.join('');

  els().breadcrumb.querySelectorAll('.crumb-link').forEach((el) => {
    el.addEventListener('click', () => {
      const targetIdx = parseInt((el as HTMLElement).dataset.level ?? '0', 10);
      if (targetIdx >= state.navStack.length - 1) return;
      const target = state.navStack[targetIdx];
      state.navStack = state.navStack.slice(0, targetIdx + 1);
      state.selectedRegion = null;
      state.currentView = target;
      state.currentPath = pathForLevel(target.level, target.name);
      invalidateViewLevelCache();
      loadMap(target.adcode, target.name, target.level);
    });
  });
}
