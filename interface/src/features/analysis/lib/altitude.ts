import type { AltitudeLimit, AnalysisFeature, AnalysisGeometry } from "@/shared/model";

export const FT_PER_M = 3.28084;
/** DECEA 3D views cap "unlimited" AGL zones at 500 m; we do the same. */
export const MAX_DISPLAY_AGL_M = 500;

/** Representative [lng, lat] of a geometry (vertex mean of the outer ring). */
export function centroid(geometry: AnalysisGeometry): [number, number] {
  let pts: [number, number][];
  switch (geometry.type) {
    case "Point":
      return geometry.coordinates;
    case "LineString":
      pts = geometry.coordinates;
      break;
    case "Polygon":
      pts = geometry.coordinates[0];
      break;
    case "MultiPolygon":
      pts = geometry.coordinates.flatMap((p) => p[0]);
      break;
  }
  const n = pts.length || 1;
  return [
    pts.reduce((a, p) => a + p[0], 0) / n,
    pts.reduce((a, p) => a + p[1], 0) / n,
  ];
}

export interface AltitudeContext {
  /** Terrain ellipsoidal height (W84) at the feature reference point. */
  terrainW84: number | undefined;
  /** Geoid undulation N (W84 = MSL + N). */
  geoidUndulation: number;
}

/** Convert a limit to W84 ellipsoidal height (what Cesium renders). */
export function toW84(limit: AltitudeLimit, ctx: AltitudeContext): number | undefined {
  switch (limit.datum) {
    case "W84":
      return limit.value;
    case "MSL":
      return limit.value + ctx.geoidUndulation;
    case "AGL":
      if (ctx.terrainW84 === undefined) return undefined;
      return ctx.terrainW84 + Math.min(limit.value, MAX_DISPLAY_AGL_M);
  }
}

export function fromW84(w84: number, datum: AltitudeLimit["datum"], ctx: AltitudeContext): number | undefined {
  switch (datum) {
    case "W84":
      return w84;
    case "MSL":
      return w84 - ctx.geoidUndulation;
    case "AGL":
      return ctx.terrainW84 === undefined ? undefined : w84 - ctx.terrainW84;
  }
}

export interface ResolvedVolume {
  lowerW84: number;
  upperW84: number;
  /** true when the lower limit is missing and the ground was used. */
  floorFromTerrain: boolean;
}

export function resolveVolume(f: AnalysisFeature, ctx: AltitudeContext): ResolvedVolume | undefined {
  const { lower, upper } = f.properties;
  if (!upper) return undefined;
  const upperW84 = toW84(upper, ctx);
  if (upperW84 === undefined) return undefined;
  if (lower) {
    const lowerW84 = toW84(lower, ctx);
    if (lowerW84 === undefined) return undefined;
    return { lowerW84: Math.min(lowerW84, upperW84), upperW84: Math.max(lowerW84, upperW84), floorFromTerrain: false };
  }
  if (ctx.terrainW84 === undefined) return undefined;
  return { lowerW84: Math.min(ctx.terrainW84, upperW84), upperW84, floorFromTerrain: true };
}

export function formatLimit(limit: AltitudeLimit | null): string {
  if (!limit) return "—";
  return `${limit.value.toFixed(1)} m ${limit.datum} (${Math.round(limit.value * FT_PER_M)} ft)`;
}

/** Top altitude for map labels, e.g. "670 m MSL (2198 ft)". */
export function formatTop(upper: AltitudeLimit | null): string {
  if (!upper) return "no limits";
  const v = Number.isInteger(upper.value) ? upper.value.toFixed(0) : upper.value.toFixed(1);
  return `${v} m ${upper.datum} (${Math.round(upper.value * FT_PER_M)} ft)`;
}
