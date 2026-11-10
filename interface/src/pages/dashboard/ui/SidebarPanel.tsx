import { ClientList } from "./sidebar/ClientListPanel";
import { OperationalFiltersPanel } from "./sidebar/OperationalFiltersPanel";
import { FlightTrackingPanel } from "./sidebar/FlightTrackingPanel";
import { AnalysisLayersPanel } from "@/features/analysis";

export const SidebarPanel = () => {
  return (
    <div className="w-80 bg-gray-800 border-gray-700 h-screen overflow-y-auto">
      <div className="text-white space-y-4 p-4">
        {/* <ConstraintManagementPanel /> */}
        <ClientList />
        <OperationalFiltersPanel />
        {/*<NotificationPanel />*/}
        <FlightTrackingPanel />
        <AnalysisLayersPanel />
      </div>
    </div>
  );
};
