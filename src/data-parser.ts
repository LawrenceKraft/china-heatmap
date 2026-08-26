/**
 * File parsing, column mapping, and data validation.
 * Decoupled from UI modules via injected callbacks (avoid circular imports).
 */
import { state, invalidateAggregation } from './data-store.js';
import { getEls } from './ui.js';
import { escapeAttr, escapeHtml, normalizeRegionName } from './utils.js';
import { SUPPORTED_EXTENSIONS } from './constants.js';
import { RegionData, RawRow, ParseIssues } from './types.js';

const els = () => getEls();

/** Callbacks injected by main.ts to refresh UI after data changes. */
export interface ParserCallbacks {
  onDataApplied: () => void;
}

let callbacks: ParserCallbacks | null = null;

/** Register callbacks that refresh table/map/stats after data changes. */
export function setParserCallbacks(cb: ParserCallbacks): void {
  callbacks = cb;
}

function notifyDataApplied(): void {
  if (callbacks) callbacks.onDataApplied();
}

/** Show a status message in the status bar. */
export function setStatus(text: string, type: 'info' | 'loading' | 'error' | 'ok' = 'info'): void {
  els().statusText.textContent = text;
  els().statusDot.className = 'status-dot';
  if (type === 'loading') els().statusDot.classList.add('loading');
  if (type === 'error') els().statusDot.classList.add('error');
}

/** Check whether a file extension is supported. */
export function isSupportedFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return SUPPORTED_EXTENSIONS.includes(ext);
}

/** Parse an uploaded file (CSV/TSV as UTF-8 text, Excel as binary). */
export function parseFile(file: File): void {
  const reader = new FileReader();
  const isCsvLike = /\.(csv|tsv)$/i.test(file.name);

  reader.onload = (e) => {
    try {
      const result = (e.target as FileReader).result;
      let workbook;
      if (isCsvLike) {
        let text = typeof result === 'string' ? result : '';
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
        workbook = (window as unknown as { XLSX: { read: (data: string, opts: { type: string; raw: boolean }) => { Sheets: Record<string, unknown>; SheetNames: string[] } } }).XLSX.read(text, { type: 'string', raw: false });
      } else {
        const data = new Uint8Array(result as ArrayBuffer);
        workbook = (window as unknown as { XLSX: { read: (data: Uint8Array, opts: { type: string }) => { Sheets: Record<string, unknown>; SheetNames: string[] } } }).XLSX.read(data, { type: 'array' });
      }
      const firstSheet = (workbook as { Sheets: Record<string, unknown>; SheetNames: string[] }).Sheets[(workbook as { Sheets: Record<string, unknown>; SheetNames: string[] }).SheetNames[0]];
      const json = (window as unknown as { XLSX: { utils: { sheet_to_json(sheet: unknown, opts: { defval: string }): RawRow[] } } }).XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
      if (!json.length) throw new Error('表格为空');

      state.rawRows = json;
      const headers = Object.keys(json[0]);
      const numericCols = detectNumericColumns(json, headers);

      fillColumnSelects(headers, numericCols);
      els().regionColSelect.value = headers[0] || '';
      els().valueColSelect.value = numericCols[0] || headers[1] || '';

      els().fileName.textContent = file.name;
      els().fileMeta.textContent = `${json.length} 行数据 · ${headers.length} 列 · ${numericCols.length} 个指标`;
      els().fileInfo.hidden = false;
      els().columnMapping.hidden = false;

      reparseColumnMapping();
      els().fileInput.value = '';
      setStatus(`已加载 ${json.length} 行数据`, 'ok');
    } catch (err) {
      console.error('文件解析失败:', err);
      setStatus('文件解析失败：' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  };
  reader.onerror = () => setStatus('文件读取失败', 'error');

  if (isCsvLike) {
    reader.readAsText(file, 'utf-8');
  } else {
    reader.readAsArrayBuffer(file);
  }
}

/** Detect numeric columns: columns where >=80% of cells parse as numbers. */
function detectNumericColumns(rows: RawRow[], headers: string[]): string[] {
  return headers.filter((h) => {
    let numeric = 0;
    let total = 0;
    rows.forEach((row) => {
      const raw = row[h];
      if (raw == null || raw === '') return;
      total++;
      const cleaned = String(raw).replace(/[,，\s%]/g, '');
      if (!isNaN(parseFloat(cleaned))) numeric++;
    });
    return total > 0 && numeric / total >= 0.8;
  });
}

/** Fill the region/value column dropdowns. */
function fillColumnSelects(headers: string[], numericCols: string[]): void {
  const allOpts = headers
    .map((h) => `<option value="${escapeAttr(h)}">${escapeHtml(h)}</option>`)
    .join('');
  els().regionColSelect.innerHTML = allOpts;
  const numCols = numericCols && numericCols.length ? numericCols : headers;
  const numOpts = numCols
    .map((h) => `<option value="${escapeAttr(h)}">${escapeHtml(h)}</option>`)
    .join('');
  els().valueColSelect.innerHTML = numOpts;
}

/** Re-parse column mapping based on selected region/value columns. */
export function reparseColumnMapping(): void {
  const regionCol = els().regionColSelect.value;
  const valueCol = els().valueColSelect.value;
  if (!regionCol || !valueCol || !state.rawRows) return;

  const parsed = state.rawRows.map((row) => {
    const region = String(row[regionCol] != null ? row[regionCol] : '').trim();
    const rawValue: unknown = row[valueCol];
    let value: number | null = null;
    if (typeof rawValue === 'string') {
      const cleaned = rawValue.replace(/[,，\s%]/g, '');
      const parsed = parseFloat(cleaned);
      value = isNaN(parsed) ? null : parsed;
    } else if (typeof rawValue === 'number' && !isNaN(rawValue)) {
      value = rawValue;
    }
    return { region, value } as RegionData;
  });

  const issues = validateParsedData(parsed);

  if (issues.hasIssues) {
    showConfirmModal(issues, () => {
      applyDataWithIssues(parsed);
    }, () => {
      clearAppliedData();
    });
    return;
  }

  applyData(parsed);
}

/** Validate parsed data: duplicate headers, empty regions, bad values, unknown regions. */
function validateParsedData(parsed: RegionData[]): ParseIssues {
  const issues: ParseIssues = {
    hasIssues: false,
    duplicateHeaders: [],
    emptyRegionRows: 0,
    badValueRows: 0,
    unknownRegionRows: 0,
    totalRows: parsed.length,
    sampleUnknown: []
  };

  const headers = Object.keys(state.rawRows[0] || {});
  headers.forEach((h) => {
    if (/_\d+$/.test(h)) {
      const base = h.replace(/_\d+$/, '');
      if (!issues.duplicateHeaders.includes(base)) issues.duplicateHeaders.push(base);
    }
  });

  const knownSet = getKnownRegionSet();
  const unknownSamples: string[] = [];
  let emptyRegion = 0;
  let badValue = 0;
  let unknown = 0;
  parsed.forEach((d) => {
    if (!d.region) emptyRegion++;
    if (d.value == null) badValue++;
    if (d.region && knownSet.size) {
      const norm = normalizeRegionName(d.region);
      if (!knownSet.has(d.region) && !knownSet.has(norm)) {
        unknown++;
        if (unknownSamples.length < 5) unknownSamples.push(d.region);
      }
    }
  });
  issues.emptyRegionRows = emptyRegion;
  issues.badValueRows = badValue;
  issues.unknownRegionRows = unknown;
  issues.sampleUnknown = unknownSamples;
  issues.hasIssues = issues.duplicateHeaders.length > 0 || emptyRegion > 0 || badValue > 0;
  return issues;
}

/** Get region names recognized in the current view (for unknown-address hints). */
function getKnownRegionSet(): Set<string> {
  const set = new Set<string>();
  const geoJson = state.geoCache.get(state.currentView.adcode) as { features?: { properties: { name: string } }[] } | undefined;
  if (geoJson && geoJson.features) {
    geoJson.features.forEach((f) => {
      const n = f.properties.name;
      set.add(n);
      set.add(normalizeRegionName(n));
    });
  }
  return set;
}

/** Apply clean data (no issues). */
function applyData(parsed: RegionData[]): void {
  state.rawData = parsed.filter((d) => d.region);
  invalidateAggregation();
  notifyDataApplied();
  setStatus('数据已绑定到地图', 'ok');
}

/** Apply data ignoring problem rows (empty region / bad values). */
function applyDataWithIssues(parsed: RegionData[]): void {
  state.rawData = parsed.filter((d) => d.region && d.value != null);
  invalidateAggregation();
  notifyDataApplied();
  setStatus(`已忽略问题行，加载 ${state.rawData.length} 行数据`, 'ok');
}

/** Cancel import: clear all data. */
function clearAppliedData(): void {
  state.rawData = [];
  state.rawRows = [];
  invalidateAggregation();
  els().fileInput.value = '';
  els().fileInfo.hidden = true;
  els().columnMapping.hidden = true;
  els().regionColSelect.innerHTML = '';
  els().valueColSelect.innerHTML = '';
  notifyDataApplied();
  setStatus('已取消导入', 'error');
}

/** Remove the currently loaded file and reset all related state. */
export function removeFile(): void {
  state.rawData = [];
  state.rawRows = [];
  state.regionValueMap = new Map();
  state.aggregatedData = null;
  state.aggValid = false;
  state.selectedRegion = null;
  state.sort = { key: null, dir: 'asc' };
  state.search = '';
  els().fileInput.value = '';
  els().searchInput.value = '';
  els().fileInfo.hidden = true;
  els().columnMapping.hidden = true;
  els().regionColSelect.innerHTML = '';
  els().valueColSelect.innerHTML = '';
  notifyDataApplied();
}

/** Display the data-validation confirmation modal. */
function showConfirmModal(issues: ParseIssues, onOk: () => void, onCancel: () => void): void {
  const lines: string[] = [];
  lines.push(`共解析 ${issues.totalRows} 行数据，发现以下问题：`);
  lines.push('');
  if (issues.duplicateHeaders.length) {
    lines.push(`· 表头重复：${issues.duplicateHeaders.join('、')}`);
  }
  if (issues.emptyRegionRows > 0) {
    lines.push(`· ${issues.emptyRegionRows} 行缺少区域名（空值）`);
  }
  if (issues.badValueRows > 0) {
    lines.push(`· ${issues.badValueRows} 行的数值不可读（已解析为空值）`);
  }
  if (issues.unknownRegionRows > 0) {
    lines.push(`· ${issues.unknownRegionRows} 行在当前地图中暂未识别：${issues.sampleUnknown.join('、')}`);
  }
  lines.push('');
  lines.push('是否忽略上述问题行继续展示？');

  els().confirmTitle.textContent = '数据校验提示';
  els().confirmBody.innerHTML = escapeHtml(lines.join('\n')).replace(/\n/g, '<br>');
  els().confirmModal.hidden = false;

  const okHandler = () => {
    els().confirmModal.hidden = true;
    els().confirmOk.removeEventListener('click', okHandler);
    els().confirmCancel.removeEventListener('click', cancelHandler);
    onOk();
  };
  const cancelHandler = () => {
    els().confirmModal.hidden = true;
    els().confirmOk.removeEventListener('click', okHandler);
    els().confirmCancel.removeEventListener('click', cancelHandler);
    onCancel();
  };
  els().confirmOk.addEventListener('click', okHandler);
  els().confirmCancel.addEventListener('click', cancelHandler);
}
