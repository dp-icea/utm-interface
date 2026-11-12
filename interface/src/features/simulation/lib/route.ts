/**
 * Pure route math for the simulation (no Cesium): expands the JSON legs into
 * key points, densifies them, and samples a timed track at any instant.
 */
import type {
  AltitudeLimit,
  AnalysisFeature,
  SimEntity,
  SimKind,
  SimLawnmowerLeg,
  SimOrbitLeg,
  SimPhase,
} from "@/shared/model";
import { centroid, toW84 } from "@/features/analysis/lib/altitude";
import { LocalProjection, type XY } from "@/features/analysis/lib/geometry";

const R = 6378137;
const RAD = Math.PI / 180;

export const DEFAULT_CLIMB: Record<SimKind, number> = { drone: 3, helicopter: 5, plane: 8 };
const DENSIFY_STEP: Record<SimKind, number> = { drone: 5, helicopter: 25, plane: 30 };

export interface KeyPoint {
  lng: number;
  lat: number;
  height: AltitudeLimit;
  hold_s: number;
  /** Speed for the segment ending here. */
  speed?: number;
  phase?: SimPhase;
}

// ---------------------------------------------------------------------------
// Geodesy helpers (spherical; plenty for a few tens of km)

export function destination([lng, lat]: [number, number], bearingDeg: number, dist: number): [number, number] {
  const b = bearingDeg * RAD;
  return [
    lng + (dist * Math.sin(b)) / (R * Math.cos(lat * RAD)) / RAD,
    lat + (dist * Math.cos(b)) / R / RAD,
  ];
}

export function groundDistance(a: [number, number], b: [number, number]): number {
  const kx = Math.cos(((a[1] + b[1]) / 2) * RAD) * R * RAD;
  return Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * R * RAD);
}

/** Bearing a → b in degrees, 0 = north, clockwise. */
export function bearingDeg(a: [number, number], b: [number, number]): number {
  const kx = Math.cos(((a[1] + b[1]) / 2) * RAD);
  return (Math.atan2((b[0] - a[0]) * kx, b[1] - a[1]) / RAD + 360) % 360;
}

// ---------------------------------------------------------------------------
// Patterns

function outerRing(f: AnalysisFeature): [number, number][] {
  const g = f.geometry;
  if (g.type === "Polygon") return g.coordinates[0];
  if (g.type === "MultiPolygon") return g.coordinates[0][0];
  throw new Error(`Feature ${f.id} is not a polygon`);
}

/** Principal-axis angle (radians, from +x) of a ring in projected metres. */
function longAxis(pts: XY[]): number {
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p[0], 0) / n;
  const my = pts.reduce((a, p) => a + p[1], 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
    sxy += (x - mx) * (y - my);
  }
  return 0.5 * Math.atan2(2 * sxy, sxx - syy);
}

/** Back-and-forth strips over a polygon, as [start, end] pairs in lng/lat. */
export function lawnmowerStrips(
  ring: [number, number][],
  spacing: number,
  inset: number,
  angleDeg?: number,
): [[number, number], [number, number]][] {
  const c = centroid({ type: "Polygon", coordinates: [ring] });
  const proj = new LocalProjection(c[0], c[1]);
  const pts = ring.map((p) => proj.toXY(p));
  // angle_deg is a compass bearing for the strip direction.
  const theta = angleDeg === undefined ? longAxis(pts) : (90 - angleDeg) * RAD;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const rot = ([x, y]: XY): XY => [x * cos + y * sin, -x * sin + y * cos];
  const unrot = ([u, v]: XY): XY => [u * cos - v * sin, u * sin + v * cos];
  const r = pts.map(rot);
  const ys = r.map((p) => p[1]);
  const minY = Math.min(...ys) + inset;
  const maxY = Math.max(...ys) - inset;

  const strips: [[number, number], [number, number]][] = [];
  let forward = true;
  for (let y = minY; y <= maxY + 1e-6; y += spacing) {
    const xs: number[] = [];
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [x1, y1] = r[j];
      const [x2, y2] = r[i];
      if (y1 > y !== y2 > y) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
    }
    xs.sort((a, b) => a - b);
    let best: [number, number] | null = null;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = xs[k] + inset;
      const b = xs[k + 1] - inset;
      if (b - a > 1 && (!best || b - a > best[1] - best[0])) best = [a, b];
    }
    if (!best) continue;
    const p0 = proj.toLngLat(unrot([forward ? best[0] : best[1], y]));
    const p1 = proj.toLngLat(unrot([forward ? best[1] : best[0], y]));
    strips.push([p0, p1]);
    forward = !forward;
  }
  return strips;
}

function lawnmowerKeys(leg: SimLawnmowerLeg, f: AnalysisFeature): KeyPoint[] {
  const strips = lawnmowerStrips(outerRing(f), leg.spacing_m, leg.inset_m ?? 10, leg.angle_deg);
  const sorties = Math.max(1, leg.sorties ?? 1);
  const k = Math.min(Math.max(0, leg.sortie ?? 0), sorties - 1);
  const per = strips.length / sorties;
  const mine = strips.slice(Math.round(k * per), Math.round((k + 1) * per));
  const key = ([lng, lat]: [number, number]): KeyPoint => ({ lng, lat, height: leg.height, hold_s: 0, phase: "cruise" });
  const via = (leg.via ?? []).map(key);
  // Enter and leave through the via points so transits stay inside concave areas.
  return [...via, ...mine.flatMap(([a, b]) => [key(a), key(b)]), ...[...via].reverse()];
}

function orbitKeys(leg: SimOrbitLeg): KeyPoint[] {
  const turns = leg.turns ?? 1;
  const sign = leg.clockwise === false ? -1 : 1;
  const start = leg.start_bearing_deg ?? 0;
  const steps = Math.max(2, Math.ceil((Math.abs(turns) * 360) / 10));
  const out: KeyPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const b = start + sign * ((turns * 360 * i) / steps);
    const [lng, lat] = destination(leg.center, b, leg.radius_m);
    out.push({ lng, lat, height: leg.height, hold_s: 0, phase: "cruise" });
  }
  return out;
}

/** Expand route legs into key points. Unknown feature references are skipped. */
export function expandRoute(entity: SimEntity, features: Map<string, AnalysisFeature>): KeyPoint[] {
  const out: KeyPoint[] = [];
  for (const leg of entity.route) {
    if (leg.type === "waypoint") {
      let lng = leg.lng;
      let lat = leg.lat;
      if (leg.at_feature) {
        const f = features.get(leg.at_feature);
        if (!f) continue;
        [lng, lat] = centroid(f.geometry);
      }
      if (lng === undefined || lat === undefined) continue;
      out.push({ lng, lat, height: leg.height, hold_s: leg.hold_s ?? 0, speed: leg.speed_mps, phase: leg.phase });
    } else if (leg.type === "lawnmower") {
      const f = features.get(leg.area);
      if (f) out.push(...lawnmowerKeys(leg, f));
    } else if (leg.type === "orbit") {
      out.push(...orbitKeys(leg));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Densify + time

export interface DensePoint {
  lng: number;
  lat: number;
  /** Index of the key point this sample leaves from (segment start). */
  key: number;
  /** Fraction along the segment key → key+1 (1 for the final point). */
  f: number;
}

export function densify(keys: KeyPoint[], kind: SimKind): DensePoint[] {
  const step = DENSIFY_STEP[kind];
  const out: DensePoint[] = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const a: [number, number] = [keys[i].lng, keys[i].lat];
    const b: [number, number] = [keys[i + 1].lng, keys[i + 1].lat];
    const n = Math.max(1, Math.ceil(groundDistance(a, b) / step));
    for (let s = 0; s < n; s++) {
      const f = s / n;
      out.push({ lng: a[0] + (b[0] - a[0]) * f, lat: a[1] + (b[1] - a[1]) * f, key: i, f });
    }
  }
  const last = keys.length - 1;
  if (last >= 0) out.push({ lng: keys[last].lng, lat: keys[last].lat, key: Math.max(0, last - 1), f: last === 0 ? 0 : 1 });
  return out;
}

export interface Track {
  t: Float64Array;
  lng: Float64Array;
  lat: Float64Array;
  w84: Float64Array;
  ground: Float64Array;
  heading: Float64Array;
  phase: (SimPhase | undefined)[];
  duration: number;
  loop: SimEntity["loop"];
  offset: number;
}

/**
 * Turn dense points + terrain (W84, one per dense point) into a timed track.
 * AGL→AGL segments follow the terrain; anything involving MSL/W84 is
 * interpolated linearly between the end heights.
 */
export function buildTrack(
  entity: SimEntity,
  keys: KeyPoint[],
  dense: DensePoint[],
  ground: number[],
  geoid: number,
): Track {
  // Ground under each key point (the dense sample that sits on it).
  const keyGround: number[] = keys.map(() => 0);
  dense.forEach((d, i) => {
    if (d.f === 0) keyGround[d.key] = ground[i];
    if (d.f === 1) keyGround[d.key + 1] = ground[i];
  });
  if (keys.length === 1) keyGround[0] = ground[0] ?? 0;

  const heightAt = (d: DensePoint, g: number): number => {
    const a = keys[d.key];
    const b = keys[Math.min(d.key + 1, keys.length - 1)];
    let h: number;
    if (a.height.datum === "AGL" && b.height.datum === "AGL") {
      h = g + a.height.value + (b.height.value - a.height.value) * d.f;
    } else {
      const wa = toW84(a.height, { terrainW84: keyGround[d.key], geoidUndulation: geoid }) ?? g;
      const wb = toW84(b.height, { terrainW84: keyGround[Math.min(d.key + 1, keys.length - 1)], geoidUndulation: geoid }) ?? g;
      h = wa + (wb - wa) * d.f;
    }
    return Math.max(h, g);
  };

  const climb = entity.climb_mps ?? DEFAULT_CLIMB[entity.kind];
  const t: number[] = [];
  const lng: number[] = [];
  const lat: number[] = [];
  const w84: number[] = [];
  const gnd: number[] = [];
  const phase: (SimPhase | undefined)[] = [];
  const push = (time: number, i: number, h: number) => {
    t.push(time);
    lng.push(dense[i].lng);
    lat.push(dense[i].lat);
    w84.push(h);
    gnd.push(ground[i]);
    phase.push(keys[Math.min(dense[i].key + 1, keys.length - 1)]?.phase);
  };

  let time = 0;
  dense.forEach((d, i) => {
    const h = heightAt(d, ground[i]);
    if (i > 0) {
      const p = dense[i - 1];
      const hd = groundDistance([p.lng, p.lat], [d.lng, d.lat]);
      const dz = Math.abs(h - w84[w84.length - 1]);
      const endKey = keys[Math.min(p.key + 1, keys.length - 1)];
      const speed = endKey.speed ?? entity.speed_mps;
      time += Math.max(hd / speed, dz / climb, 0.05);
    }
    push(time, i, h);
    // Arrived on a key point with a hold: stay put.
    const arrivedKey = d.f === 0 ? d.key : d.f === 1 ? d.key + 1 : -1;
    const hold = arrivedKey >= 0 ? keys[arrivedKey].hold_s : 0;
    if (hold > 0) {
      time += hold;
      push(time, i, h);
    }
  });

  // Heading of the last horizontal movement (back-filled for the start).
  const heading = new Float64Array(t.length).fill(NaN);
  let last = NaN;
  for (let i = 1; i < t.length; i++) {
    const a: [number, number] = [lng[i - 1], lat[i - 1]];
    const b: [number, number] = [lng[i], lat[i]];
    if (groundDistance(a, b) > 0.01) last = bearingDeg(a, b);
    heading[i] = last;
  }
  const first = heading.find((h) => !Number.isNaN(h)) ?? 0;
  for (let i = 0; i < heading.length; i++) if (Number.isNaN(heading[i])) heading[i] = first;

  return {
    t: Float64Array.from(t),
    lng: Float64Array.from(lng),
    lat: Float64Array.from(lat),
    w84: Float64Array.from(w84),
    ground: Float64Array.from(gnd),
    heading,
    phase,
    duration: time,
    loop: entity.loop,
    offset: entity.start_offset_s ?? 0,
  };
}

export interface Sample {
  lng: number;
  lat: number;
  w84: number;
  ground: number;
  /** Height above ground (m). */
  agl: number;
  heading: number;
  /** Horizontal speed (m/s). */
  speed: number;
  /** Vertical speed (m/s, positive up). */
  vspeed: number;
  phase: SimPhase | undefined;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Position on the track at simulation time `simT` (seconds), looping. */
export function sampleAt(track: Track, simT: number): Sample {
  const n = track.t.length;
  const T = track.duration;
  let u = simT + track.offset;
  let reversed = false;
  if (T <= 0 || n < 2) {
    u = 0;
  } else if (track.loop === "pingpong") {
    u = mod(u, 2 * T);
    if (u > T) {
      u = 2 * T - u;
      reversed = true;
    }
  } else {
    u = mod(u, T);
  }

  // Binary search for t[i] <= u < t[i+1].
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (track.t[m] <= u) lo = m;
    else hi = m;
  }
  const i = lo;
  const j = Math.min(i + 1, n - 1);
  const dt = track.t[j] - track.t[i];
  const f = dt > 0 ? Math.min(1, Math.max(0, (u - track.t[i]) / dt)) : 0;
  const lerp = (arr: Float64Array) => arr[i] + (arr[j] - arr[i]) * f;

  const w84 = lerp(track.w84);
  const ground = lerp(track.ground);
  const hd = dt > 0 ? groundDistance([track.lng[i], track.lat[i]], [track.lng[j], track.lat[j]]) : 0;
  const moving = hd > 0.01;
  let heading = moving ? bearingDeg([track.lng[i], track.lat[i]], [track.lng[j], track.lat[j]]) : track.heading[i];
  if (reversed) heading = (heading + 180) % 360;
  const vs = dt > 0 ? (track.w84[j] - track.w84[i]) / dt : 0;

  return {
    lng: lerp(track.lng),
    lat: lerp(track.lat),
    w84,
    ground,
    agl: w84 - ground,
    heading,
    speed: dt > 0 ? hd / dt : 0,
    vspeed: reversed ? -vs : vs,
    phase: track.phase[i],
  };
}
