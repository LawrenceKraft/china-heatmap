/**
 * Sidebar top-N bar list. Reads the same aggregated data as the table.
 */
import { getEls } from './ui.js';
import { getAggregatedData } from './data-store.js';

const els = () => getEls();

/** Render the top N regions in the sidebar. */
export function renderSidebarBar(topN = 10): void {
  const rows = getAggregatedData()
    .filter((r) => r.value != null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, topN);

  if (rows.length === 0) {
    els().sidebarBarBody.innerHTML = '<div class="bar-empty">尚无数据</div>';
    return;
  }
  const max = Math.max(...rows.map((r) => r.value ?? 0));
  const html = rows
    .map((r) => {
      const pct = max > 0 ? (((r.value ?? 0) / max) * 100).toFixed(1) : '0';
      return `<div class="bar-row">
        <div class="bar-name" title="${escapeAttr(r.region)}">${escapeHtml(r.region)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="bar-value">${(r.value ?? 0).toLocaleString()}</div>
      </div>`;
    })
    .join('');
  els().sidebarBarBody.innerHTML = html;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
