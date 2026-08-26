/**
 * Map data loading with DataV dual-format fallback and local geo cache fallback.
 * Uses injected callbacks to decouple from UI modules (avoids circular imports).
 */
import { state } from './data-store.js';
import { getEls } from './ui.js';
import { DATAV_BASE, FETCH_TIMEOUT, LEVEL_NAMES } from './constants.js';

// Lazy accessor for DOM elements to avoid import-order issues.
const els = () => getEls();

/** Build the registered map name for a given adcode. */
export function getMapName(adcode: string): string {
  return 'map_' + adcode;
}

/** Callbacks injected by main.ts to trigger rendering after a map loads. */
export interface LoadMapCallbacks {
  onMapLoaded: (mapName: string, geoJson: unknown, level: number, name: string) => void;
}

let callbacks: LoadMapCallbacks | null = null;

/** Register callbacks that run after a map successfully loads. */
export function setLoadMapCallbacks(cb: LoadMapCallbacks): void {
  callbacks = cb;
}

/** Show/hide the loading overlay. */
export function setLoading(isLoading: boolean): void {
  els().chartOverlay.hidden = !isLoading;
}

/** Number of retries per network source when transient network errors occur. */
const NETWORK_RETRIES = 2;

/**
 * Fetch GeoJSON for an adcode.
 * Tries province/city _full.json then district .json (with retries),
 * then local fallback data/geo_{adcode}.json.
 */
export async function fetchGeoJson(adcode: string): Promise<unknown> {
  if (state.geoCache.has(adcode)) {
    return state.geoCache.get(adcode);
  }

  // CORS 代理：当 DataV 官方源被托管域名拦截（返回 403）时，
  // 通过 api.allorigins.win 中转，绕过 Referer/Origin 限制
  const proxy = (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`;

  const urls = [
    `${DATAV_BASE}/${adcode}_full.json`,
    `${DATAV_BASE}/${adcode}.json`,
    proxy(`${DATAV_BASE}/${adcode}_full.json`),
    proxy(`${DATAV_BASE}/${adcode}.json`)
  ];

  let lastErr: unknown = null;
  let timedOut = false;

  // Try each source, with a few retries per source to ride out transient failures.
  for (const url of urls) {
    for (let attempt = 0; attempt <= NETWORK_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
      let res: Response;
      try {
        res = await fetch(url, { signal: controller.signal });
      } catch (err) {
        lastErr = err;
        clearTimeout(timeoutId);
        if (err instanceof Error && err.name === 'AbortError') timedOut = true;
        // Transient failure -> retry the same URL, then fall through to the next source.
        continue;
      }
      clearTimeout(timeoutId);
      if (res.ok) {
        const geoJson = await res.json();
        state.geoCache.set(adcode, geoJson);
        return geoJson;
      }
      lastErr = new Error(`HTTP ${res.status}`);
    }
  }

  // All network sources failed; try the local fallback cache file.
  try {
    const fallbackRes = await fetch(`data/geo_${adcode}.json`);
    if (fallbackRes.ok) {
      const geoJson = await fallbackRes.json();
      state.geoCache.set(adcode, geoJson);
      return geoJson;
    }
  } catch (err) {
    // ignore local fallback failure
  }

  if (timedOut) {
    throw new Error(`获取地图数据超时（超过 ${FETCH_TIMEOUT / 1000}s），请检查网络后重试`);
  }
  throw new Error('无法获取该区域地图数据（可能是暂无下级边界），请检查网络');
}

/**
 * Load a map view for the given adcode/name/level.
 * Returns true on success, false on failure (triggers the retry button).
 */
export async function loadMap(adcode: string, name: string, level: number): Promise<boolean> {
  try {
    setLoading(true);
    els().statusText.textContent = `加载 ${name} 地图...`;

    const geoJson = await fetchGeoJson(adcode);
    const mapName = getMapName(adcode);
    window.echarts.registerMap(mapName, geoJson);

    state.currentView = { level, adcode, name };
    els().btnBack.hidden = level <= 0;

    if (callbacks) {
      callbacks.onMapLoaded(mapName, geoJson, level, name);
    }

    const levelLabel = level > 0 ? `${LEVEL_NAMES[level] || ''}·` : '';
    els().statusText.textContent = `${levelLabel}${name}地图已加载`;
    els().btnRetry.hidden = true;
    return true;
  } catch (err) {
    console.error('地图加载失败:', err);
    els().statusText.textContent = '地图加载失败：' + (err instanceof Error ? err.message : String(err));
    els().btnRetry.hidden = false;
    return false;
  } finally {
    setLoading(false);
  }
}
