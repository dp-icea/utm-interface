import { useEffect, useRef, useState } from "react";
import { useCesium } from "resium";
import type * as Cesium from "cesium";
import { useAnalysis } from "../model/use-analysis";
import { AnalysisEntityManager } from "../lib/analysis-entity-manager";

/** Draws the active analysis scenario. Must be rendered inside <Viewer>. */
export const AnalysisLayerRenderer = () => {
  const { viewer } = useCesium();
  const { scenario, opeaFilter, selectedFeatureId, selectFeature, setFlyToHandler, setResolver, bumpLimitsVersion } =
    useAnalysis();
  const manager = useRef<AnalysisEntityManager | null>(null);
  const [terrainTick, setTerrainTick] = useState(0);

  useEffect(() => {
    if (!viewer) return;
    const m = new AnalysisEntityManager(viewer as Cesium.Viewer, selectFeature);
    m.setTerrainLoadedCallback(() => setTerrainTick((t) => t + 1));
    manager.current = m;
    setFlyToHandler((id) => m.flyTo(id));
    setResolver((id) => m.resolve(id));
    return () => {
      setFlyToHandler(null);
      setResolver(null);
      m.destroy();
      manager.current = null;
    };
  }, [viewer, selectFeature, setFlyToHandler, setResolver]);

  useEffect(() => {
    manager.current?.render(scenario, opeaFilter, selectedFeatureId);
    bumpLimitsVersion();
  }, [scenario, opeaFilter, selectedFeatureId, terrainTick, bumpLimitsVersion]);

  return null;
};
