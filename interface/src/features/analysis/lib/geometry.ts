/**
 * Planar geometry in a local equirectangular projection (metres). Accurate to
 * well under 0.1% over the few-km extents of an analysis scenario.
 */
import type { AnalysisGeometry } from "@/shared/model";

export type XY = [number, number];
const R = 6378137;
const RAD = Math.PI / 180;

export class LocalProjection {
  private lng0: number;
  private lat0: number;
  private kx: number;

  constructor(lng0: number, lat0: number) {
    this.lng0 = lng0;
    this.lat0 = lat0;
    this.kx = Math.cos(lat0 * RAD) * R * RAD;
  }

  toXY([lng, lat]: [number, number]): XY {
    return [(lng - this.lng0) * this.kx, (lat - this.lat0) * R * RAD];
  }

  toLngLat([x, y]: XY): [number, number] {
    return [x / this.kx + this.lng0, y / (R * RAD) + this.lat0];
  }
}

/** A shape in projected metres. Areas may have several outer rings (MultiPolygon). */
export type Shape =
  | { kind: "area"; rings: XY[][] }
  | { kind: "line"; pts: XY[] }
  | { kind: "point"; p: XY; radius: number };

export function toShape(g: AnalysisGeometry, proj: LocalProjection, radius = 0): Shape {
  switch (g.type) {
    case "Point":
      return { kind: "point", p: proj.toXY(g.coordinates), radius };
    case "LineString":
      return { kind: "line", pts: g.coordinates.map((c) => proj.toXY(c)) };
    case "Polygon":
      return { kind: "area", rings: [g.coordinates[0].map((c) => proj.toXY(c))] };
    case "MultiPolygon":
      return { kind: "area", rings: g.coordinates.map((p) => p[0].map((c) => proj.toXY(c))) };
  }
}

const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const dot = (a: XY, b: XY) => a[0] * b[0] + a[1] * b[1];
const cross = (a: XY, b: XY) => a[0] * b[1] - a[1] * b[0];
const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function closestOnSegment(p: XY, a: XY, b: XY): XY {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  if (len2 === 0) return a;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2));
  return [a[0] + ab[0] * t, a[1] + ab[1] * t];
}

function segmentIntersection(a: XY, b: XY, c: XY, d: XY): XY | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const denom = cross(r, s);
  if (denom === 0) return null;
  const t = cross(sub(c, a), s) / denom;
  const u = cross(sub(c, a), r) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a[0] + r[0] * t, a[1] + r[1] * t];
}

function pointInRing(p: XY, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segments(shape: Shape): [XY, XY][] {
  if (shape.kind === "point") return [[shape.p, shape.p]];
  const out: [XY, XY][] = [];
  const add = (pts: XY[], closed: boolean) => {
    for (let i = 0; i < pts.length - 1; i++) out.push([pts[i], pts[i + 1]]);
    if (closed && pts.length > 2 && dist(pts[0], pts[pts.length - 1]) > 0) out.push([pts[pts.length - 1], pts[0]]);
  };
  if (shape.kind === "line") add(shape.pts, false);
  else shape.rings.forEach((r) => add(r, true));
  return out;
}

function vertices(shape: Shape): XY[] {
  if (shape.kind === "point") return [shape.p];
  return shape.kind === "line" ? shape.pts : shape.rings.flat();
}

function inside(p: XY, shape: Shape): boolean {
  return shape.kind === "area" && shape.rings.some((r) => pointInRing(p, r));
}

export interface HorizontalResult {
  /** Edge-to-edge distance in metres; 0 when footprints overlap. */
  distance: number;
  /** Closest points (projected). Equal when overlapping. */
  pa: XY;
  pb: XY;
  overlap: boolean;
}

/** Minimum horizontal distance between two footprints. */
export function horizontalDistance(a: Shape, b: Shape): HorizontalResult {
  const ra = a.kind === "point" ? a.radius : 0;
  const rb = b.kind === "point" ? b.radius : 0;

  // Containment (a vertex of one inside the other area).
  for (const v of vertices(a)) if (inside(v, b)) return { distance: 0, pa: v, pb: v, overlap: true };
  for (const v of vertices(b)) if (inside(v, a)) return { distance: 0, pa: v, pb: v, overlap: true };

  const sa = segments(a);
  const sb = segments(b);
  let best = Infinity;
  let pa: XY = sa[0][0];
  let pb: XY = sb[0][0];
  for (const [a1, a2] of sa) {
    for (const [b1, b2] of sb) {
      const hit = segmentIntersection(a1, a2, b1, b2);
      if (hit) return { distance: 0, pa: hit, pb: hit, overlap: true };
      const candidates: [XY, XY][] = [
        [a1, closestOnSegment(a1, b1, b2)],
        [a2, closestOnSegment(a2, b1, b2)],
        [closestOnSegment(b1, a1, a2), b1],
        [closestOnSegment(b2, a1, a2), b2],
      ];
      for (const [p, q] of candidates) {
        const d = dist(p, q);
        if (d < best) {
          best = d;
          pa = p;
          pb = q;
        }
      }
    }
  }
  // Obstacles are cylinders: subtract their radius and move the closest point
  // to the cylinder surface.
  const edge = best - ra - rb;
  if (edge <= 0) return { distance: 0, pa, pb, overlap: true };
  const dir: XY = best > 0 ? [(pb[0] - pa[0]) / best, (pb[1] - pa[1]) / best] : [0, 0];
  if (ra) pa = [pa[0] + dir[0] * ra, pa[1] + dir[1] * ra];
  if (rb) pb = [pb[0] - dir[0] * rb, pb[1] - dir[1] * rb];
  return { distance: edge, pa, pb, overlap: false };
}

export function planarDistance(a: XY, b: XY): number {
  return dist(a, b);
}
