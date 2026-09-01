/**
 * Central DOM element references.
 * All modules import `els` from here to avoid duplicate lookups.
 */

export interface DomElements {
  uploadZone: HTMLElement;
  fileInput: HTMLInputElement;
  btnDownloadTemplate: HTMLButtonElement;
  fileInfo: HTMLElement;
  fileName: HTMLElement;
  fileMeta: HTMLElement;
  removeFile: HTMLElement;
  columnMapping: HTMLElement;
  regionColSelect: HTMLSelectElement;
  cityColSelect: HTMLSelectElement;
  districtColSelect: HTMLSelectElement;
  valueColSelect: HTMLSelectElement;
  searchInput: HTMLInputElement;
  btnSearch: HTMLButtonElement;
  searchSuggest: HTMLElement;
  dataTable: HTMLElement;
  tableBody: HTMLElement;
  tableEmpty: HTMLElement;
  tableFooter: HTMLElement;
  tableSummary: HTMLElement;
  statTotal: HTMLElement;
  statMax: HTMLElement;
  statMin: HTMLElement;
  statAvg: HTMLElement;
  breadcrumb: HTMLElement;
  btnBack: HTMLButtonElement;
  btnExportPng: HTMLButtonElement;
  btnExportCsv: HTMLButtonElement;
  sidebarBarPanel: HTMLElement;
  sidebarBarBody: HTMLElement;
  chart: HTMLElement;
  chartOverlay: HTMLElement;
  overlayText: HTMLElement;
  statusText: HTMLElement;
  statusDot: HTMLElement;
  btnRetry: HTMLButtonElement;
  confirmModal: HTMLElement;
  confirmTitle: HTMLElement;
  confirmBody: HTMLElement;
  confirmCancel: HTMLButtonElement;
  confirmOk: HTMLButtonElement;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}

/** Build and return all DOM references used by the app. */
export function initEls(): DomElements {
  return {
    uploadZone: byId<HTMLElement>('uploadZone'),
    fileInput: byId<HTMLInputElement>('fileInput'),
    btnDownloadTemplate: byId<HTMLButtonElement>('btnDownloadTemplate'),
    fileInfo: byId<HTMLElement>('fileInfo'),
    fileName: byId<HTMLElement>('fileName'),
    fileMeta: byId<HTMLElement>('fileMeta'),
    removeFile: byId<HTMLElement>('removeFile'),
    columnMapping: byId<HTMLElement>('columnMapping'),
    regionColSelect: byId<HTMLSelectElement>('regionColSelect'),
    cityColSelect: byId<HTMLSelectElement>('cityColSelect'),
    districtColSelect: byId<HTMLSelectElement>('districtColSelect'),
    valueColSelect: byId<HTMLSelectElement>('valueColSelect'),
    searchInput: byId<HTMLInputElement>('searchInput'),
    btnSearch: byId<HTMLButtonElement>('btnSearch'),
    searchSuggest: byId<HTMLElement>('searchSuggest'),
    dataTable: byId<HTMLElement>('dataTable'),
    tableBody: byId<HTMLElement>('tableBody'),
    tableEmpty: byId<HTMLElement>('tableEmpty'),
    tableFooter: byId<HTMLElement>('tableFooter'),
    tableSummary: byId<HTMLElement>('tableSummary'),
    statTotal: byId<HTMLElement>('statTotal'),
    statMax: byId<HTMLElement>('statMax'),
    statMin: byId<HTMLElement>('statMin'),
    statAvg: byId<HTMLElement>('statAvg'),
    breadcrumb: byId<HTMLElement>('breadcrumb'),
    btnBack: byId<HTMLButtonElement>('btnBack'),
    btnExportPng: byId<HTMLButtonElement>('btnExportPng'),
    btnExportCsv: byId<HTMLButtonElement>('btnExportCsv'),
    sidebarBarPanel: byId<HTMLElement>('sidebarBarPanel'),
    sidebarBarBody: byId<HTMLElement>('sidebarBarBody'),
    chart: byId<HTMLElement>('chart'),
    chartOverlay: byId<HTMLElement>('chartOverlay'),
    overlayText: byId<HTMLElement>('overlayText'),
    statusText: byId<HTMLElement>('statusText'),
    statusDot: document.querySelector('.status-dot') as HTMLElement,
    btnRetry: byId<HTMLButtonElement>('btnRetry'),
    confirmModal: byId<HTMLElement>('confirmModal'),
    confirmTitle: byId<HTMLElement>('confirmTitle'),
    confirmBody: byId<HTMLElement>('confirmBody'),
    confirmCancel: byId<HTMLButtonElement>('confirmCancel'),
    confirmOk: byId<HTMLButtonElement>('confirmOk')
  };
}
