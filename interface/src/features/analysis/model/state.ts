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
}

export const AnalysisContext = createContext<AnalysisState | undefined>(undefined);
