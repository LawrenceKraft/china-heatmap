/**
 * Export functionality: PNG image and CSV data download.
 */
import { getEls } from './ui.js';
import { state } from './data-store.js';
import { csvEscape } from './utils.js';
import { NATION_NAME } from './constants.js';
import { getFilteredSortedData } from './table.js';

const els = () => getEls();

function setStatus(text: string, type: 'info' | 'loading' | 'error' | 'ok' = 'info'): void {
  els().statusText.textContent = text;
  els().statusDot.className = 'status-dot';
  if (type === 'loading') els().statusDot.classList.add('loading');
  if (type === 'error') els().statusDot.classList.add('error');
}

/** Export the current map view as a PNG image. */
export function exportPng(): void {
  try {
    const inst = window.echarts.getInstanceByDom(els().chart);
    if (!inst) {
      setStatus('地图尚未加载，无法导出', 'error');
      return;
    }
    const url = inst.getDataURL({
      type: 'png',
      pixelRatio: 2,
      backgroundColor: '#0d1b2a'
    });
    const a = document.createElement('a');
    a.href = url;
    a.download = `中国热力地图_${state.currentView.name || NATION_NAME}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setStatus('图片已导出', 'ok');
  } catch (err) {
    console.error('导出图片失败:', err);
    setStatus('导出图片失败：' + (err instanceof Error ? err.message : String(err)), 'error');
  }
}

/** Export the current table data as a CSV file (UTF-8 BOM to avoid Excel garbling). */
export function exportCsv(): void {
  try {
    const data = getFilteredSortedData();
    if (!data.length) {
      setStatus('暂无数据可导出', 'error');
      return;
    }
    const rows = data.map((d) => `${csvEscape(d.region)},${csvEscape(d.value != null ? d.value : '')}`);
    const csv = '\uFEFF区域,数值\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `中国热力地图数据_${state.currentView.name || NATION_NAME}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatus('数据已导出', 'ok');
  } catch (err) {
    console.error('导出数据失败:', err);
    setStatus('导出数据失败：' + (err instanceof Error ? err.message : String(err)), 'error');
  }
}
