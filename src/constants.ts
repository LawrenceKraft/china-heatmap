/**
 * Application constants and configuration.
 * Kept separate so all modules can reference them without circular deps.
 */

/** Base URL for the DataV GeoAtlas API. */
export const DATAV_BASE = 'https://geo.datav.aliyun.com/areas_v3/bound';

/** Adcode for the whole country map. */
export const COUNTRY_ADCODE = '100000';

/** Display name for the whole country view. */
export const NATION_NAME = '全国';

/** Map data request timeout (ms) to avoid infinite loading. */
export const FETCH_TIMEOUT = 15000;

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

/** Heat gradient colors (light blue -> mid blue -> deep blue -> orange-red). */
export const HEAT_COLORS = ['#e0f3f8', '#abd9e9', '#74add1', '#4575b4', '#d73027', '#7f0000'];

/** Color for regions without data. */
export const NO_DATA_COLOR = '#2a3f5c';

/** Table virtual-scroll row height (px). */
export const ROW_HEIGHT = 33;

/** Extra rows rendered above/below the viewport for smooth scrolling. */
export const RENDER_BUFFER = 5;

/** Supported file extensions for upload. */
export const SUPPORTED_EXTENSIONS = ['csv', 'xlsx', 'xls', 'tsv'];
