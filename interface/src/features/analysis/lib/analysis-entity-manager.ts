import * as Cesium from "cesium";
import type { AnalysisFeature, FeatureCategory, Scenario } from "@/shared/model";
import type { OpeaFilter } from "../model/state";
import {
  centroid,
  formatLimit,
  formatTop,
  resolveVolume,
  type AltitudeContext,
} from "./altitude";

export const ENTITY_PREFIX = "analysis:";

export const CATEGORY_COLORS: Record<FeatureCategory, string> = {
  utm_zone: "#22c55e",
  operation: "#3b82f6",
  contingency: "#f59e0b",
  airport_restriction: "#ef4444",
  heliport_restriction: "#d946ef",
  restricted_area: "#b91c1c",
  opea: "#f97316",
  reference: "#e5e7eb",
  custom: "#06b6d4",
};

export const OPEA_COLORS: Record<string, string> = {
  BUILDING: "#f97316",
  TOWER: "#ef4444",
  ANTENNA: "#ef4444",
  POLE: "#facc15",
  CRANE: "#eab308",
  NATURAL_HIGHPOINT: "#a16207",
  TREE: "#16a34a",
  WATER_TOWER: "#38bdf8",
  TANK: "#38bdf8",
  FUEL_SYSTEM: "#a855f7",
  CONTROL_TOWER: "#f43f5e",
  WALL: "#9ca3af",
};

interface Rendered {
  signature: string;
  entities: Cesium.Entity[];
}

function featureColor(f: AnalysisFeature): Cesium.Color {
  const css =
    f.properties.color ??
    (f.properties.category === "opea"
      ? OPEA_COLORS[f.properties.attributes.aixm_code] ?? "#f97316"
      : CATEGORY_COLORS[f.properties.category]);
  return Cesium.Color.fromCssColorString(css);
}

export function opeaHeight(f: AnalysisFeature): number {
  const h = parseFloat(f.properties.attributes.altura ?? "");
  if (!Number.isNaN(h)) return h;
  const { lower, upper } = f.properties;
  return lower && upper ? upper.value - lower.value : 0;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function describe(f: AnalysisFeature, lowerW84?: number, upperW84?: number): string {
  const p = f.properties;
  const rows: [string, string][] = [
    ["Category", p.category],
    ["Lower", formatLimit(p.lower)],
    ["Upper", formatLimit(p.upper)],
  ];
  if (lowerW84 !== undefined && upperW84 !== undefined) {
    rows.push(["Rendered (W84)", `${lowerW84.toFixed(1)} – ${upperW84.toFixed(1)} m`]);
  }
  for (const [k, v] of Object.entries(p.attributes)) {
    if (k === "ads_impactados") continue;
    rows.push([k, v]);
  }
  p.warnings.forEach((w) => rows.push(["⚠", w]));
  if (p.source) rows.push(["Source", p.source]);
  return (
    `<table class="cesium-infoBox-defaultTable"><tbody>` +
    rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(String(v))}</td></tr>`).join("") +
    `</tbody></table>` +
    (p.notes ? `<p style="white-space:pre-wrap">${escapeHtml(p.notes)}</p>` : "")
  );
}

export class AnalysisEntityManager {
  private viewer: Cesium.Viewer;
  private dataSource: Cesium.CustomDataSource;
  private rendered = new Map<string, Rendered>();
  private terrain = new Map<string, number>();
  private pendingTerrain = new Set<string>();
  private removeSelectionListener: Cesium.Event.RemoveCallback;
  private onTerrainLoaded: () => void = () => {};

  constructor(viewer: Cesium.Viewer, onSelect: (featureId: string | null) => void) {
    this.viewer = viewer;
    this.dataSource = new Cesium.CustomDataSource("analysis");
    viewer.dataSources.add(this.dataSource);
    this.removeSelectionListener = viewer.selectedEntityChanged.addEventListener((entity?: Cesium.Entity) => {
      const id = entity?.properties?.featureId?.getValue(Cesium.JulianDate.now());
      onSelect(typeof id === "string" ? id : null);
    });
  }

  destroy() {
    this.removeSelectionListener();
    this.dataSource.entities.removeAll();
    this.viewer.dataSources.remove(this.dataSource, true);
    this.rendered.clear();
  }

  setTerrainLoadedCallback(cb: () => void) {
    this.onTerrainLoaded = cb;
  }

  terrainAt(featureId: string): number | undefined {
    return this.terrain.get(featureId);
  }

  private static needsTerrain(f: AnalysisFeature): boolean {
    const p = f.properties;
    if (!p.upper) return false; // drawn as a ground footprint, no height needed
    return !p.lower || p.lower.datum === "AGL" || p.upper.datum === "AGL";
  }

  /** Sample terrain (W84) under every feature that needs it, in one batch. */
  private requestTerrain(features: AnalysisFeature[]) {
    const needed = features.filter(
      (f) => AnalysisEntityManager.needsTerrain(f) && !this.terrain.has(f.id) && !this.pendingTerrain.has(f.id),
    );
    if (needed.length === 0) return;
    needed.forEach((f) => this.pendingTerrain.add(f.id));
    const positions = needed.map((f) => {
      const [lng, lat] = centroid(f.geometry);
      return Cesium.Cartographic.fromDegrees(lng, lat);
    });
    Cesium.sampleTerrainMostDetailed(this.viewer.terrainProvider, positions)
      .then((sampled) => {
        sampled.forEach((c, i) => this.terrain.set(needed[i].id, c.height ?? 0));
      })
      .catch((e) => console.warn("Terrain sampling failed", e))
      .finally(() => {
        needed.forEach((f) => this.pendingTerrain.delete(f.id));
        this.onTerrainLoaded();
      });
  }

  render(scenario: Scenario | null, opeaFilter: OpeaFilter, selectedId: string | null) {
    const geoid = scenario?.geoid_undulation_m ?? 0;
    const wanted = new Set<string>();

    if (scenario) {
      const visible = scenario.layers
        .filter((l) => l.visible)
        .flatMap((l) => l.features)
        .filter((f) => {
          if (f.properties.category !== "opea") return true;
          const code = f.properties.attributes.aixm_code ?? "OTHER";
          return !opeaFilter.hiddenTypes.includes(code) && opeaHeight(f) >= opeaFilter.minHeight;
        });
      this.requestTerrain(visible);
      const labelOwners = AnalysisEntityManager.opeaLabelOwners(visible);

      for (const f of visible) {
        const terrainW84 = this.terrain.get(f.id);
        // Wait for the terrain sample instead of drawing a provisional
        // ground-level version that would then have to be replaced.
        if (terrainW84 === undefined && AnalysisEntityManager.needsTerrain(f)) continue;
        wanted.add(f.id);
        const ctx: AltitudeContext = { terrainW84, geoidUndulation: geoid };
        const showLabel = f.properties.category !== "opea" || labelOwners.has(f.id);
        const signature = JSON.stringify([f, geoid, terrainW84, selectedId === f.id, showLabel]);
        const existing = this.rendered.get(f.id);
        if (existing?.signature === signature) continue;
        if (existing) this.removeEntities(existing.entities);
        this.rendered.set(f.id, {
          signature,
          entities: this.build(f, ctx, selectedId === f.id, showLabel),
        });
      }
    }

    for (const [id, r] of this.rendered) {
      if (!wanted.has(id)) {
        this.removeEntities(r.entities);
        this.rendered.delete(id);
      }
    }
  }

  private removeEntities(entities: Cesium.Entity[]) {
    entities.forEach((e) => this.dataSource.entities.removeById(e.id));
  }

  /** DECEA lists some obstacles several times at the same spot; label only
   *  the highest one per ~1 m cell so labels don't stack. */
  private static opeaLabelOwners(features: AnalysisFeature[]): Set<string> {
    const best = new Map<string, AnalysisFeature>();
    for (const f of features) {
      if (f.properties.category !== "opea" || f.geometry.type !== "Point") continue;
      const [lng, lat] = f.geometry.coordinates;
      const key = `${lng.toFixed(5)},${lat.toFixed(5)}`;
      const cur = best.get(key);
      if (!cur || (f.properties.upper?.value ?? 0) > (cur.properties.upper?.value ?? 0)) best.set(key, f);
    }
    return new Set([...best.values()].map((f) => f.id));
  }

  flyTo(featureId: string) {
    const r = this.rendered.get(featureId);
    if (r && r.entities.length) {
      this.viewer.flyTo(r.entities, { duration: 1.2 });
    }
  }

  private add(f: AnalysisFeature, part: string, options: Cesium.Entity.ConstructorOptions): Cesium.Entity {
    const id = `${ENTITY_PREFIX}${f.id}${part}`;
    this.dataSource.entities.removeById(id);
    return this.dataSource.entities.add({
      id,
      name: f.properties.name,
      properties: { featureId: f.id },
      ...options,
    });
  }

  /** Name + altitude label floating above the feature's top. */
  private label(f: AnalysisFeature, position: Cesium.Cartesian3, description: string, onGround: boolean): Cesium.Entity {
    return this.add(f, ":label", {
      position,
      description,
      label: {
        text: `${f.properties.name}\n${formatTop(f.properties.upper)}`,
        // Rasterize at 2x and scale down: small on screen but sharp.
        font: "600 26px sans-serif",
        scale: 0.5,
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("#111827").withAlpha(0.75),
        backgroundPadding: new Cesium.Cartesian2(10, 6),
        style: Cesium.LabelStyle.FILL,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -6),
        heightReference: onGround ? Cesium.HeightReference.CLAMP_TO_GROUND : Cesium.HeightReference.NONE,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 6000),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  private build(f: AnalysisFeature, ctx: AltitudeContext, selected: boolean, showLabel = true): Cesium.Entity[] {
    const color = featureColor(f);
    const vol = resolveVolume(f, ctx);
    const description = describe(f, vol?.lowerW84, vol?.upperW84);
    const outlineColor = selected ? Cesium.Color.WHITE : color;
    const fillAlpha = selected ? 0.55 : vol?.floorFromTerrain ? 0.12 : 0.3;
    const g = f.geometry;

    if (f.properties.category === "opea" && g.type === "Point" && vol) {
      const [lng, lat] = g.coordinates;
      const height = Math.max(vol.upperW84 - vol.lowerW84, 0.5);
      const radius = f.properties.radius_m ?? 5;
      return [
        this.add(f, "", {
          position: Cesium.Cartesian3.fromDegrees(lng, lat, vol.lowerW84 + height / 2),
          description,
          cylinder: {
            length: height,
            topRadius: radius,
            bottomRadius: radius,
            material: color.withAlpha(selected ? 0.9 : 0.7),
            outline: selected,
            outlineColor,
          },
        }),
        this.add(f, ":top", {
          position: Cesium.Cartesian3.fromDegrees(lng, lat, vol.upperW84),
          description,
          point: {
            pixelSize: selected ? 10 : 6,
            color,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 25000),
          },
          label: showLabel ? {
            text: `${f.properties.attributes.aixm_code ?? f.properties.name}\n${formatTop(f.properties.upper)}`,
            // Rasterize at 2x and scale down: small on screen but sharp.
            font: "600 24px sans-serif",
            scale: 0.5,
            fillColor: Cesium.Color.WHITE,
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString("#111827").withAlpha(0.75),
            backgroundPadding: new Cesium.Cartesian2(10, 6),
            style: Cesium.LabelStyle.FILL,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -8),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1500),
            disableDepthTestDistance: 2000,
          } : undefined,
        }),
      ];
    }

    if (g.type === "Point") {
      const [lng, lat] = g.coordinates;
      const h = vol?.upperW84 ?? ctx.terrainW84 ?? 0;
      return [
        this.add(f, "", {
          position: Cesium.Cartesian3.fromDegrees(lng, lat, h),
          description,
          point: { pixelSize: 8, color, outlineColor: Cesium.Color.BLACK, outlineWidth: 1, heightReference: vol ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND },
          label: {
            text: f.properties.name,
            // Rasterize at 2x and scale down: small on screen but sharp.
            font: "600 26px sans-serif",
            scale: 0.5,
            fillColor: Cesium.Color.WHITE,
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString("#111827").withAlpha(0.75),
            backgroundPadding: new Cesium.Cartesian2(10, 6),
            style: Cesium.LabelStyle.FILL,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -10),
            heightReference: vol ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
          },
        }),
      ];
    }

    if (g.type === "LineString") {
      const h = vol?.upperW84;
      const [lng0, lat0] = g.coordinates[0];
      return [
        this.label(f, Cesium.Cartesian3.fromDegrees(lng0, lat0, h ?? 0), description, h === undefined),
        this.add(f, "", {
          description,
          polyline: {
            positions: g.coordinates.map(([lng, lat]) => Cesium.Cartesian3.fromDegrees(lng, lat, h ?? 0)),
            width: selected ? 4 : 2,
            material: color,
            clampToGround: h === undefined,
          },
        }),
      ];
    }

    const polygons = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    const [clng, clat] = centroid(g);
    const labelEntity = this.label(
      f,
      Cesium.Cartesian3.fromDegrees(clng, clat, vol?.upperW84 ?? 0),
      description,
      !vol,
    );
    const shapes = polygons.map((rings, i) => {
      const toPositions = (ring: [number, number][]) =>
        ring.map(([lng, lat]) => Cesium.Cartesian3.fromDegrees(lng, lat));
      const hierarchy = new Cesium.PolygonHierarchy(
        toPositions(rings[0]),
        rings.slice(1).map((r) => new Cesium.PolygonHierarchy(toPositions(r))),
      );
      const polygon: Cesium.PolygonGraphics.ConstructorOptions = {
        hierarchy,
        material: color.withAlpha(fillAlpha),
        outline: true,
        outlineColor,
      };
      if (!vol) {
        // No usable limits: draw a ground footprint only.
        polygon.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
        polygon.outline = false;
        polygon.material = color.withAlpha(0.25);
      } else if (vol.upperW84 - vol.lowerW84 < 0.1) {
        polygon.height = vol.upperW84;
      } else {
        polygon.height = vol.lowerW84;
        polygon.extrudedHeight = vol.upperW84;
      }
      return this.add(f, polygons.length > 1 ? `:${i}` : "", { description, polygon });
    });
    return [...shapes, labelEntity];
  }
}

