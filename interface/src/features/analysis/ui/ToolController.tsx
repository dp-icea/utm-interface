import { useEffect, useRef } from "react";
import { useCesium } from "resium";
import * as Cesium from "cesium";
import { useAnalysis } from "../model/use-analysis";
import type { Measurement, Point3 } from "../model/state";
import { FT_PER_M } from "../lib/altitude";

const LABEL_STYLE = {
  font: "600 26px sans-serif",
  scale: 0.5,
  fillColor: Cesium.Color.WHITE,
  showBackground: true,
  backgroundColor: Cesium.Color.fromCssColorString("#111827").withAlpha(0.8),
  backgroundPadding: new Cesium.Cartesian2(10, 6),
  style: Cesium.LabelStyle.FILL,
  disableDepthTestDistance: Number.POSITIVE_INFINITY,
};

interface Picked {
  lng: number;
  lat: number;
  /** Surface height under the cursor (3D tiles / terrain), W84. */
  surfaceW84: number;
}

function pick(viewer: Cesium.Viewer, screen: Cesium.Cartesian2): Picked | null {
  const scene = viewer.scene;
  let pos: Cesium.Cartesian3 | undefined;
  if (scene.pickPositionSupported) {
    const p = scene.pickPosition(screen);
    if (Cesium.defined(p)) pos = p;
  }
  if (!pos && scene.globe.show) {
    const ray = viewer.camera.getPickRay(screen);
    if (ray) pos = scene.globe.pick(ray, scene);
  }
  if (!pos) return null;
  const c = Cesium.Cartographic.fromCartesian(pos);
  return { lng: Cesium.Math.toDegrees(c.longitude), lat: Cesium.Math.toDegrees(c.latitude), surfaceW84: c.height };
}

const toCartesian = ([lng, lat, h]: Point3) => Cesium.Cartesian3.fromDegrees(lng, lat, h);

function measure(m: Measurement) {
  const geodesic = new Cesium.EllipsoidGeodesic(
    Cesium.Cartographic.fromDegrees(m.a[0], m.a[1]),
    Cesium.Cartographic.fromDegrees(m.b[0], m.b[1]),
  );
  const horizontal = geodesic.surfaceDistance;
  const vertical = m.b[2] - m.a[2];
  return { horizontal, vertical, slant: Math.hypot(horizontal, vertical) };
}

const fmt = (v: number) => `${v.toFixed(1)} m (${Math.round(v * FT_PER_M)} ft)`;

/**
 * Map input for the measuring tool, plus the overlays they and the
 * clearance table produce. Must be rendered inside <Viewer>.
 */
export const ToolController = () => {
  const { viewer } = useCesium();
  const {
    toolMode,
    setToolMode,
    measurement,
    setMeasurement,
    clearanceHighlight,
  } = useAnalysis();
  const dataSource = useRef<Cesium.CustomDataSource | null>(null);
  // Own data source for previews/overlays.
  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource("analysis-tools");
    viewer.dataSources.add(ds);
    dataSource.current = ds;
    return () => {
      if (!viewer.isDestroyed()) viewer.dataSources.remove(ds, true);
      dataSource.current = null;
    };
  }, [viewer]);

  // Input handling for the active tool.
  useEffect(() => {
    if (!viewer || toolMode === "none" || !dataSource.current) return;
    const v = viewer as Cesium.Viewer;
    const handler = new Cesium.ScreenSpaceEventHandler(v.canvas);

    // Suspend the viewer's own click-to-select while a tool is active.
    const widgetHandler = v.screenSpaceEventHandler;
    const savedClick = widgetHandler.getInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
    const savedDouble = widgetHandler.getInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    widgetHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
    widgetHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    v.canvas.style.cursor = "crosshair";

    let cursor: Picked | null = null;
    let measureStart: Picked | null = null;

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      cursor = pick(v, e.endPosition);
      if (measureStart && cursor) {
        setMeasurement({
          a: [measureStart.lng, measureStart.lat, measureStart.surfaceW84],
          b: [cursor.lng, cursor.lat, cursor.surfaceW84],
        });
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const p = pick(v, e.position);
      if (!p) return;
      // measure: first click starts, second click fixes; a third starts over.
      if (!measureStart) {
        measureStart = p;
        setMeasurement({ a: [p.lng, p.lat, p.surfaceW84], b: [p.lng, p.lat, p.surfaceW84] });
      } else {
        setMeasurement({
          a: [measureStart.lng, measureStart.lat, measureStart.surfaceW84],
          b: [p.lng, p.lat, p.surfaceW84],
        });
        measureStart = null;
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction(() => setToolMode("none"), Cesium.ScreenSpaceEventType.RIGHT_CLICK);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setToolMode("none");
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      handler.destroy();
      if (v.isDestroyed()) return;
      v.canvas.style.cursor = "";
      if (savedClick) widgetHandler.setInputAction(savedClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      if (savedDouble) widgetHandler.setInputAction(savedDouble, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    };
  }, [viewer, toolMode, setToolMode, setMeasurement]);

  // Clear the measurement when leaving measure mode.
  useEffect(() => {
    if (toolMode !== "measure") setMeasurement(null);
  }, [toolMode, setMeasurement]);

  // Measurement overlay: slant line + horizontal/vertical legs + label.
  useEffect(() => {
    const ds = dataSource.current;
    if (!ds || !measurement) return;
    const { a, b } = measurement;
    const { horizontal, vertical, slant } = measure(measurement);
    const corner: Point3 = [b[0], b[1], a[2]];
    const added = [
      ds.entities.add({
        polyline: { positions: [toCartesian(a), toCartesian(b)], width: 3, material: Cesium.Color.YELLOW, depthFailMaterial: Cesium.Color.YELLOW.withAlpha(0.4) },
      }),
      ds.entities.add({
        polyline: {
          positions: [toCartesian(a), toCartesian(corner), toCartesian(b)],
          width: 1.5,
          material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.WHITE }),
          depthFailMaterial: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.WHITE.withAlpha(0.4) }),
        },
      }),
      ds.entities.add({
        position: Cesium.Cartesian3.midpoint(toCartesian(a), toCartesian(b), new Cesium.Cartesian3()),
        label: {
          ...LABEL_STYLE,
          // Sit above the line instead of on it.
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -16),
          text: `Horizontal ${fmt(horizontal)}\nVertical ${vertical >= 0 ? "+" : ""}${fmt(vertical)}\n3D ${fmt(slant)}`,
        },
      }),
    ];
    return () => added.forEach((e) => ds.entities.remove(e));
  }, [measurement]);

  // Clearance highlight from the inspector table.
  useEffect(() => {
    const ds = dataSource.current;
    if (!ds || !clearanceHighlight) return;
    const { a, b, label, conflict } = clearanceHighlight;
    const color = conflict ? Cesium.Color.RED : Cesium.Color.YELLOW;
    const sameSpot = a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
    const added = [
      ds.entities.add({
        polyline: sameSpot
          ? undefined
          : { positions: [toCartesian(a), toCartesian(b)], width: 4, material: color, depthFailMaterial: color.withAlpha(0.5) },
        position: Cesium.Cartesian3.midpoint(toCartesian(a), toCartesian(b), new Cesium.Cartesian3()),
        point: { pixelSize: 8, color, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: { ...LABEL_STYLE, text: label, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -16) },
      }),
    ];
    return () => added.forEach((e) => ds.entities.remove(e));
  }, [clearanceHighlight]);

  return null;
};
