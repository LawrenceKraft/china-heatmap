/**
 * Generate offline template artifacts for the data import feature:
 *   1. data/region-index.json          - province/city index used by the front-end
 *                                        to auto-fill province from a city name.
 *   2. data/热力地图数据模板.xlsx         - Excel template with cascading dropdowns
 *                                        (province list -> city list via INDIRECT),
 *                                        free input for district/value columns.
 *
 * Reads the local GeoJSON fallback files in data/ (geo_100000.json + geo_<adcode>.json),
 * so the generated data is always in sync with what the heatmap can actually render.
 *
 * Usage: node scripts/gen-template.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');

const COUNTRY_FILE = join(DATA_DIR, 'geo_100000.json');
const OUT_INDEX = join(DATA_DIR, 'region-index.json');
const OUT_XLSX = join(DATA_DIR, '热力地图数据模板.xlsx');

/** Number of template rows (row 2..TEMPLATE_ROWS+1) that get dropdown validations. */
const TEMPLATE_ROWS = 500;

/** 表头（与前端 COLUMN_PATTERNS 识别保持一致） */
const HEADERS = ['省', '市', '区县', '数值'];
/**
 * 预置示例行（帮助用户理解填写规则，可自行删除）。
 * 覆盖四级填写形态，数值分散以演示渐变色阶：
 *   1. 省 + 市 + 区县（三级）      如 广东省/广州市/天河区
 *   2. 省 + 市（二级）            如 浙江省/杭州市
 *   3. 直辖市 省 + 区县（市留空）  如 北京市/空/朝阳区
 *   4. 仅省（一级）               如 湖北省
 */
const SAMPLE_ROWS = [
  // 省 + 市 + 区县（三级）
  ['广东省', '广州市', '天河区', 320],
  ['广东省', '深圳市', '南山区', 295],
  // 省 + 市（二级）
  ['广东省', '珠海市', null, 180],
  ['浙江省', '杭州市', null, 260],
  ['江苏省', '南京市', null, 240],
  ['四川省', '成都市', null, 210],
  ['福建省', '厦门市', null, 225],
  ['山东省', '青岛市', null, 235],
  // 直辖市（省 + 区县，市列留空）
  ['北京市', null, '朝阳区', 300],
  ['北京市', null, '海淀区', 265],
  ['上海市', null, '浦东新区', 350],
  ['重庆市', null, '渝中区', 170],
  // 仅省（一级）
  ['湖北省', null, null, 150],
  ['云南省', null, null, 130],
];

function loadProvinces() {
  if (!existsSync(COUNTRY_FILE)) {
    console.error(`Missing country map: ${COUNTRY_FILE}`);
    process.exit(1);
  }
  const country = JSON.parse(readFileSync(COUNTRY_FILE, 'utf8'));
  const provinces = [];
  for (const f of country.features || []) {
    const p = f && f.properties;
    if (!p || !p.name || !/^\d{6}$/.test(String(p.adcode))) continue; // 排除 100000_JD 等虚拟 feature
    const adcode = Number(p.adcode);
    let cities = [];
    const fp = join(DATA_DIR, `geo_${adcode}.json`);
    if (existsSync(fp)) {
      const geo = JSON.parse(readFileSync(fp, 'utf8'));
      // 直辖市 / 特别行政区为 district 级（无市级层），仅收集 level==='city' 的市级名称
      cities = (geo.features || [])
        .filter((x) => x && x.properties && x.properties.level === 'city' && x.properties.name)
        .map((x) => x.properties.name);
    }
    provinces.push({ name: p.name, adcode, cities });
  }
  provinces.sort((a, b) => a.adcode - b.adcode);
  return provinces;
}

function writeRegionIndex(provinces) {
  const cityIndex = [];
  for (const p of provinces) {
    for (const city of p.cities) {
      cityIndex.push({ city, province: p.name });
    }
  }
  const index = {
    provinceIndex: provinces.map(({ name, adcode, cities }) => ({ name, adcode, cities })),
    cityIndex,
  };
  writeFileSync(OUT_INDEX, JSON.stringify(index, null, 2), 'utf8');
  console.log(`[ok] ${OUT_INDEX} (${(Buffer.byteLength(JSON.stringify(index)) / 1024).toFixed(1)}KB, ${provinces.length} provinces, ${cityIndex.length} cities)`);
}

function colName(index) {
  let n = index;
  let s = '';
  while (n > 0) {
    n -= 1;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

async function writeTemplateXlsx(provinces) {
  const wb = new ExcelJS.Workbook();
  const dataWs = wb.addWorksheet('数据', { views: [{ state: 'frozen', ySplit: 1 }] });
  const optWs = wb.addWorksheet('选项');
  optWs.state = 'hidden'; // 隐藏选项页，避免用户误改

  // ---- 数据页：表头 ----
  const headerCells = [];
  HEADERS.forEach((h, i) => {
    const cell = dataWs.getCell(1, i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B4A5A' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
    headerCells.push(cell);
  });
  dataWs.getRow(1).height = 22;

  // ---- 数据页：示例行 ----
  SAMPLE_ROWS.forEach((row, ri) => {
    const r = 2 + ri;
    row.forEach((v, ci) => {
      const cell = dataWs.getCell(r, ci + 1);
      cell.value = v;
      cell.font = { color: { argb: 'FF888888' }, italic: true };
    });
  });

  // ---- 数据页：省市联动下拉（行 2..TEMPLATE_ROWS+1）----
  // 省列：一次性写入范围地址（优化器会原样保留，避免逐格设置时字符串排序导致重叠合并）
  dataWs.dataValidations.add(`A2:A${TEMPLATE_ROWS + 1}`, {
    type: 'list',
    formulae: ['省份列表'],
    allowBlank: true,
    showErrorMessage: false,
  });
  // 市列：公式含行号（INDIRECT($Ax)），必须逐行写入
  for (let r = 2; r <= TEMPLATE_ROWS + 1; r++) {
    dataWs.dataValidations.add(`B${r}`, {
      type: 'list',
      formulae: [`INDIRECT($A${r})`],
      allowBlank: true,
      showErrorMessage: false,
    });
  }

  // 列宽
  dataWs.getColumn(1).width = 18;
  dataWs.getColumn(2).width = 18;
  dataWs.getColumn(3).width = 18;
  dataWs.getColumn(4).width = 12;

  // ---- 选项页：A 列省份列表 ----
  optWs.getCell('A1').value = '省份列表';
  optWs.getCell('A1').font = { bold: true };
  provinces.forEach((p, i) => {
    optWs.getCell(i + 2, 1).value = p.name;
  });
  wb.definedNames.add(`'选项'!$A$2:$A$${provinces.length + 1}`, '省份列表');

  // ---- 选项页：B 列起每省一列市列表 + 命名区域（供 INDIRECT 联动）----
  let col = 1; // A 已占用，从 B 开始
  for (const p of provinces) {
    if (p.cities.length === 0) continue; // 无市级的省份不建下拉
    col += 1;
    const cn = colName(col);
    optWs.getCell(1, col).value = p.name;
    optWs.getCell(1, col).font = { bold: true };
    p.cities.forEach((c, i) => {
      optWs.getCell(i + 2, col).value = c;
    });
    wb.definedNames.add(`'选项'!${cn}$2:${cn}$${p.cities.length + 1}`, p.name);
  }

  await wb.xlsx.writeFile(OUT_XLSX);
  console.log(`[ok] ${OUT_XLSX}`);
}

async function main() {
  const provinces = loadProvinces();
  console.log(`Loaded ${provinces.length} provinces from GeoJSON data.`);
  const withCities = provinces.filter((p) => p.cities.length > 0);
  console.log(`  - ${withCities.length} provinces with city list, ${provinces.length - withCities.length} without (direct municipalities / no file).`);

  writeRegionIndex(provinces);
  await writeTemplateXlsx(provinces);
  console.log('\nDone. Re-run this script any time the GeoJSON data is refreshed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
