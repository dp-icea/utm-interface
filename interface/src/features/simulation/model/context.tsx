import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { SimEntityManager } from "../lib/sim-entity-manager";

interface SimulationState {
  /** The running manager, or null when the scenario has no simulation. */
  manager: SimEntityManager | null;
  setManager: (m: SimEntityManager | null) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  speed: number;
  setSpeed: (s: number) => void;
  showRoutes: boolean;
  setShowRoutes: (v: boolean) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  followId: string | null;
  setFollowId: (id: string | null) => void;
  reset: () => void;
}

const SimulationContext = createContext<SimulationState | null>(null);

export const SimulationProvider = ({ children }: { children: ReactNode }) => {
  const [manager, setManagerState] = useState<SimEntityManager | null>(null);
  const [playing, setPlayingState] = useState(true);
  const [speed, setSpeedState] = useState(1);
  const [showRoutes, setShowRoutesState] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [followId, setFollowIdState] = useState<string | null>(null);
  const ref = useRef<SimEntityManager | null>(null);
  // Read the latest settings when a new manager attaches.
  const settings = useRef({ playing, speed, showRoutes });
  settings.current = { playing, speed, showRoutes };

  const setManager = useCallback((m: SimEntityManager | null) => {
    ref.current = m;
    if (m) {
      m.setPlaying(settings.current.playing);
      m.setSpeed(settings.current.speed);
      m.setRoutesVisible(settings.current.showRoutes);
    } else {
      setSelectedId(null);
      setFollowIdState(null);
    }
    setManagerState(m);
  }, []);

  const setPlaying = useCallback((p: boolean) => {
    ref.current?.setPlaying(p);
    setPlayingState(p);
  }, []);
  const setSpeed = useCallback((s: number) => {
    ref.current?.setSpeed(s);
    setSpeedState(s);
  }, []);
  const setShowRoutes = useCallback((v: boolean) => {
    ref.current?.setRoutesVisible(v);
    setShowRoutesState(v);
  }, []);
  const setFollowId = useCallback((id: string | null) => {
    ref.current?.follow(id);
    setFollowIdState(id);
  }, []);
  const reset = useCallback(() => ref.current?.reset(), []);

  const value = useMemo(
    () => ({
      manager,
      setManager,
      playing,
      setPlaying,
      speed,
      setSpeed,
      showRoutes,
      setShowRoutes,
      selectedId,
      setSelectedId,
      followId,
      setFollowId,
      reset,
    }),
    [manager, setManager, playing, setPlaying, speed, setSpeed, showRoutes, setShowRoutes, selectedId, followId, setFollowId, reset],
  );

  return <SimulationContext.Provider value={value}>{children}</SimulationContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useSimulation = () => {
  const ctx = useContext(SimulationContext);
  if (!ctx) throw new Error("useSimulation must be used within a SimulationProvider");
  return ctx;
};
