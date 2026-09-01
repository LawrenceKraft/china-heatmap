/**
 * Export: current map as PNG, and the aggregated data as CSV.
 *
 * The CSV now uses 3 columns (省/市/区县/数值) to mirror the upload format,
 * so a re-uploaded file is round-trip safe.
 */
import { getEls } from './ui.js';
import { getAggregatedData } from './data-store.js';

/** Export the current map view as a PNG download. */
export function exportPng(): void {
  const chart = window.echarts.getInstanceByDom(getEls().chart);
  if (!chart) return;
  const url = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#0b1a2b' });
  const a = document.createElement('a');
  a.href = url;
  a.download = `china-heatmap-${Date.now()}.png`;
  a.click();
}

/** Export the aggregated data as a 4-column CSV (省/市/区县/数值). */
export function exportCsv(): void {
  const rows = getAggregatedData();
  if (rows.length === 0) return;
  const header = ['省', '市', '区县', '数值'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const cells = [
      csvEscape(r.province),
      csvEscape(r.city ?? ''),
      csvEscape(r.district ?? ''),
      r.value != null ? String(r.value) : ''
    ];
    lines.push(cells.join(','));
  }
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `china-heatmap-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
