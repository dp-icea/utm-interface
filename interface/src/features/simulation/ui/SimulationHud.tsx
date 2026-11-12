import { useEffect, useState } from "react";
import { Crosshair, Eye, EyeOff, Pause, Play, RotateCcw } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { SIM_SPEEDS, formatAgl, type SimLive } from "../lib/sim-entity-manager";
import { KIND_COLORS, KIND_LABELS } from "../lib/style";
import { useSimulation } from "../model/context";

const REFRESH_MS = 250;

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${h ? `${h}:` : ""}${pad(m)}:${pad(s % 60)}`;
}

const IconButton = ({
  onClick,
  title,
  active,
  children,
}: {
  onClick: () => void;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}) => (
  <button
    onClick={onClick}
    title={title}
    className={cn(
      "rounded p-1.5 text-gray-300 hover:bg-gray-700 hover:text-white",
      active && "bg-blue-600 text-white hover:bg-blue-500",
    )}
  >
    {children}
  </button>
);

/** Playback controls and traffic list, shown only for scenarios with a simulation. */
export const SimulationHud = () => {
  const {
    manager,
    playing,
    setPlaying,
    speed,
    setSpeed,
    showRoutes,
    setShowRoutes,
    selectedId,
    followId,
    setFollowId,
    reset,
  } = useSimulation();
  const [live, setLive] = useState<SimLive[]>([]);
  const [time, setTime] = useState(0);

  useEffect(() => {
    if (!manager) return;
    const update = () => {
      setLive(manager.live());
      setTime(manager.simTime);
    };
    update();
    const id = setInterval(update, REFRESH_MS);
    return () => clearInterval(id);
  }, [manager]);

  if (!manager) return null;
  const violations = live.filter((l) => !l.status.ok).length;

  return (
    <div className="absolute bottom-4 left-4 z-10 w-72 rounded-lg bg-gray-900/90 text-xs text-white backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-gray-700 px-3 py-2">
        <span className="font-semibold">Simulation</span>
        <span className="font-mono text-gray-300">T+{formatClock(time)}</span>
      </div>

      <div className="flex items-center gap-1 border-b border-gray-700 px-2 py-1.5">
        <IconButton onClick={() => setPlaying(!playing)} title={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </IconButton>
        <IconButton onClick={reset} title="Restart from T+00:00">
          <RotateCcw className="h-4 w-4" />
        </IconButton>
        <div className="mx-1 flex overflow-hidden rounded border border-gray-700">
          {SIM_SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={cn("px-2 py-1 font-mono", s === speed ? "bg-blue-600" : "text-gray-300 hover:bg-gray-700")}
            >
              {s}×
            </button>
          ))}
        </div>
        <IconButton onClick={() => setShowRoutes(!showRoutes)} title={showRoutes ? "Hide routes" : "Show routes"}>
          {showRoutes ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </IconButton>
      </div>

      <ul className="max-h-64 overflow-y-auto py-1">
        {live.map(({ entity, sample, status }) => (
          <li
            key={entity.id}
            className={cn(
              "flex cursor-pointer items-center gap-2 px-3 py-1 hover:bg-gray-800",
              selectedId === entity.id && "bg-gray-800",
            )}
            onClick={() => {
              manager.select(entity.id);
              if (followId !== entity.id) manager.flyTo(entity.id);
            }}
            title={status.reason ?? KIND_LABELS[entity.kind]}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: status.ok ? (entity.color ?? KIND_COLORS[entity.kind]) : "#ef4444" }}
            />
            <span className="w-20 truncate font-medium">{entity.callsign}</span>
            <span className={cn("flex-1 font-mono", status.ok ? "text-gray-300" : "text-red-400")}>
              {formatAgl(sample)}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setFollowId(followId === entity.id ? null : entity.id);
              }}
              title={followId === entity.id ? "Stop following" : "Follow with the camera"}
              className={cn(
                "rounded p-1 text-gray-400 hover:text-white",
                followId === entity.id && "bg-blue-600 text-white",
              )}
            >
              <Crosshair className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>

      {violations > 0 && (
        <div className="border-t border-gray-700 px-3 py-1.5 text-red-400">
          {violations} aircraft outside conformance
        </div>
      )}
    </div>
  );
};
