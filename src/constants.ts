/**
 * Application constants and configuration.
 * Kept separate so all modules can reference them without circular deps.
 */
import { normalizeRegionName } from './utils.js';

/** Base URL for the DataV GeoAtlas API. */
export const DATAV_BASE = 'https://geo.datav.aliyun.com/areas_v3/bound';

/** Adcode for the whole country map. */
export const COUNTRY_ADCODE = '100000';

/** Display name for the whole country view. */
export const NATION_NAME = '全国';

/** Map data request timeout (ms) to avoid infinite loading. */
export const FETCH_TIMEOUT = 1500;

/**
 * Drill-down depth: 0=country(province borders) 1=province(city borders)
 * 2=city(district borders) 3=district.
 * Note: DataV exposes province/city via _full.json and district via .json;
 * fetchGeoJson automatically falls back between the two formats.
 */
export const MAX_LEVEL = 3;

/** Human-readable labels per drill level. */
export const LEVEL_NAMES: Record<number, string> = {
  0: '全国',
  1: '省份',
  2: '地市',
  3: '区县'
};

/**
 * 直辖市（省级，无市级层）：填写时"省 + 区县、市列留空"为合法形态。
 * 以归一化名称（去除 省/市 等后缀）作为成员，如 北京/天津/上海/重庆。
 */
export const MUNICIPALITIES: ReadonlySet<string> = new Set(['北京', '天津', '上海', '重庆']);

/** 判断省级名称是否为直辖市（容忍后缀差异：北京 与 北京市 均判定为直辖市）。 */
export function isMunicipality(province: string | null | undefined): boolean {
  if (!province) return false;
  return MUNICIPALITIES.has(normalizeRegionName(province));
}

/** Heat gradient colors (light blue -> mid blue -> deep blue -> orange-red). */
export const HEAT_COLORS = ['#e0f3f8', '#abd9e9', '#74add1', '#4575b4', '#d73027', '#7f0000'];

/** Color for regions without data. */
export const NO_DATA_COLOR = '#2a3f5c';

/** Table row height (px), used for consistent row sizing. */
export const ROW_HEIGHT = 33;

/** Supported file extensions for upload. */
export const SUPPORTED_EXTENSIONS = ['csv', 'xlsx', 'xls', 'tsv'];

/** Required column role for the 4-column hierarchy file. */
export type ColumnRole = 'province' | 'city' | 'district' | 'value';

/**
 * Recognized header names per role. Matching is case-insensitive and tolerant
 * of common variants (省/省份/Province, 市/城市/City, 区/区县/District, 数值/Value/指标).
 * Used by the parser to auto-detect the column mapping without forcing the
 * user to manually select every column.
 */
export const COLUMN_PATTERNS: Record<ColumnRole, RegExp[]> = {
  province: [/^省(份)?$/, /^province$/i, /^行政区?$/],
  city: [/^(地?级?市|市|城市)$/, /^city$/i, /^地市$/],
  district: [/^(区|县|区?县|市辖区)$/, /^district$/i, /^county$/i, /^区县级?$/],
  value: [/^(数?值?|指标|数据|value)$/i, /^gdp$/i, /^人口$/, /^数量$/]
};
