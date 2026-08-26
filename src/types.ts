/**
 * Type definitions for the China Heatmap application.
 * All shared types live here to avoid circular imports.
 */

/** A single parsed data row: region name + numeric value. */
export interface RegionData {
  region: string;
  value: number | null;
}

/** Current map view: level (0=country, 1=province, 2=city, 3=district), adcode, name. */
export interface ViewState {
  level: number;
  adcode: string;
  name: string;
}

/** Navigation stack item (same shape as ViewState). */
export type NavItem = ViewState;

/** GeoJSON feature properties provided by DataV. */
export interface GeoFeatureProperties {
  name: string;
  adcode?: number | string;
  adcode_new?: number | string;
  level?: string;
  childrenNum?: number;
}

/** A single GeoJSON feature. */
export interface GeoFeature {
  type: string;
  properties: GeoFeatureProperties;
  geometry?: {
    type: string;
    coordinates: unknown;
  } | null;
}

/** GeoJSON FeatureCollection. */
export interface GeoJson {
  type: string;
  features: GeoFeature[];
}

/** Sort state for the data table. */
export interface SortState {
  key: 'region' | 'value' | null;
  dir: 'asc' | 'desc';
}

/** Issues detected during data validation. */
export interface ParseIssues {
  hasIssues: boolean;
  duplicateHeaders: string[];
  emptyRegionRows: number;
  badValueRows: number;
  unknownRegionRows: number;
  totalRows: number;
  sampleUnknown: string[];
}

/** A single row parsed from the uploaded file (raw row). */
export type RawRow = Record<string, unknown>;

/** Map used to look up a region's value by its (normalized) name. */
export type RegionValueMap = Map<string, number | null>;
