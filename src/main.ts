/**
 * Application entry point: initializes DOM, ECharts, and wires up all modules.
 */
import { initUI, getEls } from './ui.js';
import { state } from './data-store.js';
import { COUNTRY_ADCODE, NATION_NAME } from './constants.js';
import { debounce } from './utils.js';
import { loadMap, setLoadMapCallbacks } from './map-loader.js';
import { setParserCallbacks, parseFile, reparseColumnMapping, removeFile, isSupportedFile, setStatus } from './data-parser.js';
import { renderChart, updateMap } from './map-renderer.js';
import { renderTable, updateStats, initTable } from './table.js';
import { updateBreadcrumb, handleMapClick, goBack } from './drilldown.js';
import { exportPng, exportCsv } from './export.js';

const els = () => getEls();

/** Initialize the whole application. */
export function init(): void {
  initUI();
  initTable();

  const chartEl = els().chart;
  const chart = window.echarts.init(chartEl);

  // Register loadMap callback: after a map loads, render it and refresh table/stats/breadcrumb.
  setLoadMapCallbacks({
    onMapLoaded: (mapName, geoJson, level, name) => {
      renderChart(mapName, geoJson, level);
      renderTable();
      updateStats();
      updateBreadcrumb();
      void name;
      void level;
    }
  });

  // Register parser callbacks: after data changes, refresh table/map/stats.
  setParserCallbacks({
    onDataApplied: () => {
      renderTable();
      updateMap();
      updateStats();
    }
  });

  bindEvents();

  // Load the initial country map.
  loadMap(COUNTRY_ADCODE, NATION_NAME, 0);

  window.addEventListener('resize', debounce(() => window.echarts.getInstanceByDom(chartEl)?.resize(), 200));
}

/** Wire up all DOM event listeners. */
function bindEvents(): void {
  // File upload
  els().uploadZone.addEventListener('click', () => els().fileInput.click());
  els().fileInput.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) parseFile(file);
  });
  els().removeFile.addEventListener('click', removeFile);

  // Drag-and-drop upload (within the upload zone only)
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

  // Column mapping changes
  els().regionColSelect.addEventListener('change', reparseColumnMapping);
  els().valueColSelect.addEventListener('change', reparseColumnMapping);

  // Search filter (debounced)
  els().searchInput.addEventListener('input', debounce(() => {
    state.search = els().searchInput.value.trim();
    renderTable();
    updateMap();
  }, 300));

  // Table sorting
  document.querySelectorAll('.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = (th as HTMLElement).dataset.key as 'region' | 'value' | null;
      if (state.sort.key === key) {
        state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort.key = key;
        state.sort.dir = 'asc';
      }
      renderTable();
      updateMap();
    });
  });

  // Back button
  els().btnBack.addEventListener('click', goBack);

  // Retry button: reload the current view
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
