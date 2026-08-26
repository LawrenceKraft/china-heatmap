/**
 * Data table rendering with view filtering, search, sort, and virtual scrolling.
 */
import { getEls } from './ui.js';
import { state, getAggregatedData, getCurrentViewRegionSet } from './data-store.js';
import { escapeHtml, normalizeRegionName } from './utils.js';
import { ROW_HEIGHT, RENDER_BUFFER } from './constants.js';
import { RegionData } from './types.js';
import { renderSidebarBar, setSidebarDataProvider, computeViewFilteredData } from './sidebar-bar.js';

const els = () => getEls();

/** Register the sidebar data provider (view-filtered rows). */
export function initTable(): void {
  setSidebarDataProvider(computeViewFilteredData);
}

/** Get filtered and sorted data for the table (respects view level, search, sort). */
export function getFilteredSortedData(): RegionData[] {
  let data = computeViewFilteredData();
  if (state.search) {
    const kw = state.search.toLowerCase();
    data = data.filter((d) => d.region.toLowerCase().includes(kw));
  }
  if (state.sort.key) {
    data.sort((a, b) => {
      let result: number;
      if (state.sort.key === 'value') {
        const av = a.value != null ? a.value : -Infinity;
        const bv = b.value != null ? b.value : -Infinity;
        result = av - bv;
      } else {
        result = String(a.region).localeCompare(String(b.region), 'zh');
      }
      return state.sort.dir === 'asc' ? result : -result;
    });
  }
  return data;
}

/** Render the data table (calls virtual row renderer and sidebar bar). */
export function renderTable(): void {
  const data = getFilteredSortedData();
  const hasData = state.rawData.length > 0;

  els().tableEmpty.hidden = hasData;
  els().dataTable.hidden = !hasData;
  els().tableFooter.hidden = !hasData;

  if (hasData) {
    document.querySelectorAll('.sortable').forEach((el) => {
      const th = el as HTMLElement;
      const key = th.dataset.key as 'region' | 'value' | null;
      th.classList.toggle('sorted', state.sort.key === key);
      const arrow = th.querySelector('.sort-arrow');
      if (arrow && state.sort.key === key) {
        arrow.textContent = state.sort.dir === 'asc' ? '↑' : '↓';
      } else if (arrow) {
        arrow.textContent = '';
      }
    });

    state.tableData = data;

    if (els().tablePanel) {
      els().tablePanel!.style.maxHeight = '40vh';
      els().tablePanel!.style.height = '';
    }

    if (!(els().tablePanel as unknown as { __virtualBound?: boolean }).__virtualBound && els().tablePanel) {
      els().tablePanel!.addEventListener('scroll', () => renderVirtualRows());
      (els().tablePanel as unknown as { __virtualBound: boolean }).__virtualBound = true;
    }

    els().tableSummary.textContent = `显示 ${data.length} / 共 ${getAggregatedData().length} 个区域`;
    renderVirtualRows();
    renderSidebarBar();
  }
}

/** Render only the visible table rows (virtual scroll). */
function renderVirtualRows(): void {
  const data = state.tableData;
  if (!data.length) {
    els().tableBody.innerHTML = '';
    return;
  }
  const panel = els().tablePanel;
  const viewH = panel && panel.clientHeight ? panel.clientHeight : 300;
  const visibleCount = Math.ceil(viewH / ROW_HEIGHT);
  const scrollTop = panel ? panel.scrollTop : 0;

  let startIdx = Math.floor(scrollTop / ROW_HEIGHT) - RENDER_BUFFER;
  startIdx = Math.max(0, startIdx);
  let endIdx = startIdx + visibleCount + RENDER_BUFFER * 2;
  endIdx = Math.min(data.length, endIdx);

  const fragment = document.createDocumentFragment();
  for (let i = startIdx; i < endIdx; i++) {
    const d = data[i];
    const valStr = d.value != null ? Number(d.value).toLocaleString() : '—';
    const isSelected = state.selectedRegion && normalizeRegionName(state.selectedRegion) === normalizeRegionName(d.region);
    const tr = document.createElement('tr');
    tr.className = isSelected ? 'selected' : '';
    tr.dataset.region = d.region;
    tr.innerHTML = `<td>${escapeHtml(d.region)}</td><td>${valStr}</td>`;
    tr.addEventListener('click', () => {
      state.selectedRegion = d.region;
      const inst = window.echarts.getInstanceByDom(els().chart);
      inst?.dispatchAction({ type: 'highlight', seriesIndex: 0, name: d.region });
      els().tableBody.querySelectorAll('tr').forEach((r) => r.classList.remove('selected'));
      tr.classList.add('selected');
      if (state.currentView.level > 0 && inst) {
        const opt = inst.getOption();
        const seriesData = (opt.series as { data?: { name: string }[] }[])?.[0]?.data ?? [];
        const idx = seriesData.findIndex((x) => x.name === d.region);
        if (idx >= 0) inst.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: idx });
      }
    });
    fragment.appendChild(tr);
  }

  const topPad = startIdx * ROW_HEIGHT;
  const bottomPad = (data.length - endIdx) * ROW_HEIGHT;
  els().tableBody.innerHTML = '';
  if (topPad > 0) {
    const topTr = document.createElement('tr');
    topTr.style.height = topPad + 'px';
    topTr.innerHTML = '<td colspan="2" style="padding:0;border:none"></td>';
    els().tableBody.appendChild(topTr);
  }
  els().tableBody.appendChild(fragment);
  if (bottomPad > 0) {
    const bottomTr = document.createElement('tr');
    bottomTr.style.height = bottomPad + 'px';
    bottomTr.innerHTML = '<td colspan="2" style="padding:0;border:none"></td>';
    els().tableBody.appendChild(bottomTr);
  }
}

/** Update the statistics summary from aggregated data. */
export function updateStats(): void {
  const values = getAggregatedData().map((d) => d.value).filter((v) => v != null) as number[];
  if (!values.length) {
    els().statTotal.textContent = '0';
    els().statMax.textContent = '-';
    els().statMin.textContent = '-';
    els().statAvg.textContent = '-';
    return;
  }
  const total = values.length;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  els().statTotal.textContent = String(total);
  els().statMax.textContent = Number(max).toLocaleString();
  els().statMin.textContent = Number(min).toLocaleString();
  els().statAvg.textContent = Number(avg.toFixed(2)).toLocaleString();
}

/** Unused helper kept for type completeness (region set is used by computeViewFilteredData). */
export { getCurrentViewRegionSet };
