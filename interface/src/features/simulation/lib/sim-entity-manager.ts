import * as Cesium from "cesium";
import type { AnalysisFeature, Scenario, SimEntity, SimKind } from "@/shared/model";
import { FT_PER_M } from "@/features/analysis/lib/altitude";
import { buildTrack, densify, expandRoute, sampleAt, type Sample, type Track } from "./route";
import { ConformanceChecker, type ConformanceStatus } from "./conformance";
import { POINT_SIZE, KIND_COLORS, KIND_LABELS, VIOLATION_COLOR } from "./style";

export const SIM_PREFIX = "sim:";
export const SIM_SPEEDS = [1, 2, 5, 10] as const;

const STATUS_INTERVAL_MS = 250;
const MAX_FRAME_DT_S = 0.25;
const TRAIL_SECONDS: Record<SimKind, number> = { drone: 25, helicopter: 40, plane: 45 };
const ON_GROUND_M = 0.5;

export interface SimLive {
  entity: SimEntity;
  sample: Sample;
  status: ConformanceStatus;
}

interface Runtime {
  entity: SimEntity;
  track: Track;
  color: Cesium.Color;
  sample: Sample;
  status: ConformanceStatus;
  description: string;
  icon: Cesium.Entity;
  parts: Cesium.Entity[];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function formatAgl(s: Sample): string {
  if (s.agl < ON_GROUND_M) return "ON GROUND";
  return `${Math.round(s.agl)} m AGL (${Math.round(s.agl * FT_PER_M)} ft)`;
}

/**
 * Draws and animates the simulated traffic of a scenario. Motion is computed
 * on every render frame from the simulation clock; nothing goes through React.
 */
export class SimEntityManager {
  private viewer: Cesium.Viewer;
  private scenario: Scenario;
  private dataSource = new Cesium.CustomDataSource("simulation");
  private runtimes = new Map<string, Runtime>();
  private checker: ConformanceChecker;
  private removePreRender: Cesium.Event.RemoveCallback | null = null;
  private removeSelection: Cesium.Event.RemoveCallback;
  private destroyed = false;
  private lastFrame = performance.now();
  private lastStatus = 0;
  private routesVisible = true;

  simTime = 0;
  playing = true;
  speed = 1;
  ready = false;

  constructor(
    viewer: Cesium.Viewer,
    scenario: Scenario,
    private onSelect: (simId: string | null) => void,
    private onReady: () => void,
  ) {
    this.viewer = viewer;
    this.scenario = scenario;
    this.checker = new ConformanceChecker(scenario);
    viewer.dataSources.add(this.dataSource);
    this.removeSelection = viewer.selectedEntityChanged.addEventListener((e?: Cesium.Entity) => {
      const id = e?.properties?.simId?.getValue(Cesium.JulianDate.now());
      this.onSelect(typeof id === "string" ? id : null);
    });
    this.start();
  }

  destroy() {
    this.destroyed = true;
    this.removePreRender?.();
    this.removeSelection();
    if (this.viewer.trackedEntity && this.dataSource.entities.contains(this.viewer.trackedEntity)) {
      this.viewer.trackedEntity = undefined;
    }
    if (this.viewer.selectedEntity && this.dataSource.entities.contains(this.viewer.selectedEntity)) {
      this.viewer.selectedEntity = undefined;
    }
    this.dataSource.entities.removeAll();
    this.viewer.dataSources.remove(this.dataSource, true);
    this.runtimes.clear();
  }

  private start() {
    this.build().catch((e) => console.error("Simulation setup failed", e));
  }

  private wait(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Terrain (W84) under every point. World terrain loads asynchronously and
   * the placeholder ellipsoid has no heights, so keep retrying until real
   * terrain answers instead of ever falling back to 0 m.
   */
  private async sampleGround(cartos: Cesium.Cartographic[]): Promise<number[] | null> {
    for (let attempt = 0; !this.destroyed; attempt++) {
      const provider = this.viewer.terrainProvider;
      if (!(provider instanceof Cesium.EllipsoidTerrainProvider) && provider.availability) {
        try {
          const fresh = cartos.map((c) => new Cesium.Cartographic(c.longitude, c.latitude, 0));
          const sampled = await Cesium.sampleTerrainMostDetailed(provider, fresh);
          const heights = sampled.map((c) => c.height);
          const valid = heights.filter((h) => Number.isFinite(h) && h !== 0);
          if (valid.length > heights.length * 0.9) {
            // Fill the rare failed tile from the nearest valid neighbour.
            let last = valid[0];
            return heights.map((h) => (Number.isFinite(h) && h !== 0 ? (last = h) : last));
          }
        } catch (e) {
          if (attempt % 10 === 0) console.warn("Simulation terrain sampling failed, retrying", e);
        }
      }
      await this.wait(1000);
    }
    return null;
  }

  private async build() {
    const features = new Map<string, AnalysisFeature>();
    this.scenario.layers.forEach((l) => l.features.forEach((f) => features.set(f.id, f)));
    const geoid = this.scenario.geoid_undulation_m ?? 0;
    const entities = this.scenario.simulation?.entities ?? [];

    const prepared = entities
      .map((entity) => {
        const keys = expandRoute(entity, features);
        return { entity, keys, dense: densify(keys, entity.kind) };
      })
      .filter((p) => p.keys.length > 0);

    // One terrain request for every densified point of every route.
    const cartos = prepared.flatMap((p) => p.dense.map((d) => Cesium.Cartographic.fromDegrees(d.lng, d.lat)));
    const heights = await this.sampleGround(cartos);
    if (this.destroyed || !heights) return;

    let offset = 0;
    for (const { entity, keys, dense } of prepared) {
      const ground = heights.slice(offset, offset + dense.length);
      offset += dense.length;
      const track = buildTrack(entity, keys, dense, ground, geoid);
      this.add(entity, track);
    }

    this.lastFrame = performance.now();
    this.removePreRender = this.viewer.scene.preRender.addEventListener(() => this.tick());
    this.tick(true);
    this.ready = true;
    this.onReady();
  }

  private add(entity: SimEntity, track: Track) {
    const color = Cesium.Color.fromCssColorString(entity.color ?? KIND_COLORS[entity.kind]);
    const red = Cesium.Color.fromCssColorString(VIOLATION_COLOR);
    const sample = sampleAt(track, this.simTime);
    const rt = {
      entity,
      track,
      color,
      sample,
      status: { ok: true, reason: null, inside: [] },
      description: "",
      parts: [],
    } as unknown as Runtime;

    const tint = () => (rt.status.ok ? rt.color : red);
    const position = new Cesium.CallbackProperty(
      () => Cesium.Cartesian3.fromDegrees(rt.sample.lng, rt.sample.lat, rt.sample.w84),
      false,
    ) as unknown as Cesium.PositionProperty;
    const base = (part: string): Cesium.Entity.ConstructorOptions => ({
      id: `${SIM_PREFIX}${entity.id}${part}`,
      name: `${entity.callsign} · ${KIND_LABELS[entity.kind]}`,
      properties: { simId: entity.id },
      description: new Cesium.CallbackProperty(() => rt.description, false),
    });

    rt.icon = this.dataSource.entities.add({
      ...base(""),
      position,
      point: {
        pixelSize: POINT_SIZE[entity.kind],
        color: new Cesium.CallbackProperty(tint, false),
        outlineColor: Cesium.Color.WHITE.withAlpha(0.9),
        outlineWidth: 2,
        scaleByDistance: new Cesium.NearFarScalar(300, 1.2, 25000, 0.7),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: new Cesium.CallbackProperty(() => `${entity.callsign}\n${formatAgl(rt.sample)}`, false),
        font: "600 24px sans-serif",
        scale: 0.5,
        fillColor: new Cesium.CallbackProperty(() => (rt.status.ok ? Cesium.Color.WHITE : red), false),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("#111827").withAlpha(0.8),
        backgroundPadding: new Cesium.Cartesian2(10, 6),
        style: Cesium.LabelStyle.FILL,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -(POINT_SIZE[entity.kind] / 2 + 6)),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 30000),
      },
    });

    // Dashed drop line to the ground under the aircraft.
    rt.parts.push(
      this.dataSource.entities.add({
        ...base(":stem"),
        polyline: {
          positions: new Cesium.CallbackProperty(
            () => [
              Cesium.Cartesian3.fromDegrees(rt.sample.lng, rt.sample.lat, rt.sample.w84),
              Cesium.Cartesian3.fromDegrees(rt.sample.lng, rt.sample.lat, rt.sample.ground),
            ],
            false,
          ),
          width: 1.5,
          arcType: Cesium.ArcType.NONE,
          material: new Cesium.PolylineDashMaterialProperty({
            color: new Cesium.CallbackProperty(() => tint().withAlpha(0.9), false),
            dashLength: 10,
          }),
        },
      }),
    );

    // Recent trail, recomputed from the track (no history buffer needed).
    const trailSeconds = TRAIL_SECONDS[entity.kind];
    rt.parts.push(
      this.dataSource.entities.add({
        ...base(":trail"),
        polyline: {
          positions: new Cesium.CallbackProperty(() => {
            const pts: Cesium.Cartesian3[] = [];
            for (let k = 0; k <= trailSeconds; k += 1) {
              const s = k === 0 ? rt.sample : sampleAt(track, this.simTime - k);
              pts.push(Cesium.Cartesian3.fromDegrees(s.lng, s.lat, s.w84));
            }
            return pts;
          }, false),
          width: 2.5,
          arcType: Cesium.ArcType.NONE,
          material: new Cesium.PolylineGlowMaterialProperty({ color: color.withAlpha(0.7), glowPower: 0.15, taperPower: 0.6 }),
        },
      }),
    );

    // Planned route preview.
    const step = Math.max(1, Math.floor(track.t.length / 600));
    const route: Cesium.Cartesian3[] = [];
    for (let i = 0; i < track.t.length; i += step) {
      route.push(Cesium.Cartesian3.fromDegrees(track.lng[i], track.lat[i], track.w84[i]));
    }
    const n = track.t.length - 1;
    route.push(Cesium.Cartesian3.fromDegrees(track.lng[n], track.lat[n], track.w84[n]));
    rt.parts.push(
      this.dataSource.entities.add({
        ...base(":route"),
        show: this.routesVisible,
        polyline: {
          positions: route,
          width: 1,
          arcType: Cesium.ArcType.NONE,
          material: new Cesium.PolylineDashMaterialProperty({ color: color.withAlpha(0.35), dashLength: 16 }),
        },
      }),
    );

    this.runtimes.set(entity.id, rt);
  }

  private tick(force = false) {
    const now = performance.now();
    const dt = Math.min((now - this.lastFrame) / 1000, MAX_FRAME_DT_S);
    this.lastFrame = now;
    if (this.playing) this.simTime += dt * this.speed;
    for (const rt of this.runtimes.values()) rt.sample = sampleAt(rt.track, this.simTime);

    if (force || now - this.lastStatus >= STATUS_INTERVAL_MS) {
      this.lastStatus = now;
      for (const rt of this.runtimes.values()) {
        rt.status = this.checker.check(rt.entity, rt.sample);
        rt.description = this.describe(rt);
      }
    }
  }

  private describe(rt: Runtime): string {
    const s = rt.sample;
    const geoid = this.scenario.geoid_undulation_m ?? 0;
    const msl = s.w84 - geoid;
    const rows: [string, string][] = [
      ["Type", KIND_LABELS[rt.entity.kind]],
      ["Status", rt.status.ok ? "Conforming" : `⚠ ${rt.status.reason}`],
      ["Height", formatAgl(s)],
      ["Altitude", `${msl.toFixed(0)} m MSL (${Math.round(msl * FT_PER_M)} ft)`],
      ["Ground speed", `${s.speed.toFixed(1)} m/s (${Math.round(s.speed * 1.94384)} kt)`],
      ["Vertical speed", `${s.vspeed >= 0 ? "+" : ""}${s.vspeed.toFixed(1)} m/s`],
      ["Heading", `${Math.round(s.heading).toString().padStart(3, "0")}°`],
      ["Position", `${s.lat.toFixed(6)}, ${s.lng.toFixed(6)}`],
      ["Inside", rt.status.inside.length ? rt.status.inside.join(", ") : "—"],
    ];
    if (rt.entity.notes) rows.push(["Mission", rt.entity.notes]);
    return (
      `<table class="cesium-infoBox-defaultTable"><tbody>` +
      rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("") +
      `</tbody></table>`
    );
  }

  // --- Controls ----------------------------------------------------------

  setPlaying(playing: boolean) {
    this.playing = playing;
  }

  setSpeed(speed: number) {
    this.speed = speed;
  }

  reset() {
    this.simTime = 0;
    this.tick(true);
  }

  setRoutesVisible(visible: boolean) {
    this.routesVisible = visible;
    for (const rt of this.runtimes.values()) rt.parts.forEach((p) => p.id.endsWith(":route") && (p.show = visible));
  }

  select(simId: string | null) {
    const rt = simId ? this.runtimes.get(simId) : undefined;
    this.viewer.selectedEntity = rt?.icon;
  }

  /** Fly the camera to an entity's current position. */
  flyTo(simId: string) {
    const rt = this.runtimes.get(simId);
    if (!rt) return;
    const s = rt.sample;
    const range = rt.entity.kind === "plane" ? 2500 : rt.entity.kind === "helicopter" ? 1200 : 300;
    this.viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(s.lng, s.lat, s.w84), 1),
      { duration: 1.2, offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-35), range) },
    );
  }

  follow(simId: string | null) {
    const rt = simId ? this.runtimes.get(simId) : undefined;
    this.viewer.trackedEntity = rt?.icon;
  }

  live(): SimLive[] {
    return [...this.runtimes.values()].map((rt) => ({ entity: rt.entity, sample: rt.sample, status: rt.status }));
  }
}
