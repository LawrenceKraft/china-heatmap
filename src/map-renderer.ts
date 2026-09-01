/**
 * ECharts map rendering: heat colors, tooltip, visualMap.
 *
 * Value lookup is delegated to data-store's getRegionValueForCurrentView,
 * which picks the right level-aggregated map based on currentView.level and
 * the current hierarchy path. See data-store.ts for the parent-wins rollup
 * rules.
 */
import { getEls } from './ui.js';
import { state, getRegionValueForCurrentView, rebuildAggregatedCache } from './data-store.js';
import { HEAT_COLORS, NO_DATA_COLOR } from './constants.js';

const els = () => getEls();

/** Map border color, faded in after the entrance scale/fade animation. */
const BORDER_COLOR = '#4a617e';
/** Entrance animation length, matched by the border-reveal delay. */
const ENTRANCE_MS = 350;
/** Pending border-reveal timer, cleared on every render to avoid races. */
let entranceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 计算色阶区间。当有效值只有一个（min === max）时，区间退化为零，
 * ECharts 连续型 visualMap 会把所有区域（含无数据区域）压到同一端，
 * 产生全图同色（全蓝）。此时下移下界，使唯一有效值落在渐变高端（红），
 * 无数据区域保持 NO_DATA_COLOR。
 */
function resolveVisualRange(validValues: number[]): { min: number; max: number } {
  if (validValues.length === 0) return { min: 0, max: 100 };
  const min = Math.min(...validValues);
  const max = Math.max(...validValues);
  if (min === max) {
    return { min: max - Math.max(Math.abs(max) * 0.1, 1), max };
  }
  return { min, max };
}

/**
 * Render the heat map for a given registered map name and GeoJSON.
 *
 * `entrance` (default true) plays a 350ms scale+fade-in with a border-reveal;
 * data refreshes on an already-visible map should pass false so the map only
 * does a short color transition instead of replaying the entrance.
 */
export function renderChart(mapName: string, geoJson: unknown, level: number, entrance = true): void {
  // A fresh render supersedes any pending border-reveal from a previous one
  // (rapid drilldown would otherwise reveal borders on the wrong chart).
  if (entranceTimer !== null) {
    clearTimeout(entranceTimer);
    entranceTimer = null;
  }

  const features = (geoJson as { features: { properties: { name: string } }[] }).features;
  // Ensure the aggregated value maps are up to date for the current rawData.
  // Must run synchronously — otherwise features.map() below will query the
  // empty maps and return null for every region, producing an all-gray map.
  if (!state.aggValid) {
    rebuildAggregatedCache();
  }

  const data = features.map((f) => {
    const name = f.properties.name;
    const value = getRegionValueForCurrentView(name);
    return { name, value: value != null ? value : null };
  });

  const validValues = data.map((d) => d.value).filter((v) => v != null) as number[];
  const { min, max } = resolveVisualRange(validValues);

  const option = {
    animation: true,
    animationDuration: ENTRANCE_MS,
    animationDurationUpdate: 250,
    animationEasing: 'cubicOut',
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(255,255,255,0.95)',
      borderColor: '#ddd',
      borderWidth: 1,
      textStyle: { color: '#333', fontSize: 13 },
      formatter: (params: { name?: string; value?: unknown }) => {
        const name = params.name || '';
        const value = params.value;
        const valStr = value != null && !isNaN(Number(value)) ? Number(value).toLocaleString() : '无数据';
        return `<div style="font-weight:600;font-size:14px;margin-bottom:4px;color:#1b3047">${name}</div>
                <div style="color:#666">数值：<b style="color:#d73027">${valStr}</b></div>`;
      }
    },
    visualMap: {
      type: 'continuous',
      min,
      max,
      left: 24,
      bottom: 24,
      calculable: true,
      text: ['高', '低'],
      textStyle: { color: '#93a7bd' },
      inRange: { color: HEAT_COLORS },
      outOfRange: { color: NO_DATA_COLOR },
      itemWidth: 14,
      itemHeight: 120
    },
    series: [{
      name: '热力数据',
      type: 'map',
      map: mapName,
      roam: true,
      zoom: 1.1,
      // Entrance: scale 0.75 -> 1 while fading in (ECharts animates opacity
      // together with the scale for the initial render).
      animationType: entrance ? 'scale' : 'expansion',
      emphasis: {
        label: {
          show: true,
          fontSize: 12,
          color: '#fff',
          fontWeight: 'bold',
          textShadowBlur: 6,
          textShadowColor: 'rgba(0,5,0,0.5)'
        },
        itemStyle: {
          areaColor: '#4fa3ff',
          borderColor: '#fff',
          borderWidth: 1.5,
          shadowBlur: 12,
          shadowColor: 'rgba(79,163,255,0.6)'
        }
      },
      label: {
        show: true,
        fontSize: 10,
        color: '#c7d5e4'
      },
      itemStyle: {
        // Entrance keeps borders transparent so they "draw in" afterwards.
        borderColor: entrance ? 'transparent' : BORDER_COLOR,
        borderWidth: 0.6,
        areaColor: NO_DATA_COLOR
      },
      select: {
        disabled: true
      },
      data
    }]
  };

  const inst = window.echarts.getInstanceByDom(els().chart);
  // notMerge=true for a fresh entrance (replays scale/fade); merge mode for a
  // data refresh so only the colors transition via animationDurationUpdate.
  inst?.setOption(option, entrance);

  // Border reveal: after the scale/fade entrance, fade the boundaries in to
  // mimic the outline being drawn.
  if (entrance) {
    entranceTimer = setTimeout(() => {
      entranceTimer = null;
      inst?.setOption({ series: [{ itemStyle: { borderColor: BORDER_COLOR } }] });
    }, ENTRANCE_MS);
  }
}

/** Re-render the map using cached GeoJSON for the current view. */
export function updateMap(): void {
  const geoJson = state.geoCache.get(state.currentView.adcode);
  if (geoJson) {
    renderChart('map_' + state.currentView.adcode, geoJson, state.currentView.level, false);
  }
}
