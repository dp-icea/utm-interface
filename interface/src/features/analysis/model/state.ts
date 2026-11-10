import { createContext } from "react";
import type {
  AnalysisFeature,
  AnalysisFeatureProperties,
  Scenario,
  ScenarioSummary,
} from "@/shared/model";

export type BaseScene = "terrain" | "osm" | "google";

export interface ProbeReading {
  lng: number;
  lat: number;
  /** Height of whatever is under the cursor (3D tiles, volume or terrain), W84. */
  surfaceW84: number | undefined;
  /** Bare terrain height, W84. */
  terrainW84: number | undefined;
  /** true when terrainW84 comes from a full-resolution sample (click). */
  precise: boolean;
  pinned: boolean;
}

export type ToolMode = "none" | "measure";

/** A 3D point: [lng, lat, heightW84]. */
export type Point3 = [number, number, number];

export interface Measurement {
  a: Point3;
  b: Point3;
}

/** Closest-approach line shown on the map for a clearance row. */
export interface ClearanceHighlight {
  a: Point3;
  b: Point3;
  label: string;
  conflict: boolean;
}

export interface ResolvedLimits {
  lowerW84: number;
  upperW84: number;
}

export interface OpeaFilter {
  /** aixm_code values to hide. */
  hiddenTypes: string[];
  /** Hide obstacles shorter than this (m). */
  minHeight: number;
}

export interface AnalysisState {
  summaries: ScenarioSummary[];
  scenario: Scenario | null;
  dirty: boolean;
  loading: boolean;
  importWarnings: string[];
  selectedFeatureId: string | null;
  opeaFilter: OpeaFilter;

  refreshList: () => Promise<void>;
  loadScenario: (id: string | null) => Promise<void>;
  importFile: (file: File, followLinks?: boolean) => Promise<void>;
  save: () => Promise<void>;
  selectFeature: (id: string | null) => void;
  toggleLayer: (layerId: string) => void;
  setGeoidUndulation: (value: number | null) => void;
  updateFeature: (featureId: string, patch: Partial<AnalysisFeatureProperties>) => void;
  setOpeaFilter: (filter: OpeaFilter) => void;
  findFeature: (id: string) => { feature: AnalysisFeature; layerId: string } | undefined;
  flyTo: (featureId: string) => void;
  baseScene: BaseScene;
  setBaseScene: (scene: BaseScene) => void;
  probeEnabled: boolean;
  setProbeEnabled: (enabled: boolean) => void;
  probe: ProbeReading | null;
  setProbe: (reading: ProbeReading | null) => void;
  setFlyToHandler: (handler: ((featureId: string) => void) | null) => void;

  removeFeature: (featureId: string) => void;
  toolMode: ToolMode;
  setToolMode: (mode: ToolMode) => void;
  measurement: Measurement | null;
  setMeasurement: (m: Measurement | null) => void;
  clearanceHighlight: ClearanceHighlight | null;
  setClearanceHighlight: (h: ClearanceHighlight | null) => void;
  /** Rendered W84 limits of a feature (uses the renderer's terrain cache). */
  resolveLimits: (featureId: string) => ResolvedLimits | undefined;
  /** Bumped whenever rendered limits may have changed (terrain samples). */
  limitsVersion: number;
  bumpLimitsVersion: () => void;
  setResolver: (resolver: ((featureId: string) => ResolvedLimits | undefined) | null) => void;
}

export const AnalysisContext = createContext<AnalysisState | undefined>(undefined);
