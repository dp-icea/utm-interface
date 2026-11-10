import { useEffect, useRef } from "react";
import { useCesium } from "resium";
import * as Cesium from "cesium";
import { useAnalysis } from "../model/use-analysis";
import type { ProbeReading } from "../model/state";

const HOVER_THROTTLE_MS = 100;

function readAt(viewer: Cesium.Viewer, screen: Cesium.Cartesian2): Omit<ProbeReading, "precise" | "pinned"> | null {
  const scene = viewer.scene;
  const ray = viewer.camera.getPickRay(screen);
  const globeHit = ray && scene.globe.show ? scene.globe.pick(ray, scene) : undefined;

  let surface: Cesium.Cartesian3 | undefined;
  if (scene.pickPositionSupported) {
    const picked = scene.pickPosition(screen);
    if (Cesium.defined(picked)) surface = picked;
  }
  const anchor = surface ?? globeHit;
  if (!anchor) return null;

  const carto = Cesium.Cartographic.fromCartesian(anchor);
  const terrainHeight = scene.globe.getHeight(carto);
  return {
    lng: Cesium.Math.toDegrees(carto.longitude),
    lat: Cesium.Math.toDegrees(carto.latitude),
    surfaceW84: surface ? carto.height : terrainHeight,
    terrainW84: terrainHeight,
  };
}

/** Hover shows live heights; click pins a reading with a full-resolution terrain sample. */
export const HeightProbeController = () => {
  const { viewer } = useCesium();
  const { probeEnabled, setProbe } = useAnalysis();
  const pinned = useRef(false);

  useEffect(() => {
    if (!viewer || !probeEnabled) return;
    const v = viewer as Cesium.Viewer;
    const handler = new Cesium.ScreenSpaceEventHandler(v.canvas);
    let last = 0;
    pinned.current = false;

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      if (pinned.current) return;
      const now = performance.now();
      if (now - last < HOVER_THROTTLE_MS) return;
      last = now;
      const r = readAt(v, e.endPosition);
      setProbe(r ? { ...r, precise: false, pinned: false } : null);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const r = readAt(v, e.position);
      if (!r) {
        pinned.current = false;
        setProbe(null);
        return;
      }
      pinned.current = true;
      setProbe({ ...r, precise: false, pinned: true });
      Cesium.sampleTerrainMostDetailed(v.terrainProvider, [Cesium.Cartographic.fromDegrees(r.lng, r.lat)])
        .then(([c]) => {
          if (!pinned.current) return;
          setProbe({ ...r, terrainW84: c.height, precise: true, pinned: true });
        })
        .catch(() => {});
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Right click unpins and goes back to hover mode.
    handler.setInputAction(() => {
      pinned.current = false;
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

    return () => {
      handler.destroy();
      setProbe(null);
    };
  }, [viewer, probeEnabled, setProbe]);

  return null;
};
