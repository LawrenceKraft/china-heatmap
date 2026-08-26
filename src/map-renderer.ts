/**
 * ECharts map rendering: heat colors, tooltip, visualMap.
 */
import { getEls } from './ui.js';
import { state, buildRegionValueMap, getRegionValue } from './data-store.js';
import { HEAT_COLORS, NO_DATA_COLOR } from './constants.js';

const els = () => getEls();

/** Render the heat map for a given registered map name and GeoJSON. */
export function renderChart(mapName: string, geoJson: unknown, level: number): void {
  const features = (geoJson as { features: { properties: { name: string } }[] }).features;
  buildRegionValueMap();

  const data = features.map((f) => {
    const name = f.properties.name;
    const value = getRegionValue(name);
    return { name, value: value != null ? value : null };
  });

  const validValues = data.map((d) => d.value).filter((v) => v != null) as number[];
  const min = validValues.length ? Math.min(...validValues) : 0;
  const max = validValues.length ? Math.max(...validValues) : 100;

  const option = {
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
      emphasis: {
        label: {
          show: true,
          fontSize: 12,
          color: '#fff',
          fontWeight: 'bold',
          textShadowBlur: 6,
          textShadowColor: 'rgba(0,0,0,0.5)'
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
        borderColor: '#4a617e',
        borderWidth: 0.6,
        areaColor: NO_DATA_COLOR
      },
      select: {
        disabled: true
      },
      data
    }]
  };

  window.echarts.getInstanceByDom(els().chart)?.setOption(option, true);
}

/** Re-render the map using cached GeoJSON for the current view. */
export function updateMap(): void {
  const geoJson = state.geoCache.get(state.currentView.adcode);
  if (geoJson) {
    renderChart('map_' + state.currentView.adcode, geoJson, state.currentView.level);
  }
}
