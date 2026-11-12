import type { SimKind } from "@/shared/model";

/** Point size (px) per kind: bigger aircraft, bigger dot. */
export const POINT_SIZE: Record<SimKind, number> = { drone: 12, helicopter: 16, plane: 20 };

export const KIND_COLORS: Record<SimKind, string> = {
  drone: "#22d3ee",
  helicopter: "#e879f9",
  plane: "#fb923c",
};

export const KIND_LABELS: Record<SimKind, string> = {
  drone: "Drone",
  helicopter: "Helicopter",
  plane: "Airplane",
};

export const VIOLATION_COLOR = "#ef4444";
