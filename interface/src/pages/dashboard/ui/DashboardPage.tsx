import { useEffect, useState } from "react";
import { Header } from "./Header";
import { MapViewer } from "./MapViewer";
import { SidebarPanel } from "./SidebarPanel";
import { TimelineBar } from "./TimelineBar";
import { MapProvider } from "@/shared/lib/map";
import { AnalysisProvider, HeightProbeHud } from "@/features/analysis";

const FloatingClock = () => {
  const [zuluTime, setZuluTime] = useState("");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const hours = now.getUTCHours().toString().padStart(2, "0");
      const minutes = now.getUTCMinutes().toString().padStart(2, "0");
      const seconds = now.getUTCSeconds().toString().padStart(2, "0");
      setZuluTime(`${hours}:${minutes}:${seconds}Z`);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);
  return (
    <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-gray-800/90 backdrop-blur-sm rounded-lg px-8 py-4 z-10">
      <div className="text-center">
        <div className="text-xl font-mono text-white font-semibold">
          {zuluTime}
        </div>
      </div>
    </div>
  );
};

export const DashboardPage = () => {
  return (
    <MapProvider>
      <AnalysisProvider>
      <div className="min-h-screen flex w-full bg-gray-900">
        <SidebarPanel />
        <div className="flex flex-1 flex-col">
          <Header />
          <main className="flex-1 flex flex-col relative">
            <div className="flex-1 relative">
              <MapViewer />
              <FloatingClock />
              <HeightProbeHud />
            </div>
            <TimelineBar />
          </main>
        </div>
      </div>
      </AnalysisProvider>
    </MapProvider>
  );
};
