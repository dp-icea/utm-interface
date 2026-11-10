import { X, Crosshair } from "lucide-react";
import type { AltitudeLimit, Datum, FeatureCategory } from "@/shared/model";
import { useAnalysis } from "../model/use-analysis";
import { FT_PER_M } from "../lib/altitude";
import { CATEGORY_COLORS } from "../lib/analysis-entity-manager";

const DATUMS: Datum[] = ["MSL", "W84", "AGL"];
const CATEGORIES = Object.keys(CATEGORY_COLORS) as FeatureCategory[];
/** Warnings that stop applying once the user sets the limits. */
const RESOLVED_BY_LIMITS = ["needs_floor", "no_limits"];

const inputCls =
  "w-full rounded bg-gray-900 border border-gray-600 px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500";

const LimitEditor = ({
  label,
  limit,
  onChange,
  geoid,
}: {
  label: string;
  limit: AltitudeLimit | null;
  onChange: (l: AltitudeLimit | null) => void;
  geoid: number;
}) => (
  <div className="space-y-1">
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-400">{label}</span>
      {limit ? (
        <button className="text-[10px] text-gray-500 hover:text-red-400" onClick={() => onChange(null)}>
          clear
        </button>
      ) : (
        <span className="text-[10px] text-amber-400">not set (ground)</span>
      )}
    </div>
    <div className="flex gap-1">
      <input
        type="number"
        step="0.5"
        className={inputCls}
        value={limit?.value ?? ""}
        placeholder="m"
        onChange={(e) => {
          const v = e.target.value;
          if (v === "") return onChange(null);
          onChange({ value: parseFloat(v), datum: limit?.datum ?? "MSL" });
        }}
      />
      <select
        className={`${inputCls} w-20`}
        value={limit?.datum ?? "MSL"}
        onChange={(e) => limit && onChange({ ...limit, datum: e.target.value as Datum })}
      >
        {DATUMS.map((d) => (
          <option key={d}>{d}</option>
        ))}
      </select>
    </div>
    {limit && (
      <div className="text-[10px] text-gray-500">
        {Math.round(limit.value * FT_PER_M)} ft {limit.datum}
        {limit.datum === "MSL" && ` · ${(limit.value + geoid).toFixed(1)} m W84`}
        {limit.datum === "W84" && ` · ${(limit.value - geoid).toFixed(1)} m MSL`}
      </div>
    )}
  </div>
);

export const FeatureInspector = () => {
  const { selectedFeatureId, findFeature, updateFeature, selectFeature, flyTo, scenario } = useAnalysis();
  if (!selectedFeatureId) return null;
  const found = findFeature(selectedFeatureId);
  if (!found) return null;
  const { feature } = found;
  const p = feature.properties;
  const geoid = scenario?.geoid_undulation_m ?? 0;

  const setLimit = (key: "lower" | "upper", value: AltitudeLimit | null) => {
    const next = { ...p, [key]: value };
    const warnings =
      next.lower && next.upper
        ? p.warnings.filter((w) => !RESOLVED_BY_LIMITS.some((r) => w.startsWith(r)))
        : p.warnings;
    updateFeature(feature.id, { [key]: value, warnings });
  };

  return (
    <div className="rounded-lg border border-blue-500/50 bg-gray-900/60 p-3 space-y-3">
      <div className="flex items-start gap-2">
        <input
          className={`${inputCls} font-medium`}
          value={p.name}
          onChange={(e) => updateFeature(feature.id, { name: e.target.value })}
        />
        <button title="Fly to" onClick={() => flyTo(feature.id)} className="text-gray-400 hover:text-white pt-1">
          <Crosshair className="h-4 w-4" />
        </button>
        <button title="Close" onClick={() => selectFeature(null)} className="text-gray-400 hover:text-white pt-1">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex gap-2 items-center">
        <select
          className={inputCls}
          value={p.category}
          onChange={(e) => updateFeature(feature.id, { category: e.target.value as FeatureCategory })}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          type="color"
          title="Color override"
          className="h-6 w-8 bg-transparent"
          value={p.color ?? CATEGORY_COLORS[p.category]}
          onChange={(e) => updateFeature(feature.id, { color: e.target.value })}
        />
        {p.color && (
          <button className="text-[10px] text-gray-500 hover:text-white" onClick={() => updateFeature(feature.id, { color: null })}>
            reset
          </button>
        )}
      </div>

      <LimitEditor label="Upper limit" limit={p.upper} onChange={(l) => setLimit("upper", l)} geoid={geoid} />
      <LimitEditor label="Lower limit" limit={p.lower} onChange={(l) => setLimit("lower", l)} geoid={geoid} />

      {p.warnings.length > 0 && (
        <ul className="space-y-1">
          {p.warnings.map((w) => (
            <li key={w} className="text-[11px] text-amber-400 flex gap-1">
              <span>⚠</span>
              <span className="flex-1">{w}</span>
              <button
                title="Dismiss"
                className="text-gray-500 hover:text-white"
                onClick={() => updateFeature(feature.id, { warnings: p.warnings.filter((x) => x !== w) })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <textarea
        className={`${inputCls} h-14 resize-y`}
        placeholder="Notes"
        value={p.notes}
        onChange={(e) => updateFeature(feature.id, { notes: e.target.value })}
      />
      {p.source && <div className="text-[10px] text-gray-500 break-words">{p.source}</div>}
    </div>
  );
};
