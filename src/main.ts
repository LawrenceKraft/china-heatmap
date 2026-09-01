/**
 * Application entry point: initializes DOM, ECharts, and wires up all modules.
 *
 * Search interaction (search suggestion dropdown):
 * - Typing in the search box filters getAggregatedData() across ALL levels
 *   (province/city/district) and renders up to 10 suggestions below the input.
 * - Matching priority: exact leaf-name match > leaf-name prefix > full-path
 *   substring containment.
 * - Clicking a suggestion (mousedown, before blur) fills the input with the
 *   full region path and triggers drillToPath(), a cross-level chain jump
 *   that can move UP as well as down (e.g. from inside Guangdong to Shanghai).
 * - Keyboard: ArrowUp/Down move the active item, Enter picks it, Escape closes.
 */
import { initUI, getEls } from './ui.js';
import { state, getAggregatedData } from './data-store.js';
import { COUNTRY_ADCODE, NATION_NAME } from './constants.js';
import { debounce, escapeHtml } from './utils.js';
import { loadMap, setLoadMapCallbacks } from './map-loader.js';
import { setParserCallbacks, parseFile, reparseColumnMapping, removeFile, isSupportedFile, setStatus, setRegionIndex } from './data-parser.js';
import { renderChart, updateMap } from './map-renderer.js';
import { renderTable, updateStats, initTable } from './table.js';
import { updateBreadcrumb, handleMapClick, goBack, drillToPath } from './drilldown.js';
import { exportPng, exportCsv } from './export.js';
import { RegionData, RegionIndex } from './types.js';

const els = () => getEls();

/* ------------------------------------------------------------------ */
/* Search suggestion state                                             */
/* ------------------------------------------------------------------ */

let suggestItems: RegionData[] = [];
let suggestIndex = -1;

/** Filter aggregated rows for the suggestion list, best matches first. */
function filterSuggestions(query: string): RegionData[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const all = getAggregatedData();
  const scored: { r: RegionData; score: number }[] = [];
  for (const r of all) {
    const leaf = (r.district ?? r.city ?? r.province).toLowerCase();
    const path = r.region.toLowerCase();
    if (leaf === q) scored.push({ r, score: 0 });
    else if (leaf.startsWith(q)) scored.push({ r, score: 1 });
    else if (path.includes(q)) scored.push({ r, score: 2 });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, 10).map((x) => x.r);
}

/** Render the suggestion dropdown below the search input. */
function renderSuggest(items: RegionData[]): void {
  suggestItems = items;
  suggestIndex = -1;
  if (items.length === 0) {
    els().searchSuggest.innerHTML = '<div class="suggest-empty">无匹配地区</div>';
    els().searchSuggest.hidden = false;
    return;
  }
  const html = items
    .map((r, i) => {
      const val = r.value != null ? r.value.toLocaleString() : '—';
      return `<div class="suggest-item" data-idx="${i}">
        <span class="suggest-path">${escapeHtml(r.region)}</span>
        <span class="suggest-value">${val}</span>
      </div>`;
    })
    .join('');
  els().searchSuggest.innerHTML = html;
  els().searchSuggest.hidden = false;

  els().searchSuggest.querySelectorAll('.suggest-item').forEach((el) => {
    // mousedown fires before the input's blur; preventDefault keeps focus.
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const idx = parseInt((el as HTMLElement).dataset.idx ?? '0', 10);
      pickSuggestion(idx);
    });
  });
}

/** Apply the .active class to the current keyboard-selected item. */
function highlightSuggest(): void {
  const nodes = els().searchSuggest.querySelectorAll('.suggest-item');
  nodes.forEach((el, i) => el.classList.toggle('active', i === suggestIndex));
  const active = els().searchSuggest.querySelector('.suggest-item.active');
  active?.scrollIntoView({ block: 'nearest' });
}

/** Hide and reset the suggestion dropdown. */
function hideSuggest(): void {
  els().searchSuggest.hidden = true;
  els().searchSuggest.innerHTML = '';
  suggestItems = [];
  suggestIndex = -1;
}

/** Fill the input with the chosen region path and jump to it. */
async function pickSuggestion(idx: number): Promise<void> {
  const r = suggestItems[idx];
  if (!r) return;
  els().searchInput.value = r.region;
  hideSuggest();
  await drillToPath(r);
}

/** Jump using the current input value (button click or Enter with no dropdown). */
function jumpFromInput(): void {
  const q = els().searchInput.value.trim();
  if (!q) {
    setStatus('请输入要跳转的地区名称', 'error');
    return;
  }
  const items = filterSuggestions(q);
  if (items.length === 0) {
    setStatus(`未找到: ${q}`, 'error');
    return;
  }
  const target =
    suggestIndex >= 0 && suggestItems[suggestIndex] ? suggestItems[suggestIndex] : items[0];
  els().searchInput.value = target.region;
  hideSuggest();
  drillToPath(target);
}

/* ------------------------------------------------------------------ */
/* App bootstrap                                                       */
/* ------------------------------------------------------------------ */

/** 数据模板文件名（由 scripts/gen-template.mjs 生成，随 data/ 目录部署） */
const TEMPLATE_FILE = '热力地图数据模板.xlsx';

/** Download the built-in Excel template via fetch + blob. */
async function downloadTemplate(): Promise<void> {
  try {
    const res = await fetch(`data/${encodeURIComponent(TEMPLATE_FILE)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = TEMPLATE_FILE;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus('模板已开始下载', 'ok');
  } catch {
    setStatus('模板下载失败，请检查网络后重试', 'error');
  }
}

/**
 * Preload the offline region index so city-only rows can be auto-filled with
 * their province. On failure the app gracefully falls back to strict
 * validation (city without province is rejected).
 */
async function loadRegionIndex(): Promise<void> {
  try {
    const res = await fetch('data/region-index.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const index = (await res.json()) as RegionIndex;
    setRegionIndex(index);
    console.log(`[region-index] 已加载 ${index.provinceIndex.length} 省 / ${index.cityIndex.length} 市`);
  } catch (err) {
    console.warn('[region-index] 加载失败，仅上传市名时将无法自动填充省份:', err);
    setRegionIndex(null);
  }
}

/** Initialize the whole application. */
export function init(): void {
  initUI();
  initTable();
  loadRegionIndex();

  const chartEl = els().chart;
  window.echarts.init(chartEl);

  // After a map loads, render it and refresh dependent UI.
  setLoadMapCallbacks({
    onMapLoaded: (mapName, geoJson, level) => {
      renderChart(mapName, geoJson, level);
      renderTable();
      updateStats();
      updateBreadcrumb();
    }
  });

  // After data changes, refresh table/map/stats.
  setParserCallbacks({
    onDataApplied: () => {
      renderTable();
      updateMap();
      updateStats();
    }
  });

  bindEvents();

  // Load the initial country map.
  state.currentPath = { province: null, city: null, district: null };
  loadMap(COUNTRY_ADCODE, NATION_NAME, 0);

  window.addEventListener('resize', debounce(() => window.echarts.getInstanceByDom(chartEl)?.resize(), 200));
}

/** Wire up all DOM event listeners. */
function bindEvents(): void {
  // File upload
  els().uploadZone.addEventListener('click', () => els().fileInput.click());
  els().btnDownloadTemplate.addEventListener('click', downloadTemplate);
  els().fileInput.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) parseFile(file);
  });
  els().removeFile.addEventListener('click', () => {
    removeFile();
    updateMap();
  });

  // Drag-and-drop upload
  const preventDrag = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  ['dragenter', 'dragover'].forEach((evt) => {
    els().uploadZone.addEventListener(evt, (e) => {
      preventDrag(e);
      els().uploadZone.classList.add('dragover');
    });
  });
  els().uploadZone.addEventListener('dragleave', (e) => {
    preventDrag(e);
    els().uploadZone.classList.remove('dragover');
  });
  els().uploadZone.addEventListener('drop', (e) => {
    preventDrag(e);
    els().uploadZone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file && isSupportedFile(file)) parseFile(file);
  });

  // Column mapping changes (all 4 selects)
  els().regionColSelect.addEventListener('change', reparseColumnMapping);
  els().cityColSelect.addEventListener('change', reparseColumnMapping);
  els().districtColSelect.addEventListener('change', reparseColumnMapping);
  els().valueColSelect.addEventListener('change', reparseColumnMapping);

  // ---- Search suggestion dropdown ----
  els().searchInput.addEventListener(
    'input',
    debounce(() => {
      const q = els().searchInput.value;
      if (!q.trim()) {
        hideSuggest();
        return;
      }
      renderSuggest(filterSuggestions(q));
    }, 200)
  );

  els().searchInput.addEventListener('keydown', (e) => {
    const dropdownOpen = !els().searchSuggest.hidden && suggestItems.length > 0;
    if (!dropdownOpen) {
      if (e.key === 'Enter') {
        e.preventDefault();
        jumpFromInput();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      suggestIndex = (suggestIndex + 1) % suggestItems.length;
      highlightSuggest();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      suggestIndex = (suggestIndex - 1 + suggestItems.length) % suggestItems.length;
      highlightSuggest();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pickSuggestion(suggestIndex >= 0 ? suggestIndex : 0);
    } else if (e.key === 'Escape') {
      hideSuggest();
    }
  });

  els().searchInput.addEventListener('blur', () => {
    // Delay so a mousedown on a suggestion registers first.
    setTimeout(hideSuggest, 120);
  });

  els().btnSearch.addEventListener('click', jumpFromInput);

  // Table sorting
  document.querySelectorAll('.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = (th as HTMLElement).dataset.key as 'region' | 'value' | null;
      if (state.sort.key === key) {
        state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort.key = key;
        state.sort.dir = key === 'value' ? 'desc' : 'asc';
      }
      renderTable();
    });
  });

  // Back button
  els().btnBack.addEventListener('click', goBack);

  // Retry button
  els().btnRetry.addEventListener('click', () => {
    els().btnRetry.hidden = true;
    loadMap(state.currentView.adcode, state.currentView.name, state.currentView.level);
  });

  // Export buttons
  els().btnExportPng.addEventListener('click', exportPng);
  els().btnExportCsv.addEventListener('click', exportCsv);

  // Map events
  const inst = window.echarts.getInstanceByDom(els().chart);
  inst?.on('click', (params) => {
    handleMapClick(params as { name?: string });
  });
  inst?.on('mouseover', (params) => {
    const p = params as { componentType?: string; name?: string };
    if (p.componentType === 'series') {
      setStatus('查看区域：' + p.name);
    }
  });
}

// Boot: handle both static and dynamic script loading.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
