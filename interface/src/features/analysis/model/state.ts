import { createContext } from "react";
import type {
  AnalysisFeature,
  AnalysisFeatureProperties,
  Scenario,
  ScenarioSummary,
} from "@/shared/model";

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
  setFlyToHandler: (handler: ((featureId: string) => void) | null) => void;
}

export const AnalysisContext = createContext<AnalysisState | undefined>(undefined);
