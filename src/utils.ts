/**
 * Shared utility functions.
 */

/** Debounce a function so it only runs after a quiet period. */
export function debounce<T extends (...args: never[]) => void>(fn: T, delay: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/** Escape a string for safe insertion into HTML body content. */
export function escapeHtml(str: unknown): string {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Escape a string for safe use inside an HTML attribute value (value="..."). */
export function escapeAttr(str: unknown): string {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Normalize a region name by stripping administrative suffixes
 * so "广东" matches "广东省", "广州" matches "广州市", etc.
 */
export function normalizeRegionName(name: unknown): string {
  if (name == null) return '';
  return String(name).replace(
    /省|市|自治区|特别行政区|回族|壮族|维吾尔|彝族|土家族|苗族|布依族|侗族|瑶族|白族|哈尼族|哈萨克族|傣族|黎族|傈僳族|佤族|畲族|高山族|拉祜族|水族|东乡族|纳西族|景颇族|柯尔克孜族|土族|达斡尔族|仫佬族|羌族|布朗族|撒拉族|毛南族|仡佬族|锡伯族|阿昌族|普米族|朝鲜族|怒族|鄂温克族|鄂伦春族|赫哲族|门巴族|珞巴族|塔吉克族|乌孜别克族|俄罗斯族|裕固族|京族|塔塔尔族|独龙族/g,
    ''
  );
}

/** Escape a value for CSV output: wrap in quotes if it contains separators. */
export function csvEscape(val: unknown): string {
  if (val == null) return '';
  const s = String(val);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
