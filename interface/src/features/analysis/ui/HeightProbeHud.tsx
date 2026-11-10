import { X } from "lucide-react";
import { useAnalysis } from "../model/use-analysis";
import { FT_PER_M } from "../lib/altitude";

const Row = ({ label, w84, geoid, note }: { label: string; w84: number | undefined; geoid: number; note?: string }) => (
  <div className="grid grid-cols-[5.5rem_1fr] gap-x-2">
    <span className="text-gray-400">{label}</span>
    {w84 === undefined ? (
      <span className="text-gray-500">—</span>
    ) : (
      <span>
        <b>{(w84 - geoid).toFixed(1)} m MSL</b>{" "}
        <span className="text-gray-400">
          ({Math.round((w84 - geoid) * FT_PER_M)} ft) · {w84.toFixed(1)} m W84
        </span>
        {note && <span className="text-gray-500"> {note}</span>}
      </span>
    )}
  </div>
);

/** Overlay with the current height probe reading. Render inside the map container. */
export const HeightProbeHud = () => {
  const { probeEnabled, setProbeEnabled, probe, scenario } = useAnalysis();
  if (!probeEnabled) return null;
  const geoid = scenario?.geoid_undulation_m ?? 0;
  const above =
    probe?.surfaceW84 !== undefined && probe?.terrainW84 !== undefined ? probe.surfaceW84 - probe.terrainW84 : undefined;

  return (
    <div className="absolute top-4 left-4 z-10 rounded-lg bg-gray-900/85 backdrop-blur-sm px-4 py-3 text-xs text-white font-mono space-y-1 min-w-[22rem]">
      <div className="flex items-center justify-between font-sans">
        <span className="font-semibold">
          Height probe {probe?.pinned && <span className="text-blue-400">· pinned (right-click to release)</span>}
        </span>
        <button onClick={() => setProbeEnabled(false)} className="text-gray-400 hover:text-white">
          <X className="h-3 w-3" />
        </button>
      </div>
      {!probe ? (
        <div className="text-gray-400 font-sans">Hover the map; click to pin a reading.</div>
      ) : (
        <>
          <div className="text-gray-400">
            {probe.lat.toFixed(6)}, {probe.lng.toFixed(6)}
          </div>
          <Row label="Surface" w84={probe.surfaceW84} geoid={geoid} />
          <Row label="Terrain" w84={probe.terrainW84} geoid={geoid} note={probe.precise ? "(full res)" : "(view LOD)"} />
          {above !== undefined && Math.abs(above) >= 0.5 && (
            <div className="grid grid-cols-[5.5rem_1fr] gap-x-2">
              <span className="text-gray-400">Above gnd</span>
              <span>
                {above.toFixed(1)} m ({Math.round(above * FT_PER_M)} ft)
              </span>
            </div>
          )}
          {scenario?.geoid_undulation_m == null && (
            <div className="text-amber-400 font-sans">Geoid N not set: MSL shown equal to W84.</div>
          )}
        </>
      )}
    </div>
  );
};
