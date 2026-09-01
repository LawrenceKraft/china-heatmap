/**
 * Data table: rendering, sorting, and row-highlight interaction.
 *
 * Rendering model
 * ---------------
 * - Rows come from getRowsForCurrentView() (only regions in the current
 *   drill level) and are rendered as plain <tr> rows inside the scrollable
 *   .table-scroll container. The container provides native scrollbar + mouse
 *   wheel scrolling via CSS (max-height + overflow-y: auto), so no JS
 *   virtualization is needed — the per-level row count is small (34 provinces
 *   / ~21 cities / ~20 districts at most).
 * - Default sort is by value descending; clicking a column header toggles
 *   region/value sorting.
 *
 * Historical bugs fixed here:
 * - #dataTable / #tableFooter start with the `hidden` attribute in HTML and
 *   were never un-hidden, so the table was invisible. renderTable() now
 *   explicitly manages both.
 * - The previous virtual scroll wrote a <div class="spacer"> into <tbody>,
 *   which is invalid HTML (tbody may only contain tr) — the browser hoisted
 *   the div out of the table and broke the layout. All rows are now standard
 *   <tr><td> elements.
 */
import { getEls } from './ui.js';
import { state, getRowsForCurrentView } from './data-store.js';
import { RegionData } from './types.js';
import { escapeHtml } from './utils.js';

const els = () => getEls();

/** Rows for the current view level after the active sort is applied. */
function getVisibleRows(): RegionData[] {
  const rows = getRowsForCurrentView().slice();
  // Default sort: value descending (largest region first).
  const sortKey = state.sort.key ?? 'value';
  const dir = state.sort.dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    if (sortKey === 'value') {
      const av = a.value ?? -Infinity;
      const bv = b.value ?? -Infinity;
      return (av - bv) * dir;
    }
    return a.region.localeCompare(b.region, 'zh') * dir;
  });
  return rows;
}

/**
 * Initialize the table. Scrolling is handled natively by the .table-scroll
 * container, so there is nothing to wire up here — the hook is kept so
 * main.ts can call it symmetrically with other init functions.
 */
export function initTable(): void {
  /* intentionally empty: scrolling is pure CSS */
}

/** Re-render the table from scratch. */
export function renderTable(): void {
  const rows = getVisibleRows();
  state.tableData = rows;

  // Empty state: keep the footer visible (row count feedback) but hide rows.
  if (rows.length === 0) {
    els().tableBody.innerHTML = '';
    els().dataTable.hidden = true;
    els().tableEmpty.hidden = false;
    els().tableEmpty.textContent = state.rawData.length === 0 ? '请先上传数据' : '当前层级无数据';
    els().tableFooter.hidden = false;
    els().tableSummary.textContent = '当前层级共 0 条';
    return;
  }

  // KEY FIX: the table starts hidden in HTML — it must be un-hidden here,
  // otherwise nothing the renderer does will ever be visible.
  els().tableEmpty.hidden = true;
  els().dataTable.hidden = false;
  els().tableFooter.hidden = false;

  // Header sort indicators ("value desc" is the implicit default state).
  document.querySelectorAll('.sortable').forEach((th) => {
    const k = (th as HTMLElement).dataset.key;
    const icon = th.querySelector('.sort-icon');
    if (!icon) return;
    const isDefaultValue = k === 'value' && state.sort.key == null;
    const isCurrent = state.sort.key === k || isDefaultValue;
    icon.textContent = !isCurrent ? '↕' : state.sort.dir === 'asc' ? '↑' : '↓';
  });

  // Standard <tr><td> rows (valid tbody content). Row count per level is
  // small, so rendering everything at once is both correct and fast.
  const html = rows
    .map((r, i) => {
      const valueClass = r.value == null ? 'value-empty' : '';
      const isSel = state.selectedRegion && r.region === state.selectedRegion ? ' selected' : '';
      return `<tr class="data-row${isSel}" data-idx="${i}">
        <td>${escapeHtml(r.region)}</td>
        <td class="${valueClass}" style="text-align:right">${formatValue(r.value)}</td>
      </tr>`;
    })
    .join('');
  els().tableBody.innerHTML = html;

  // Row click -> highlight the region on the map.
  els().tableBody.querySelectorAll('tr.data-row').forEach((trEl) => {
    trEl.addEventListener('click', () => {
      const idx = parseInt((trEl as HTMLElement).dataset.idx ?? '0', 10);
      const r = state.tableData[idx];
      if (!r) return;
      state.selectedRegion = r.region;
      renderTable();
      // Highlight uses the leaf-level name (the actual map feature name).
      const leaf = r.district ?? r.city ?? r.province;
      window.echarts.getInstanceByDom(els().chart)?.dispatchAction({
        type: 'highlight',
        seriesIndex: 0,
        name: leaf
      });
    });
  });

  const totalInLevel = getRowsForCurrentView().length;
  els().tableSummary.textContent = `当前层级共 ${totalInLevel} 条 · 按数值从大到小`;
}

function formatValue(v: number | null): string {
  if (v == null) return '—';
  if (Number.isInteger(v)) return v.toLocaleString();
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Update the top-level statistics bar (总数 / 最大 / 最小 / 平均). */
export function updateStats(): void {
  const rows = getRowsForCurrentView().filter((r) => r.value != null) as { value: number }[];
  els().statTotal.textContent = String(rows.length);
  if (rows.length === 0) {
    els().statMax.textContent = '—';
    els().statMin.textContent = '—';
    els().statAvg.textContent = '—';
    return;
  }
  const values = rows.map((r) => r.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  els().statMax.textContent = max.toLocaleString();
  els().statMin.textContent = min.toLocaleString();
  els().statAvg.textContent = avg.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
