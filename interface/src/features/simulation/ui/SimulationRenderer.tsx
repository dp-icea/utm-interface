import { useEffect, useMemo } from "react";
import { useCesium } from "resium";
import type * as Cesium from "cesium";
import { useAnalysis } from "@/features/analysis";
import { SimEntityManager } from "../lib/sim-entity-manager";
import { useSimulation } from "../model/context";

/** Runs the simulated traffic of the active scenario. Must be rendered inside <Viewer>. */
export const SimulationRenderer = () => {
  const { viewer } = useCesium();
  const { scenario } = useAnalysis();
  const { setManager, setSelectedId } = useSimulation();

  // Rebuild only when the scenario or its simulation changes, not on layer edits.
  const simKey = useMemo(
    () => (scenario?.simulation?.entities.length ? `${scenario.id}:${JSON.stringify(scenario.simulation)}` : null),
    [scenario],
  );
  const scenarioRef = scenario;

  useEffect(() => {
    if (!viewer || !simKey || !scenarioRef) return;
    let m: SimEntityManager | null = null;
    m = new SimEntityManager(viewer as Cesium.Viewer, scenarioRef, setSelectedId, () => setManager(m));
    return () => {
      setManager(null);
      m?.destroy();
    };
    // scenarioRef is captured on purpose: simKey covers what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, simKey, setManager, setSelectedId]);

  return null;
};
