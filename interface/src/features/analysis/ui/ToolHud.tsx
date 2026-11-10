import { useAnalysis } from "../model/use-analysis";

const HINTS = {
  measure: "Measuring: click two points · a third click starts over · right-click / Esc exit",
} as const;

/** Instruction bar shown while a map tool is active. Render inside the map container. */
export const ToolHud = () => {
  const { toolMode } = useAnalysis();
  if (toolMode === "none") return null;
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 rounded-lg bg-blue-900/90 px-4 py-2 text-xs text-white">
      {HINTS[toolMode]}
    </div>
  );
};
