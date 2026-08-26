/**
 * Sidebar horizontal bar chart shown when drilled into a province/city view.
 * Uses Y-axis dataZoom slider so each bar and its Chinese label align clearly.
 */
import { getEls } from './ui.js';
import { state, getAggregatedData, getCurrentViewRegionSet } from './data-store.js';
import { normalizeRegionName } from './utils.js';

const els = () => getEls();

/** Shared bar chart instance (kept across renders). */
let sidebarBarChart: ReturnType<typeof window.echarts.init> | null = null;

/** Data used by table view filtering (provided by table.ts via callback). */
let getViewFilteredData: () => { region: string; value: number | null }[] = () => [];

/** Allow table.ts to register the view-filtered data provider. */
export function setSidebarDataProvider(provider: () => { region: string; value: number | null }[]): void {
  getViewFilteredData = provider;
}

/** Render the sidebar bar comparison chart for the current view. */
export function renderSidebarBar(): void {
  const data = getViewFilteredData();
  const hasBar = state.currentView.level > 0 && data.some((d) => d.value != null);
  els().sidebarBarPanel.hidden = !hasBar;
  if (!hasBar) return;

  const items = data.filter((d) => d.value != null).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  if (!items.length) {
    els().sidebarBarPanel.hidden = true;
    return;
  }
  if (!sidebarBarChart) sidebarBarChart = window.echarts.init(els().sidebarBarBody);

  const visibleCount = Math.min(8, items.length);
  const names = items.map((it) => it.region);
  const values = items.map((it) => it.value);

  sidebarBarChart.clear();
  sidebarBarChart.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (ps: { name?: string; value?: unknown }[]) => {
        const p = ps[0];
        return `<b>${p?.name}</b><br/>数值：${Number(p?.value).toLocaleString()}`;
      }
    },
    grid: { left: 8, right: 28, top: 12, bottom: 48, containLabel: true },
    xAxis: {
      type: 'value',
      axisLabel: { color: '#93a7bd', fontSize: 10, formatter: (v: number) => (Math.abs(v) >= 10000 ? (v / 10000).toFixed(1) + '万' : String(v)) },
      splitLine: { lineStyle: { color: 'rgba(42,63,92,0.4)' } }
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: names,
      axisLabel: { color: '#e8eef5', fontSize: 11, width: 120, overflow: 'truncate' }
    },
    dataZoom: [{
      type: 'slider',
      yAxisIndex: 0,
      show: items.length > visibleCount,
      startValue: 0,
      endValue: visibleCount - 1,
      right: 0,
      width: 14,
      fillerColor: 'rgba(79,163,255,0.25)',
      borderColor: 'rgba(79,163,255,0.4)',
      handleStyle: { color: '#4fa3ff', borderColor: '#4fa3ff' },
      textStyle: { color: '#93a7bd', fontSize: 9 }
    }],
    series: [{
      type: 'bar',
      data: values,
      barMaxWidth: 26,
      barCategoryGap: '35%',
      itemStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
          colorStops: [{ offset: 0, color: '#4fa3ff' }, { offset: 1, color: '#7cc4ff' }]
        },
        borderRadius: [0, 4, 4, 0]
      },
      label: {
        show: true,
        position: 'right',
        color: '#e8eef5',
        fontSize: 10,
        formatter: (p: { value: unknown }) => Number(p.value).toLocaleString()
      }
    }]
  });
}

/** Utility used by table.ts to compute view-filtered data. */
export function computeViewFilteredData(): { region: string; value: number | null }[] {
  let data = getAggregatedData();
  if (state.currentView.level > 0) {
    const viewSet = getCurrentViewRegionSet();
    if (viewSet.size > 0) {
      data = data.filter((d) => viewSet.has(d.region) || viewSet.has(normalizeRegionName(d.region)));
    }
  }
  return data;
}
