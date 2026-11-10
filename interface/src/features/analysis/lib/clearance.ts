import type { AnalysisFeature } from "@/shared/model";
import type { Point3, ResolvedLimits } from "../model/state";
import { centroid } from "./altitude";
import { horizontalDistance, LocalProjection, toShape } from "./geometry";

export type ClearanceStatus = "conflict" | "above" | "below" | "clear";

export interface ClearanceRow {
  feature: AnalysisFeature;
  layerName: string;
  /** Horizontal edge-to-edge distance (m); 0 when footprints overlap. */
  horizontal: number;
  /**
   * Vertical separation (m): positive = gap between the volumes,
   * negative = their altitude bands overlap by that much.
   */
  vertical: number;
  status: ClearanceStatus;
  /** Closest-approach points for drawing the highlight line. */
  a: Point3;
  b: Point3;
}

/**
 * Compare a reference feature with candidate features.
 * - conflict: footprints overlap AND altitude bands overlap
 * - above / below: footprints overlap, other volume entirely above/below
 * - clear: footprints apart (horizontal > 0)
 */
export function computeClearance(
  ref: AnalysisFeature,
  refLimits: ResolvedLimits,
  candidates: { feature: AnalysisFeature; layerName: string; limits: ResolvedLimits }[],
): ClearanceRow[] {
  const [lng0, lat0] = centroid(ref.geometry);
  const proj = new LocalProjection(lng0, lat0);
  const refShape = toShape(ref.geometry, proj, ref.properties.radius_m ?? 0);

  return candidates.map(({ feature, layerName, limits }) => {
    const shape = toShape(feature.geometry, proj, feature.properties.radius_m ?? 0);
    const h = horizontalDistance(refShape, shape);
    const gapAbove = limits.lowerW84 - refLimits.upperW84; // other is above ref
    const gapBelow = refLimits.lowerW84 - limits.upperW84; // other is below ref
    const vertical = Math.max(gapAbove, gapBelow);

    let status: ClearanceStatus;
    if (!h.overlap) status = "clear";
    else if (vertical < 0) status = "conflict";
    else status = gapAbove >= gapBelow ? "above" : "below";

    // Heights for the highlight line: closest altitudes of the two bands.
    let za: number;
    let zb: number;
    if (vertical >= 0) {
      if (gapAbove >= gapBelow) {
        za = refLimits.upperW84;
        zb = limits.lowerW84;
      } else {
        za = refLimits.lowerW84;
        zb = limits.upperW84;
      }
    } else {
      // Bands overlap: draw at the middle of the shared band.
      const mid = (Math.max(refLimits.lowerW84, limits.lowerW84) + Math.min(refLimits.upperW84, limits.upperW84)) / 2;
      za = zb = mid;
    }
    const [alng, alat] = proj.toLngLat(h.pa);
    const [blng, blat] = proj.toLngLat(h.pb);
    return {
      feature,
      layerName,
      horizontal: h.distance,
      vertical,
      status,
      a: [alng, alat, za],
      b: [blng, blat, zb],
    };
  });
}

const ORDER: Record<ClearanceStatus, number> = { conflict: 0, above: 1, below: 1, clear: 2 };

/** Conflicts first, then stacked volumes by vertical gap, then by horizontal distance. */
export function sortClearance(rows: ClearanceRow[]): ClearanceRow[] {
  return [...rows].sort((x, y) => {
    if (ORDER[x.status] !== ORDER[y.status]) return ORDER[x.status] - ORDER[y.status];
    if (x.status === "clear") return x.horizontal - y.horizontal;
    return x.vertical - y.vertical;
  });
}
