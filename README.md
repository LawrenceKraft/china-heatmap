# 中国数据热力地图模板

一个通用、可交互的中国热力地图模板，用于统计和展示各省市数据。支持上传 CSV/Excel 数据表格，自动解析并绑定到地图区域，提供全国 - 省市两级下钻、热力颜色渐变、数据筛选排序和图例展示。

## 功能特性

- **数据导入**：拖拽或点击上传 `.csv` / `.xlsx` / `.xls` / `.tsv` 文件，自动解析表格
- **列映射**：自动识别区域列和数值列，支持手动调整下拉选择
- **全国热力图**：展示全国各省数据分布，热力颜色根据数值大小动态渐变
- **三级下钻**：点击省份 → 市级 → 区县，逐级查看数据热力分布，支持逐级返回
- **数据导出**：一键导出当前地图为 PNG 图片、当前数据为 CSV 文件
- **数据表格**：侧边栏展示数据，支持按区域名/数值排序、关键词筛选
- **统计摘要**：实时展示总数、最大值、最小值、平均值
- **交互反馈**：缩放、平移、悬停提示、区域高亮、加载状态、面包屑导航

## 快速开始

### 方式一：一键启动（Windows，推荐）

**双击运行根目录下的 `start.bat`**，脚本会自动：
1. 检测本机可用的运行环境（Python → Node.js）
2. 启动本地 HTTP 服务器（默认端口 8080）
3. 等待服务器就绪后，自动调用系统默认浏览器打开 `http://localhost:8080`

无需手动启动服务器和输入地址，打开即用。

### 方式二：直接双击打开（推荐部署到静态服务器）

由于需要加载在线地图数据和 CDN 库，**建议通过 HTTP 服务器访问**，避免本地 `file://` 跨域问题。

### 方式三：手动使用本地服务器

```bash
# 方法1：使用 Python（推荐）
python -m http.server 8080

# 方法2：使用 Node.js
npx serve .

# 方法3：使用 VS Code Live Server 插件
# 安装 Live Server 插件后，右键 index.html → Open with Live Server
```

然后在浏览器访问 `http://localhost:8080`。

## 使用步骤

1. 打开应用，等待全国地图加载完成
2. 点击左侧"数据导入"区域，上传数据文件（可用 `data/example.csv` 测试）
3. 确认"区域列"和"数值列"选择正确（一般自动识别）
4. 全国地图立即显示各省热力分布
5. 点击地图上的省份可下钻查看市级热力，点击"返回全国"回到全国视图
6. 在"数据表格"中可搜索区域或点击表头排序

## 数据格式要求

| 区域列 | 数值列 |
|--------|--------|
| 广东省 | 135673.16 |
| 江苏省 | 128222.16 |
| 广州市 | 28839.00 |
| 深圳市 | 30664.85 |

- **区域列**：省份全称（如"广东省"）或城市名称（如"广州市"），支持简称容错（"广东"）
- **数值列**：任意数值，支持千分位和百分号格式
- 首行为表头，自动识别区域列和数值列

### 示例数据

- `data/example.csv`：各省 GDP 数据（省级热力示例）
- `data/province_city_data.csv`：**省级 + 市级混合数据**（测试两级下钻）
  - 全国 31 个省级记录 + 广东、江苏、山东、浙江、四川、湖北、湖南 7 省的 105 个市级记录
- `data/province_city_district_data.csv`：**省 + 市 + 区县三级混合数据**（推荐，测试三级下钻）
  - 全国 31 省 + 广东主要 13 市 + 广东 4 市的区县数据（广州 11 区、深圳 9 区、珠海 3 区、佛山 5 区）
  - 上传后依次点击：广东省 → 广州市 → 越秀区，可体验"省→市→区县"完整三级下钻

## 项目结构

```
map/
├── index.html        # 主页面
├── edgeone.json      # EdgeOne Pages 部署配置（发布根目录）
├── start.bat         # 一键启动脚本（Windows：自动开服务器 + 打开浏览器）
├── css/
│   └── style.css     # 样式
├── src/              # TypeScript 源码（编译到 dist/）
├── dist/             # TypeScript 编译产物（ES module，被 index.html 引用）
├── scripts/
│   ├── download-geo.js    # 下载省级地图兜底数据（node scripts/download-geo.js）
│   └── serve-local.mjs    # 本地静态服务器（node scripts/serve-local.mjs [port]）
├── data/
│   ├── example.csv                        # 省级示例数据
│   ├── province_city_data.csv             # 省级+市级示例数据
│   ├── province_city_district_data.csv    # 省+市+区县三级示例数据
│   ├── geo_100000.json                    # 全国地图本地兜底文件
│   └── geo_{adcode}.json                  # 各省（33 个）地图本地兜底文件（如 geo_440000.json 为广东省）
└── README.md
```

## 技术栈

- **地图可视化**：ECharts 5.x（CDN 引入，多源降级加载）
- **地图数据**：阿里云 DataV.GeoAtlas API 动态获取省市县 GeoJSON（无需注册）
  - 全国/省市：`https://geo.datav.aliyun.com/areas_v3/bound/{adcode}_full.json`（如 `440000_full.json` 为广东省、`440100_full.json` 为广州市）
  - 区县：`https://geo.datav.aliyun.com/areas_v3/bound/{adcode}.json`（如 `440104.json` 为越秀区，不带 `_full`）
  - **本地兜底**：网络请求失败时自动回退到 `data/geo_{adcode}.json`，DataV 不可用时仍能显示地图
    - 全国地图：`data/geo_100000.json`
    - 省级地图：`data/geo_{adcode}.json`（内置全部 33 个有下级的省份，下钻省级不依赖网络）
  - 需要更新/补充省级兜底数据时，运行 `node scripts/download-geo.js` 重新下载
- **数据解析**：SheetJS (xlsx)，支持 CSV 和 Excel
- **前端架构**：纯静态 HTML + CSS + TypeScript（编译为 ES Module），零运行时构建依赖

## 部署

纯前端静态应用，可直接部署到任意静态服务器：

- **GitHub Pages / Vercel / Netlify / CloudBase / EdgeOne Pages** 等，直接上传整个项目即可
- 无需后端、无需数据库、无需 API Key

## 常见问题

### 1. 点击省份没有下钻？
确保网络可访问 DataV API（`geo.datav.aliyun.com`），该 API 无需注册、支持跨域。

### 2. 省级下钻后市级数据为灰色？
这是因为上传的数据只有省级数据，没有市级数据。若需查看市级热力，请上传包含市级名称的数据（如"广州市"、"深圳市"）。

### 3. 数值为灰色表示？
灰色表示该区域没有匹配到数据，或数值为空。

## 许可证

MIT
