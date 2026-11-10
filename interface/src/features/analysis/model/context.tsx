import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ScenariosService } from "@/shared/api";
import { AnalysisContext, type BaseScene, type OpeaFilter, type ProbeReading } from "./state";
import type {
  AnalysisFeature,
  AnalysisFeatureProperties,
  Scenario,
  ScenarioSummary,
} from "@/shared/model";

const LAST_SCENARIO_KEY = "analysis-last-scenario";

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export const AnalysisProvider = ({ children }: { children: ReactNode }) => {
  const [summaries, setSummaries] = useState<ScenarioSummary[]>([]);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [selectedFeatureId, selectFeature] = useState<string | null>(null);
  const [opeaFilter, setOpeaFilter] = useState<OpeaFilter>({
    hiddenTypes: ["TREE"],
    minHeight: 0,
  });

  const [baseScene, setBaseSceneState] = useState<BaseScene>(
    () => {
      const saved = readStorage("analysis-base-scene");
      return saved === "osm" || saved === "google" ? saved : "terrain";
    },
  );
  const setBaseScene = useCallback((scene: BaseScene) => {
    setBaseSceneState(scene);
    writeStorage("analysis-base-scene", scene);
  }, []);
  const [probeEnabled, setProbeEnabled] = useState(false);
  const [probe, setProbe] = useState<ProbeReading | null>(null);

  const refreshList = useCallback(async () => {
    try {
      setSummaries(await ScenariosService.list());
    } catch (e) {
      console.error("Failed to list scenarios", e);
    }
  }, []);

  const loadScenario = useCallback(async (id: string | null) => {
    selectFeature(null);
    setImportWarnings([]);
    setDirty(false);
    writeStorage(LAST_SCENARIO_KEY, id);
    if (!id) {
      setScenario(null);
      return;
    }
    setLoading(true);
    try {
      setScenario(await ScenariosService.get(id));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshList();
    const last = readStorage(LAST_SCENARIO_KEY);
    if (last) loadScenario(last).catch(() => writeStorage(LAST_SCENARIO_KEY, null));
  }, [refreshList, loadScenario]);

  const importFile = useCallback(
    async (file: File, followLinks = false) => {
      setLoading(true);
      try {
        const res = await ScenariosService.importFile(file, { save: true, followLinks });
        await refreshList();
        setScenario(res.scenario);
        setImportWarnings(res.warnings);
        setDirty(false);
        selectFeature(null);
        writeStorage(LAST_SCENARIO_KEY, res.scenario.id);
      } finally {
        setLoading(false);
      }
    },
    [refreshList],
  );

  const save = useCallback(async () => {
    if (!scenario) return;
    await ScenariosService.save(scenario);
    setDirty(false);
    await refreshList();
  }, [scenario, refreshList]);

  const mutate = useCallback((fn: (s: Scenario) => Scenario) => {
    setScenario((s) => (s ? fn(s) : s));
    setDirty(true);
  }, []);

  const toggleLayer = useCallback(
    (layerId: string) =>
      mutate((s) => ({
        ...s,
        layers: s.layers.map((l) => (l.id === layerId ? { ...l, visible: !l.visible } : l)),
      })),
    [mutate],
  );

  const setGeoidUndulation = useCallback(
    (value: number | null) => mutate((s) => ({ ...s, geoid_undulation_m: value })),
    [mutate],
  );

  const updateFeature = useCallback(
    (featureId: string, patch: Partial<AnalysisFeatureProperties>) =>
      mutate((s) => ({
        ...s,
        layers: s.layers.map((l) => ({
          ...l,
          features: l.features.map((f) =>
            f.id === featureId ? { ...f, properties: { ...f.properties, ...patch } } : f,
          ),
        })),
      })),
    [mutate],
  );

  const featureIndex = useMemo(() => {
    const idx = new Map<string, { feature: AnalysisFeature; layerId: string }>();
    scenario?.layers.forEach((l) => l.features.forEach((f) => idx.set(f.id, { feature: f, layerId: l.id })));
    return idx;
  }, [scenario]);

  const findFeature = useCallback((id: string) => featureIndex.get(id), [featureIndex]);

  const flyToHandler = useRef<((featureId: string) => void) | null>(null);
  const flyTo = useCallback((id: string) => flyToHandler.current?.(id), []);
  const setFlyToHandler = useCallback((h: ((featureId: string) => void) | null) => {
    flyToHandler.current = h;
  }, []);

  return (
    <AnalysisContext.Provider
      value={{
        summaries,
        scenario,
        dirty,
        loading,
        importWarnings,
        selectedFeatureId,
        opeaFilter,
        refreshList,
        loadScenario,
        importFile,
        save,
        selectFeature,
        toggleLayer,
        setGeoidUndulation,
        updateFeature,
        setOpeaFilter,
        findFeature,
        flyTo,
        setFlyToHandler,
        baseScene,
        setBaseScene,
        probeEnabled,
        setProbeEnabled,
        probe,
        setProbe,
      }}
    >
      {children}
    </AnalysisContext.Provider>
  );
};
