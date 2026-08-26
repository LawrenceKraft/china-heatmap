/**
 * Global ambient declarations for libraries loaded via CDN
 * (echarts and xlsx), so TypeScript can type them without npm installs.
 */

interface EChartsOption {
  [key: string]: unknown;
}

interface EChartsInstance {
  init(dom: HTMLElement, theme?: unknown): EChartsInstance;
  setOption(option: unknown, notMerge?: boolean): void;
  getOption(): EChartsOption;
  resize(): void;
  clear(): void;
  on(eventName: string, handler: (params: unknown) => void): void;
  dispatchAction(action: unknown): void;
  getDataURL(opts?: { type?: string; pixelRatio?: number; backgroundColor?: string }): string;
  showLoading(opts?: unknown): void;
  hideLoading(): void;
  convertToPixel(finder: unknown, value: unknown): number[] | null;
}

interface EChartsStatic {
  init(dom: HTMLElement, theme?: unknown): EChartsInstance;
  getInstanceByDom(dom: HTMLElement): EChartsInstance | undefined;
  registerMap(name: string, geoJson: unknown): void;
}

interface Sheet {
  [key: string]: unknown;
}

interface WorkBook {
  SheetNames: string[];
  Sheets: Record<string, Sheet>;
}

interface XLSXStatic {
  read(data: unknown, opts?: unknown): WorkBook;
  utils: {
    sheet_to_json(sheet: Sheet, opts?: unknown): Record<string, unknown>[];
  };
}

interface Window {
  echarts: EChartsStatic;
  XLSX: XLSXStatic;
}
