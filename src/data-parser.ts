/**
 * File parsing, hierarchical column detection, and strict validation.
 *
 * The required file shape is 4 columns: 省 / 市 / 区县 / 数值.
 *   - 省   is mandatory
 *   - 市   is mandatory whenever 区县 has a value
 *         (直辖市除外：如 北京市/空/朝阳区 合法，市位自动归一化为省名)
 *   - 区县 is optional
 *   - 数值 must be a number
 *
 * The header row is auto-detected against a list of common Chinese/English
 * aliases; the user does not need to manually map columns.
 *
 * Validation is strict: any structural problem (missing parent, duplicate
 * path, empty province, bad value, missing required header) blocks the file.
 * The user must upload a corrected file — there is no "ignore and continue"
 * path, because silently dropping rows would corrupt the hierarchy and the
 * map's heat values.
 */
import { state, clearAllData, invalidateAggregation } from './data-store.js';
import { getEls } from './ui.js';
import { escapeAttr, escapeHtml, normalizeRegionName } from './utils.js';
import { SUPPORTED_EXTENSIONS, COLUMN_PATTERNS, ColumnRole, isMunicipality } from './constants.js';
import { RegionData, HierarchicalRegion, ParseIssues, RawRow, RegionIndex } from './types.js';

const els = () => getEls();

/* ------------------------------------------------------------------ */
/* City -> province reverse lookup (offline region index)              */
/* ------------------------------------------------------------------ */

/** Injected by main.ts from data/region-index.json. Null => lookup disabled. */
let regionIndex: RegionIndex | null = null;
/** 原始市名 -> 省份列表 */
let exactCityMap: Map<string, string[]> | null = null;
/** 归一化市名（如"广州"）-> 省份列表 */
let normCityMap: Map<string, string[]> | null = null;

/** Inject the offline region index (called once at startup by main.ts). */
export function setRegionIndex(index: RegionIndex | null): void {
  regionIndex = index;
  exactCityMap = null;
  normCityMap = null;
}

/** Build the reverse lookup maps lazily on first use. */
function ensureLookupMaps(): void {
  if (exactCityMap || !regionIndex) return;
  exactCityMap = new Map();
  normCityMap = new Map();
  for (const e of regionIndex.cityIndex) {
    const ex = exactCityMap.get(e.city) ?? [];
    ex.push(e.province);
    exactCityMap.set(e.city, ex);
    const norm = normalizeRegionName(e.city);
    if (!norm) continue;
    const nl = normCityMap.get(norm) ?? [];
    nl.push(e.province);
    normCityMap.set(norm, nl);
  }
}

export type CityLookupResult =
  | { province: string }
  | { reason: 'notFound' | 'ambiguous' };

/**
 * Look up the province a city belongs to. Exact name match wins over
 * normalized match (so "吉林" never collides with "吉林市"). Returns:
 *  - { province }     unique match (province will be auto-filled)
 *  - notFound         no city matched (user should fill the province column)
 *  - ambiguous        multiple provinces share the name (fill province column)
 */
export function lookupProvinceByCity(city: string): CityLookupResult {
  ensureLookupMaps();
  if (!city.trim()) return { reason: 'notFound' };
  const exact = exactCityMap?.get(city);
  if (exact && exact.length > 0) {
    const uniq = [...new Set(exact)];
    return uniq.length === 1 ? { province: uniq[0] } : { reason: 'ambiguous' };
  }
  const norm = normalizeRegionName(city);
  if (!norm) return { reason: 'notFound' };
  const matches = normCityMap?.get(norm);
  if (!matches || matches.length === 0) return { reason: 'notFound' };
  const uniq = [...new Set(matches)];
  return uniq.length === 1 ? { province: uniq[0] } : { reason: 'ambiguous' };
}

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
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
        workbook = (window as unknown as { XLSX: { read: (data: string, opts: { type: string; raw: boolean }) => { Sheets: Record<string, unknown>; SheetNames: string[] } } }).XLSX.read(text, { type: 'string', raw: false });
      } else {
        const data = new Uint8Array(result as ArrayBuffer);
        workbook = (window as unknown as { XLSX: { read: (data: Uint8Array, opts: { type: string }) => { Sheets: Record<string, unknown>; SheetNames: string[] } } }).XLSX.read(data, { type: 'array' });
      }
      const wb = workbook as { Sheets: Record<string, unknown>; SheetNames: string[] };
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      const json = (window as unknown as { XLSX: { utils: { sheet_to_json(sheet: unknown, opts: { defval: string }): RawRow[] } } }).XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
      if (!json.length) throw new Error('表格为空');

      state.rawRows = json;
      const headers = Object.keys(json[0]);

      // Auto-detect the 4 columns from the header row.
      const mapping = detectColumnMapping(headers);
      if (!mapping.province || !mapping.value) {
        showRejectModal({
          hasIssues: true,
          duplicateHeaders: [],
          emptyRegionRows: 0,
          badValueRows: 0,
          totalRows: json.length,
          missingParentRows: [],
          districtOnlyRows: [],
          duplicatePathRows: [],
          missingHeader: !mapping.province ? '省' : '数值'
        });
        return;
      }

      fillColumnSelects(headers);
      els().regionColSelect.value = mapping.province;
      els().valueColSelect.value = mapping.value;
      // City/district selects are hidden in the new strict 4-column layout,
      // but we still keep them updated so existing DOM bindings work.
      els().cityColSelect.value = mapping.city ?? '';
      els().districtColSelect.value = mapping.district ?? '';

      els().fileName.textContent = file.name;
      els().fileMeta.textContent = `${json.length} 行数据`;
      els().fileInfo.hidden = false;
      els().columnMapping.hidden = false;

      reparseColumnMapping();
      els().fileInput.value = '';
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

/** Detect which header column serves which role. Returns null for missing. */
function detectColumnMapping(headers: string[]): Record<ColumnRole, string | null> {
  const out: Record<ColumnRole, string | null> = {
    province: null, city: null, district: null, value: null
  };
  for (const h of headers) {
    const trimmed = h.trim();
    for (const role of Object.keys(COLUMN_PATTERNS) as ColumnRole[]) {
      if (out[role]) continue;
      if (COLUMN_PATTERNS[role].some((re) => re.test(trimmed))) {
        out[role] = h;
      }
    }
  }
  return out;
}

/** Fill the column dropdowns (city/district selects are hidden but kept for layout). */
function fillColumnSelects(headers: string[]): void {
  const allOpts = headers
    .map((h) => `<option value="${escapeAttr(h)}">${escapeHtml(h)}</option>`)
    .join('');
  els().regionColSelect.innerHTML = allOpts;
  els().cityColSelect.innerHTML = allOpts;
  els().districtColSelect.innerHTML = allOpts;
  els().valueColSelect.innerHTML = allOpts;
}

/**
 * Re-parse with the current column mapping. Called automatically on file
 * load and on any select change. Runs strict validation and either applies
 * the data or shows a blocking modal that requires re-upload.
 */
export function reparseColumnMapping(): void {
  const provinceCol = els().regionColSelect.value;
  const cityCol = els().cityColSelect.value;
  const districtCol = els().districtColSelect.value;
  const valueCol = els().valueColSelect.value;
  if (!provinceCol || !valueCol || !state.rawRows) return;

  const parsed: HierarchicalRegion[] = state.rawRows.map((row) => {
    const province = String(row[provinceCol] != null ? row[provinceCol] : '').trim();
    const cityRaw = cityCol ? String(row[cityCol] != null ? row[cityCol] : '').trim() : '';
    const districtRaw = districtCol ? String(row[districtCol] != null ? row[districtCol] : '').trim() : '';
    const rawValue: unknown = row[valueCol];
    let value: number | null = null;
    if (typeof rawValue === 'string') {
      const cleaned = rawValue.replace(/[,，\s%]/g, '');
      const parsed = parseFloat(cleaned);
      value = isNaN(parsed) ? null : parsed;
    } else if (typeof rawValue === 'number' && !isNaN(rawValue)) {
      value = rawValue;
    }
    // 直辖市（省 + 区县、市列留空）合法：将市位归一化为省名，
    // 使落桶 / 上卷 / 表格过滤按标准三级三元组处理（如 北京市|北京市|朝阳区）。
    const isDirectMunicipality =
      province !== '' && cityRaw === '' && districtRaw !== '' && isMunicipality(province);
    return {
      province,
      city: isDirectMunicipality ? province : cityRaw || null,
      district: districtRaw || null,
      value
    } as HierarchicalRegion;
  });

  const issues = validateHierarchicalData(parsed);

  if (issues.hasIssues) {
    showRejectModal(issues);
    return;
  }

  // Validation passed -> apply.
  state.rawData = parsed;
  invalidateAggregation();
  notifyDataApplied();
  setStatus(`数据已绑定到地图（${parsed.length} 行）`, 'ok');
}

/**
 * Strict 4-column validation.
 * Rule summary:
 *   - a city-only row is allowed: the province is auto-filled from the
 *     offline region index; if the lookup fails, the row is rejected
 *   - district without city/province is rejected with a dedicated hint
 *   - if district is non-empty, city must be non-empty (when province is present);
 *     直辖市（北京市/天津市/上海市/重庆市）例外，市列可留空
 *   - a fully empty region (no province/city/district) is rejected
 *   - (province, city, district) tuples must be unique
 *   - value must parse as a number
 */
function validateHierarchicalData(parsed: HierarchicalRegion[]): ParseIssues {
  const issues: ParseIssues = {
    hasIssues: false,
    duplicateHeaders: [],
    emptyRegionRows: 0,
    badValueRows: 0,
    totalRows: parsed.length,
    missingParentRows: [],
    districtOnlyRows: [],
    duplicatePathRows: []
  };

  // Detect duplicate column names (XLSX auto-suffixes them as _1, _2, ...).
  if (state.rawRows.length) {
    const headers = Object.keys(state.rawRows[0]);
    headers.forEach((h) => {
      if (/_\d+$/.test(h)) {
        const base = h.replace(/_\d+$/, '');
        if (!issues.duplicateHeaders.includes(base)) issues.duplicateHeaders.push(base);
      }
    });
  }

  // Auto-fill pass: when only a city name is given, look up and fill the
  // province (mutates parsed so aggregation later just works).
  for (const d of parsed) {
    if (!d.province && d.city) {
      const r = lookupProvinceByCity(d.city);
      if ('province' in r) d.province = r.province;
    }
  }

  const pathSeen = new Map<string, number>();  // "省|市|区" -> 1-based row number
  parsed.forEach((d, idx) => {
    const rowNum = idx + 2; // +1 for 0-index, +1 for header

    // Bad numeric value.
    if (d.value == null) {
      issues.badValueRows++;
    }

    // Filled city but the province could not be auto-filled.
    if (d.city && !d.province) {
      const r = lookupProvinceByCity(d.city);
      const detail =
        r && 'reason' in r && r.reason === 'ambiguous'
          ? `市"${d.city}"对应多个省份，请填写省列`
          : `市"${d.city}"未找到对应省份，请填写省列`;
      issues.missingParentRows.push({ row: rowNum, detail });
    }

    // Filled district only (no province, no city) -> dedicated hint.
    if (d.district && !d.province && !d.city) {
      issues.districtOnlyRows.push({
        row: rowNum,
        detail: `不能单独上传区县"${d.district}"，请同时填写省份和城市`
      });
    }

    // Filled district but no city (province present).
    // 直辖市豁免：省为直辖市时市列留空合法（如 北京市/空/朝阳区），
    // 解析期已将市位归一化为省名，此处仅作防御性兜底。
    if (d.district && !d.city && d.province && !isMunicipality(d.province)) {
      issues.missingParentRows.push({
        row: rowNum,
        detail: `填了区县"${d.district}"但缺少城市`
      });
    }

    // Fully empty region (province, city and district all empty).
    if (!d.province && !d.city && !d.district) {
      issues.emptyRegionRows++;
    }

    // Duplicate path (only meaningful when the row is otherwise valid).
    if (d.province) {
      const key = `${d.province}|${d.city ?? ''}|${d.district ?? ''}`;
      if (pathSeen.has(key)) {
        const pathLabel = [d.province, d.city, d.district].filter(Boolean).join('/');
        issues.duplicatePathRows.push({ path: pathLabel, row: rowNum });
      } else {
        pathSeen.set(key, rowNum);
      }
    }
  });

  issues.hasIssues =
    issues.duplicateHeaders.length > 0 ||
    issues.emptyRegionRows > 0 ||
    issues.badValueRows > 0 ||
    issues.missingParentRows.length > 0 ||
    issues.districtOnlyRows.length > 0 ||
    issues.duplicatePathRows.length > 0;
  return issues;
}

/** Show the validation modal. Rejection only — the user must re-upload. */
function showRejectModal(issues: ParseIssues): void {
  const lines: string[] = [];
  lines.push(`共解析 ${issues.totalRows} 行数据，发现以下问题，需修正后重新上传：`);
  lines.push('');
  if (issues.missingHeader) {
    lines.push(`· 缺少必需的列：${issues.missingHeader}（需要 4 列：省、市、区县、数值）`);
  }
  if (issues.duplicateHeaders.length) {
    lines.push(`· 表头重复：${issues.duplicateHeaders.join('、')}`);
  }
  if (issues.emptyRegionRows > 0) {
    lines.push(`· ${issues.emptyRegionRows} 行区域为空（省份、城市、区县均未填写）`);
  }
  if (issues.badValueRows > 0) {
    lines.push(`· ${issues.badValueRows} 行数值无法解析为数字`);
  }
  if (issues.districtOnlyRows.length > 0) {
    lines.push(`· ${issues.districtOnlyRows.length} 行不能单独上传区县：`);
    issues.districtOnlyRows.slice(0, 10).forEach((m) => {
      lines.push(`    第 ${m.row} 行：${m.detail}`);
    });
    if (issues.districtOnlyRows.length > 10) {
      lines.push(`    ... 还有 ${issues.districtOnlyRows.length - 10} 行`);
    }
  }
  if (issues.missingParentRows.length > 0) {
    lines.push(`· ${issues.missingParentRows.length} 行缺少父级：`);
    issues.missingParentRows.slice(0, 10).forEach((m) => {
      lines.push(`    第 ${m.row} 行：${m.detail}`);
    });
    if (issues.missingParentRows.length > 10) {
      lines.push(`    ... 还有 ${issues.missingParentRows.length - 10} 行`);
    }
  }
  if (issues.duplicatePathRows.length > 0) {
    lines.push(`· ${issues.duplicatePathRows.length} 行存在重复路径：`);
    issues.duplicatePathRows.slice(0, 10).forEach((d) => {
      lines.push(`    第 ${d.row} 行：${d.path} 重复`);
    });
    if (issues.duplicatePathRows.length > 10) {
      lines.push(`    ... 还有 ${issues.duplicatePathRows.length - 10} 行`);
    }
  }

  els().confirmTitle.textContent = '数据校验未通过';
  els().confirmBody.innerHTML = escapeHtml(lines.join('\n')).replace(/\n/g, '<br>');
  els().confirmModal.hidden = false;

  // Wire up a single re-upload button (cancel button is repurposed as
  // "remove current file"). The previous "ignore and continue" option is
  // gone on purpose.
  const okHandler = () => {
    els().confirmModal.hidden = true;
    els().confirmOk.removeEventListener('click', okHandler);
    els().confirmCancel.removeEventListener('click', cancelHandler);
    els().fileInput.click();
  };
  const cancelHandler = () => {
    els().confirmModal.hidden = true;
    els().confirmOk.removeEventListener('click', okHandler);
    els().confirmCancel.removeEventListener('click', cancelHandler);
    removeFile();
  };
  els().confirmOk.textContent = '重新上传';
  els().confirmOk.classList.add('btn-primary');
  els().confirmCancel.textContent = '移除文件';
  els().confirmCancel.classList.add('btn-ghost');
  els().confirmOk.addEventListener('click', okHandler);
  els().confirmCancel.addEventListener('click', cancelHandler);

  setStatus('数据校验未通过，请修正后重新上传', 'error');
}

/** Remove the currently loaded file and reset all related state. */
export function removeFile(): void {
  clearAllData();
  els().fileInput.value = '';
  els().searchInput.value = '';
  els().fileInfo.hidden = true;
  els().columnMapping.hidden = true;
  els().regionColSelect.innerHTML = '';
  els().valueColSelect.innerHTML = '';
  els().cityColSelect.innerHTML = '';
  els().districtColSelect.innerHTML = '';
  notifyDataApplied();
  setStatus('文件已移除', 'info');
}

// Re-export the legacy RegionData so the table/UI imports still compile.
export type { RegionData };
