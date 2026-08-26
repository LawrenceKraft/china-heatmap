/**
 * Drill-down navigation: map clicks, breadcrumb, and back navigation.
 */
import { getEls } from './ui.js';
import { state } from './data-store.js';
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

/** Handle a map region click: drill down to the next level, or highlight at max level. */
export function handleMapClick(params: { name?: string }): void {
  const name = params && params.name;
  if (!name) return; // ignore blank area clicks
  if (state.currentView.level >= MAX_LEVEL) {
    highlightRegion(name);
    return;
  }
  drillDown(name);
}

/** Generic drill-down: find the region in the current GeoJSON, load its next level. */
export async function drillDown(regionName: string): Promise<void> {
  const geoJson = state.geoCache.get(state.currentView.adcode) as {
    features?: { properties: { name: string; adcode?: number | string; adcode_new?: number | string } }[];
  } | undefined;
  if (!geoJson) return;

  const feature = geoJson.features?.find(
    (f) => f.properties.name === regionName || normalizeRegionName(f.properties.name) === normalizeRegionName(regionName)
  );
  if (!feature) {
    setStatus(`未找到 ${regionName} 的地图数据`, 'error');
    return;
  }

  const adcode = String(feature.properties.adcode ?? feature.properties.adcode_new ?? '');
  if (!adcode || adcode === 'undefined') {
    highlightRegion(regionName);
    return;
  }
  setStatus(`下钻至 ${regionName}...`, 'loading');

  const nextLevel = state.currentView.level + 1;
  state.navStack.push({ level: nextLevel, adcode, name: regionName });
  const ok = await loadMap(adcode, regionName, nextLevel);
  if (!ok) {
    state.navStack.pop();
    highlightRegion(regionName);
  }
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
    loadMap(COUNTRY_ADCODE, NATION_NAME, 0);
    return;
  }
  state.navStack.pop();
  const target = state.navStack[state.navStack.length - 1];
  state.selectedRegion = null;
  loadMap(target.adcode, target.name, target.level);
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
      loadMap(target.adcode, target.name, target.level);
    });
  });
}

/** Register a map-load callback that updates the breadcrumb after map changes. */
export function registerBreadcrumbAfterLoad(): void {
  // Breadcrumb is updated inside the loadMap callback (registered in main.ts).
  // This hook exists so drilldown and goBack don't duplicate breadcrumb logic.
}
