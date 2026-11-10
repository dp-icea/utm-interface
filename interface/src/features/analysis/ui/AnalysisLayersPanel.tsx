import { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Layers, Save, Upload } from "lucide-react";
import { Checkbox } from "@/shared/ui/checkbox";
import { Badge } from "@/shared/ui/badge";
import { useToast } from "@/shared/lib/hook";
import type { AnalysisFeature, AnalysisLayer } from "@/shared/model";
import { useAnalysis } from "../model/use-analysis";
import { CATEGORY_COLORS, OPEA_COLORS, opeaHeight } from "../lib/analysis-entity-manager";
import { FeatureInspector } from "./FeatureInspector";

const inputCls =
  "rounded bg-gray-900 border border-gray-600 px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500";

const dotColor = (f: AnalysisFeature) =>
  f.properties.color ??
  (f.properties.category === "opea"
    ? OPEA_COLORS[f.properties.attributes.aixm_code] ?? "#f97316"
    : CATEGORY_COLORS[f.properties.category]);

const OpeaControls = ({ layer }: { layer: AnalysisLayer }) => {
  const { opeaFilter, setOpeaFilter } = useAnalysis();
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    layer.features.forEach((f) => {
      const code = f.properties.attributes.aixm_code ?? "OTHER";
      c[code] = (c[code] ?? 0) + 1;
    });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [layer]);

  const toggle = (code: string) =>
    setOpeaFilter({
      ...opeaFilter,
      hiddenTypes: opeaFilter.hiddenTypes.includes(code)
        ? opeaFilter.hiddenTypes.filter((c) => c !== code)
        : [...opeaFilter.hiddenTypes, code],
    });

  return (
    <div className="pl-6 space-y-2">
      <label className="flex items-center gap-2 text-xs text-gray-400">
        Min height
        <input
          type="number"
          min={0}
          className={`${inputCls} w-16`}
          value={opeaFilter.minHeight}
          onChange={(e) => setOpeaFilter({ ...opeaFilter, minHeight: parseFloat(e.target.value) || 0 })}
        />
        m
      </label>
      <div className="flex flex-wrap gap-1">
        {counts.map(([code, n]) => {
          const hidden = opeaFilter.hiddenTypes.includes(code);
          return (
            <button
              key={code}
              onClick={() => toggle(code)}
              className={`text-[10px] px-1.5 py-0.5 rounded border ${hidden ? "border-gray-700 text-gray-600" : "border-gray-500 text-gray-200"}`}
            >
              <span className="inline-block h-2 w-2 rounded-full mr-1" style={{ background: OPEA_COLORS[code] ?? "#f97316" }} />
              {code} {n}
            </button>
          );
        })}
      </div>
      <TallestList layer={layer} />
    </div>
  );
};

const TallestList = ({ layer }: { layer: AnalysisLayer }) => {
  const { selectFeature, flyTo } = useAnalysis();
  const tallest = useMemo(
    () =>
      [...layer.features]
        .sort((a, b) => (b.properties.upper?.value ?? 0) - (a.properties.upper?.value ?? 0))
        .slice(0, 8),
    [layer],
  );
  return (
    <div>
      <div className="text-[10px] uppercase text-gray-500 mb-1">Highest tops (MSL)</div>
      {tallest.map((f) => (
        <button
          key={f.id}
          onClick={() => {
            selectFeature(f.id);
            flyTo(f.id);
          }}
          className="w-full flex justify-between text-[11px] text-gray-300 hover:bg-gray-700 px-1 rounded"
        >
          <span>{f.properties.attributes.aixm_code}</span>
          <span>
            {f.properties.upper?.value.toFixed(0)} m · {opeaHeight(f).toFixed(0)} m tall
          </span>
        </button>
      ))}
    </div>
  );
};

const LayerRow = ({ layer }: { layer: AnalysisLayer }) => {
  const { toggleLayer, selectFeature, selectedFeatureId, flyTo } = useAnalysis();
  const [open, setOpen] = useState(false);
  const isOpea = layer.features.length > 0 && layer.features.every((f) => f.properties.category === "opea");
  const warnCount = layer.features.filter((f) => f.properties.warnings.length > 0).length;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen(!open)} className="text-gray-400">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
        <Checkbox checked={layer.visible} onCheckedChange={() => toggleLayer(layer.id)} />
        <span className="flex-1 text-xs text-gray-200 truncate text-start" title={layer.name}>
          {layer.name}
        </span>
        {warnCount > 0 && <span className="text-[10px] text-amber-400">⚠{warnCount}</span>}
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          {layer.features.length}
        </Badge>
      </div>
      {open && isOpea && <OpeaControls layer={layer} />}
      {open && !isOpea && (
        <div className="pl-6 space-y-0.5">
          {layer.features.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                selectFeature(f.id);
                flyTo(f.id);
              }}
              className={`w-full flex items-center gap-2 text-[11px] px-1 rounded text-start ${selectedFeatureId === f.id ? "bg-blue-900/50 text-white" : "text-gray-300 hover:bg-gray-700"}`}
            >
              <span className="h-2 w-2 rounded-full shrink-0" style={{ background: dotColor(f) }} />
              <span className="flex-1 truncate">{f.properties.name}</span>
              {f.properties.warnings.length > 0 && <span className="text-amber-400">⚠</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const AnalysisLayersPanel = () => {
  const {
    summaries,
    scenario,
    dirty,
    loading,
    importWarnings,
    loadScenario,
    importFile,
    save,
    setGeoidUndulation,
  } = useAnalysis();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [showImportWarnings, setShowImportWarnings] = useState(false);
  const [followLinks, setFollowLinks] = useState(true);

  const run = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn();
      toast({ title: ok });
    } catch (e) {
      const err = e as { response?: { data?: { detail?: { message?: string } } }; message?: string };
      const msg = err.response?.data?.detail?.message ?? err.message ?? "Unknown error";
      toast({ title: "Analysis layers", description: msg, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Layers className="h-4 w-4 text-gray-400" />
          <span className="text-sm font-medium text-white">Analysis Layers</span>
        </div>
        {scenario && (
          <button
            disabled={!dirty}
            onClick={() => run(save, "Scenario saved")}
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded ${dirty ? "bg-blue-600 text-white hover:bg-blue-500" : "text-gray-500"}`}
          >
            <Save className="h-3 w-3" />
            {dirty ? "Save" : "Saved"}
          </button>
        )}
      </div>

      <div className="flex gap-2">
        <select
          className={`${inputCls} flex-1 min-w-0`}
          value={scenario?.id ?? ""}
          disabled={loading}
          onChange={(e) => {
            if (dirty && !confirm("Discard unsaved changes?")) return;
            run(() => loadScenario(e.target.value || null), "Scenario loaded");
          }}
        >
          <option value="">— none —</option>
          {summaries.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.feature_count})
            </option>
          ))}
        </select>
        <button
          title="Import KMZ/KML"
          disabled={loading}
          onClick={() => fileInput.current?.click()}
          className="px-2 rounded border border-gray-600 text-gray-300 hover:bg-gray-700"
        >
          <Upload className="h-3 w-3" />
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".kmz,.kml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) run(() => importFile(file, followLinks), `Imported ${file.name}`);
          }}
        />
      </div>

      <label className="flex items-center gap-2 text-[11px] text-gray-400">
        <Checkbox checked={followLinks} onCheckedChange={(v) => setFollowLinks(v === true)} />
        Fetch linked layers (NetworkLinks) on import
      </label>

      {scenario && (
        <>
          <label className="flex items-center gap-2 text-xs text-gray-400" title="EGM2008 geoid undulation N at the site. W84 = MSL + N">
            Geoid N
            <input
              type="number"
              step="0.1"
              className={`${inputCls} w-20`}
              value={scenario.geoid_undulation_m ?? ""}
              placeholder="unset"
              onChange={(e) => setGeoidUndulation(e.target.value === "" ? null : parseFloat(e.target.value))}
            />
            m
            {scenario.geoid_undulation_m === null && (
              <span className="text-amber-400 text-[10px]">MSL drawn as W84</span>
            )}
          </label>

          {importWarnings.length > 0 && (
            <div className="text-[11px]">
              <button className="text-amber-400" onClick={() => setShowImportWarnings(!showImportWarnings)}>
                ⚠ {importWarnings.length} import warnings
              </button>
              {showImportWarnings && (
                <ul className="mt-1 max-h-40 overflow-y-auto space-y-0.5 text-gray-400">
                  {importWarnings.map((w, i) => (
                    <li key={i} className="break-words">
                      {w}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="space-y-2">
            {scenario.layers.map((l) => (
              <LayerRow key={l.id} layer={l} />
            ))}
          </div>

          <FeatureInspector />
        </>
      )}
    </div>
  );
};
