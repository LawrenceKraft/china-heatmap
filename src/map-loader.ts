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

/** Pending fade-out timer, cancelled when the overlay is re-shown quickly. */
let fadeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Show/hide the loading overlay.
 * Showing accepts an optional stage text; hiding fades out over 250ms before
 * applying `hidden`, so rapid consecutive loads never flicker the overlay.
 */
export function setLoading(isLoading: boolean, text?: string): void {
  const overlay = els().chartOverlay;
  if (fadeTimer !== null) {
    clearTimeout(fadeTimer);
    fadeTimer = null;
  }
  if (isLoading) {
    if (text !== undefined) els().overlayText.textContent = text;
    overlay.classList.remove('overlay-exit');
    overlay.hidden = false;
  } else {
    overlay.classList.add('overlay-exit');
    fadeTimer = setTimeout(() => {
      overlay.hidden = true;
      overlay.classList.remove('overlay-exit');
      fadeTimer = null;
    }, 250);
  }
}

/** Number of retries per network source when transient network errors occur. */
const NETWORK_RETRIES = 0;

/** HTTP statuses that should never be retried (request itself is rejected by the source). */
const NO_RETRY_STATUSES = new Set([400, 401, 403, 404, 410, 451]);

/**
 * True when served from localhost / a local file, where the DataV API is reachable.
 * On hosted sites (GitHub Pages etc.) DataV is blocked by CORS/403, so it is
 * skipped entirely to keep the loading overlay snappy.
 */
function isLocalDev(): boolean {
  const host = window.location.hostname;
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '' ||
    window.location.protocol === 'file:'
  );
}

/**
 * Fetch GeoJSON for an adcode.
 *
 * Source order:
 *   1. Local fallback data/geo_<adcode>.json  — works on all hosts without network
 *   2. DataV official API (localhost only)     — blocked (CORS/403) on hosted sites
 *
 * On non-localhost hosts the DataV sources are skipped entirely, so a missing
 * local file fails fast instead of hanging on a slow/blocked network request.
 */
export async function fetchGeoJson(adcode: string): Promise<unknown> {
  if (state.geoCache.has(adcode)) {
    return state.geoCache.get(adcode);
  }

  const urls = [`data/geo_${adcode}.json`]; // 1) local fallback (fastest, no network)
  if (isLocalDev()) {
    urls.push(`${DATAV_BASE}/${adcode}_full.json`, `${DATAV_BASE}/${adcode}.json`);
  }

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
      // Permanent rejection: skip remaining retries for this source and move on.
      if (NO_RETRY_STATUSES.has(res.status)) {
        lastErr = new Error(`HTTP ${res.status}`);
        break;
      }
      lastErr = new Error(`HTTP ${res.status}`);
    }
  }

  // DataV attempted but failed; retry the local file once (only relevant on
  // localhost — on hosted sites the local file was already tried as urls[0]).
  if (isLocalDev()) {
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
    setLoading(true, `正在获取 ${name} 地图数据...`);
    els().statusText.textContent = `加载 ${name} 地图...`;

    const geoJson = await fetchGeoJson(adcode);
    const mapName = getMapName(adcode);
    setLoading(true, `正在绘制 ${name} 地图...`);
    window.echarts.registerMap(mapName, geoJson);

    // NOTE: do NOT set state.currentView here. The caller (drilldown / goBack
    // / init) is responsible for updating currentView AND state.currentPath
    // BEFORE invoking loadMap, so the onMapLoaded -> renderChart chain reads
    // the correct hierarchy path for value lookup.
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
