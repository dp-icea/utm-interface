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
  /** Inherit layers from another scenario (merged by the backend). */
  base_scenario_id?: string | null;
  simulation?: Simulation | null;
}

export type SimKind = "drone" | "helicopter" | "plane";
export type SimPhase = "takeoff" | "cruise" | "landing" | "hold";

export interface SimWaypointLeg {
  type: "waypoint";
  lng?: number;
  lat?: number;
  /** Use the centroid of this feature instead of lng/lat. */
  at_feature?: string;
  height: AltitudeLimit;
  hold_s?: number;
  /** Speed for the segment that ends at this waypoint. */
  speed_mps?: number;
  phase?: SimPhase;
}

export interface SimLawnmowerLeg {
  type: "lawnmower";
  /** Polygon feature id. */
  area: string;
  height: AltitudeLimit;
  spacing_m: number;
  inset_m?: number;
  /** Strip direction; defaults to the polygon's long axis. */
  angle_deg?: number;
  /** Fly only sortie `sortie` (0-based) of `sorties` equal parts. */
  sortie?: number;
  sorties?: number;
  /** Points flown before the first strip and (reversed) after the last one. */
  via?: [number, number][];
}

export interface SimOrbitLeg {
  type: "orbit";
  center: [number, number];
  radius_m: number;
  height: AltitudeLimit;
  turns?: number;
  start_bearing_deg?: number;
  clockwise?: boolean;
}

export type SimLeg = SimWaypointLeg | SimLawnmowerLeg | SimOrbitLeg;

export interface SimEntity {
  id: string;
  kind: SimKind;
  callsign: string;
  color?: string | null;
  speed_mps: number;
  climb_mps?: number | null;
  /** Corner rounding radius (m); default by kind. */
  turn_radius_m?: number | null;
  start_offset_s: number;
  loop: "pingpong" | "cycle";
  route: SimLeg[];
  conformance_volume_ids: string[];
  avoid_layer_ids: string[];
  notes?: string;
}

export interface Simulation {
  entities: SimEntity[];
}

export interface ScenarioSummary {
  id: string;
  name: string;
  description: string;
  created_at: string;
  layer_count: number;
  feature_count: number;
  has_simulation?: boolean;
}
