import { useMemo, useState } from "react";
import type { AnalysisFeature } from "@/shared/model";
import { useAnalysis } from "../model/use-analysis";
import { opeaHeight } from "../lib/analysis-entity-manager";
import { computeClearance, sortClearance, type ClearanceRow, type ClearanceStatus } from "../lib/clearance";

const STATUS_STYLE: Record<ClearanceStatus, { label: string; cls: string }> = {
  conflict: { label: "CONFLICT", cls: "bg-red-600 text-white" },
  above: { label: "above", cls: "bg-gray-700 text-gray-200" },
  below: { label: "below", cls: "bg-gray-700 text-gray-200" },
  clear: { label: "apart", cls: "text-gray-400 border border-gray-600" },
};

const MAX_ROWS = 40;

const m = (v: number) => `${v >= 0 ? "" : "−"}${Math.abs(v).toFixed(v !== 0 && Math.abs(v) < 10 ? 1 : 0)}`;

function rowLabel(r: ClearanceRow): string {
  const name = r.feature.properties.name;
  if (r.status === "conflict") return `${name}\nCONFLICT · overlap ${Math.abs(r.vertical).toFixed(1)} m vertical`;
  if (r.status === "clear") {
    const v = r.vertical >= 0 ? `, ${r.vertical.toFixed(1)} m vertical gap` : "";
    return `${name}\n${r.horizontal.toFixed(1)} m horizontal${v}`;
  }
  return `${name}\n${r.vertical.toFixed(1)} m ${r.status === "above" ? "above" : "below"}`;
}

/** Clearance of the selected feature against all other visible features. */
export const ClearancePanel = ({ feature }: { feature: AnalysisFeature }) => {
  const {
    scenario,
    opeaFilter,
    resolveLimits,
    limitsVersion,
    clearanceHighlight,
    setClearanceHighlight,
    selectFeature,
    flyTo,
  } = useAnalysis();
  const [radius, setRadius] = useState(1000);
  const [hideApart, setHideApart] = useState(false);

  const result = useMemo(() => {
    void limitsVersion; // recompute when terrain-dependent limits change
    if (!scenario) return null;
    const refLimits = resolveLimits(feature.id);
    if (!refLimits) return null;
    const candidates = scenario.layers
      .filter((l) => l.visible)
      .flatMap((l) =>
        l.features
          .filter((f) => f.id !== feature.id)
          .filter(
            (f) =>
              f.properties.category !== "opea" ||
              (!opeaFilter.hiddenTypes.includes(f.properties.attributes.aixm_code ?? "OTHER") &&
                opeaHeight(f) >= opeaFilter.minHeight),
          )
          .map((f) => ({ feature: f, layerName: l.name, limits: resolveLimits(f.id) })),
      )
      .filter((c): c is typeof c & { limits: NonNullable<typeof c.limits> } => c.limits !== undefined);
    const rows = sortClearance(computeClearance(feature, refLimits, candidates));
    return { rows, refLimits };
  }, [feature, scenario, opeaFilter, resolveLimits, limitsVersion]);

  if (!result) {
    return <div className="text-[11px] text-gray-500">Clearance unavailable: this feature has no altitude limits yet.</div>;
  }

  const inRange = result.rows.filter((r) => r.horizontal <= radius && (!hideApart || r.status !== "clear"));
  const conflicts = result.rows.filter((r) => r.status === "conflict").length;
  const shown = inRange.slice(0, MAX_ROWS);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-white">Clearance</span>
        <span className={`text-[10px] px-1.5 rounded ${conflicts ? "bg-red-600 text-white" : "bg-green-700 text-white"}`}>
          {conflicts ? `${conflicts} conflict${conflicts > 1 ? "s" : ""}` : "no conflicts"}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-gray-400">
        within
        <input
          type="number"
          min={0}
          step={100}
          value={radius}
          onChange={(e) => setRadius(parseFloat(e.target.value) || 0)}
          className="w-16 rounded bg-gray-900 border border-gray-600 px-1 py-0.5 text-white"
        />
        m
        <label className="flex items-center gap-1 ml-auto">
          <input type="checkbox" checked={hideApart} onChange={(e) => setHideApart(e.target.checked)} />
          only overlapping
        </label>
      </div>
      <div className="text-[10px] text-gray-500 grid grid-cols-[4.2rem_1fr_3rem_3rem] gap-x-1">
        <span />
        <span>feature</span>
        <span className="text-right">horiz m</span>
        <span className="text-right">vert m</span>
      </div>
      <div className="max-h-64 overflow-y-auto space-y-0.5">
        {shown.length === 0 && <div className="text-[11px] text-gray-500">Nothing within {radius} m.</div>}
        {shown.map((r) => {
          const active = clearanceHighlight?.label === rowLabel(r);
          return (
            <button
              key={r.feature.id}
              title={`${r.layerName}\nClick: show on map · Double-click: select`}
              onClick={() =>
                setClearanceHighlight(
                  active ? null : { a: r.a, b: r.b, label: rowLabel(r), conflict: r.status === "conflict" },
                )
              }
              onDoubleClick={() => {
                selectFeature(r.feature.id);
                flyTo(r.feature.id);
              }}
              className={`w-full grid grid-cols-[4.2rem_1fr_3rem_3rem] gap-x-1 items-center text-[11px] px-1 rounded text-start ${active ? "bg-blue-900/60" : "hover:bg-gray-700"}`}
            >
              <span className={`text-[9px] px-1 rounded text-center ${STATUS_STYLE[r.status].cls}`}>
                {STATUS_STYLE[r.status].label}
              </span>
              <span className="truncate text-gray-200">{r.feature.properties.name}</span>
              <span className="text-right text-gray-300">{m(r.horizontal)}</span>
              <span className={`text-right ${r.vertical < 0 ? "text-red-400" : "text-gray-300"}`}>{m(r.vertical)}</span>
            </button>
          );
        })}
      </div>
      {inRange.length > MAX_ROWS && (
        <div className="text-[10px] text-gray-500">
          Showing {MAX_ROWS} of {inRange.length}. Reduce the radius to narrow down.
        </div>
      )}
      <div className="text-[10px] text-gray-500">
        vert &gt; 0: gap between altitude bands · vert &lt; 0: bands overlap. Conflict = footprints and bands both overlap.
      </div>
    </div>
  );
};
