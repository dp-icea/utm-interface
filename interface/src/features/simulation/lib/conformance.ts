import type { AnalysisFeature, Scenario, SimEntity } from "@/shared/model";
import { toW84 } from "@/features/analysis/lib/altitude";
import { LocalProjection, type XY } from "@/features/analysis/lib/geometry";
import type { Sample } from "./route";

/** Horizontal slack for drones: shared borders and touching corners count as inside. */
const DRONE_TOLERANCE_M = 3;
const VERTICAL_TOLERANCE_M = 1;

interface Volume {
  feature: AnalysisFeature;
  layerId: string;
  rings: XY[][];
}

export interface ConformanceStatus {
  ok: boolean;
  /** Human-readable reason when not ok. */
  reason: string | null;
  /** Names of the volumes the aircraft is currently inside (3D). */
  inside: string[];
}

function pointInRing([px, py]: XY, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToRing([px, py]: XY, ring: XY[]): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j];
    const [bx, by] = ring[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(px - (ax + dx * t), py - (ay + dy * t)));
  }
  return best;
}

export class ConformanceChecker {
  private proj: LocalProjection;
  private volumes = new Map<string, Volume>();
  private geoid: number;

  constructor(scenario: Scenario) {
    this.geoid = scenario.geoid_undulation_m ?? 0;
    const all = scenario.layers.flatMap((l) => l.features.map((f) => [l.id, f] as const));
    const first = all.find(([, f]) => f.geometry.type === "Polygon")?.[1];
    const origin = first?.geometry.type === "Polygon" ? first.geometry.coordinates[0][0] : [0, 0];
    this.proj = new LocalProjection(origin[0], origin[1]);
    for (const [layerId, f] of all) {
      if (f.properties.category === "opea" || !f.properties.upper) continue;
      const g = f.geometry;
      const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : null;
      if (!polys) continue;
      this.volumes.set(f.id, { feature: f, layerId, rings: polys.map((p) => p[0].map((c) => this.proj.toXY(c))) });
    }
  }

  private contains(v: Volume, s: Sample, tolerance: number): boolean {
    const p = this.proj.toXY([s.lng, s.lat]);
    const horiz = v.rings.some((r) => pointInRing(p, r) || (tolerance > 0 && distToRing(p, r) <= tolerance));
    if (!horiz) return false;
    const ctx = { terrainW84: s.ground, geoidUndulation: this.geoid };
    const { lower, upper } = v.feature.properties;
    const lo = lower ? toW84(lower, ctx) ?? s.ground : s.ground;
    const hi = upper ? toW84(upper, ctx) ?? Infinity : Infinity;
    const tol = tolerance > 0 ? VERTICAL_TOLERANCE_M : 0;
    return s.w84 >= Math.min(lo, hi) - tol && s.w84 <= Math.max(lo, hi) + tol;
  }

  check(entity: SimEntity, s: Sample): ConformanceStatus {
    const inside = [...this.volumes.values()].filter((v) => this.contains(v, s, 0)).map((v) => v.feature.properties.name);

    if (entity.kind === "drone" && entity.conformance_volume_ids.length) {
      const own = entity.conformance_volume_ids.map((id) => this.volumes.get(id)).filter((v): v is Volume => !!v);
      const ok = own.length === 0 || own.some((v) => this.contains(v, s, DRONE_TOLERANCE_M));
      return { ok, reason: ok ? null : "Outside its flight volume", inside };
    }

    if (entity.avoid_layer_ids.length) {
      const hit = [...this.volumes.values()].find(
        (v) => entity.avoid_layer_ids.includes(v.layerId) && this.contains(v, s, 0),
      );
      return { ok: !hit, reason: hit ? `Inside ${hit.feature.properties.name}` : null, inside };
    }

    return { ok: true, reason: null, inside };
  }
}
