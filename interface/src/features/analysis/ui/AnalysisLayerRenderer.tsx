import { useEffect, useRef, useState } from "react";
import { useCesium } from "resium";
import type * as Cesium from "cesium";
import { useAnalysis } from "../model/use-analysis";
import { AnalysisEntityManager } from "../lib/analysis-entity-manager";

/** Draws the active analysis scenario. Must be rendered inside <Viewer>. */
export const AnalysisLayerRenderer = () => {
  const { viewer } = useCesium();
  const { scenario, opeaFilter, selectedFeatureId, selectFeature, setFlyToHandler } = useAnalysis();
  const manager = useRef<AnalysisEntityManager | null>(null);
  const [terrainTick, setTerrainTick] = useState(0);

  useEffect(() => {
    if (!viewer) return;
    const m = new AnalysisEntityManager(viewer as Cesium.Viewer, selectFeature);
    m.setTerrainLoadedCallback(() => setTerrainTick((t) => t + 1));
    manager.current = m;
    setFlyToHandler((id) => m.flyTo(id));
    return () => {
      setFlyToHandler(null);
      m.destroy();
      manager.current = null;
    };
  }, [viewer, selectFeature, setFlyToHandler]);

  useEffect(() => {
    manager.current?.render(scenario, opeaFilter, selectedFeatureId);
  }, [scenario, opeaFilter, selectedFeatureId, terrainTick]);

  return null;
};
