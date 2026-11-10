export type Datum = "MSL" | "W84" | "AGL";

export type FeatureCategory =
  | "utm_zone"
  | "operation"
  | "contingency"
  | "airport_restriction"
  | "heliport_restriction"
  | "restricted_area"
  | "opea"
  | "reference"
  | "custom";

export interface AltitudeLimit {
  value: number;
  datum: Datum;
}

export type AnalysisGeometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "LineString"; coordinates: [number, number][] }
  | { type: "Polygon"; coordinates: [number, number][][] }
  | { type: "MultiPolygon"; coordinates: [number, number][][][] };

export interface AnalysisFeatureProperties {
  name: string;
  category: FeatureCategory;
  lower: AltitudeLimit | null;
  upper: AltitudeLimit | null;
  radius_m: number | null;
  color: string | null;
  source: string | null;
  attributes: Record<string, string>;
  warnings: string[];
  notes: string;
}

export interface AnalysisFeature {
  type: "Feature";
  id: string;
  geometry: AnalysisGeometry;
  properties: AnalysisFeatureProperties;
}

export interface AnalysisLayer {
  id: string;
  name: string;
  visible: boolean;
  features: AnalysisFeature[];
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  geoid_undulation_m: number | null;
  created_at: string;
  layers: AnalysisLayer[];
}

export interface ScenarioSummary {
  id: string;
  name: string;
  description: string;
  created_at: string;
  layer_count: number;
  feature_count: number;
}
