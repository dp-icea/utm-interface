import { useState, useEffect } from "react";
import { Badge } from "@/shared/ui/badge";
import { Checkbox } from "@/shared/ui/checkbox";
import { Radio } from "lucide-react";
import type { LatLngPoint, RIDOperationalStatus } from "@/shared/model";
import { useMap } from "@/shared/lib/map";

interface FlightDetail {
  id: string;
  uasId: string;
  operator: string;
  description: string;
  aircraftType: string;
  status: RIDOperationalStatus;
  position: LatLngPoint;
  operatorPosition?: LatLngPoint;
  speed: number;
  vertical_speed: number;
  pressure_altitude: number;
  owner: string;
  active: boolean;
}

interface FlightProvider {
  name: string;
  active: boolean;
}

export const FlightTrackingPanel = () => {
  const { isLive, flights, setFlightsFilter, setFlightProvidersFilter } =
    useMap();

  const [flightDetails, setFlightDetails] = useState<FlightDetail[]>([]);
  const [flightProviders, setFlightProviders] = useState<FlightProvider[]>([]);

  const toggleFlightDetail = (flightId: string) => {
    const newFlightDetails = flightDetails.map((flight) => {
      if (flight.id === flightId) {
        return { ...flight, active: !flight.active };
      }
      return flight;
    });

    setFlightDetails(newFlightDetails);

    setFlightsFilter(
      newFlightDetails
        .filter((flight) => flight.active)
        .map((flight) => flight.id),
    );
  };

  const toggleProvider = (providerName: string) => {
    const newFlightProviders = flightProviders.map((provider) => {
      if (provider.name === providerName) {
        return { ...provider, active: !provider.active };
      }
      return provider;
    });

    setFlightProviders(newFlightProviders);

    setFlightProvidersFilter(
      newFlightProviders
        .filter((provider) => provider.active)
        .map((provider) => provider.name),
    );
  };

  const isArrayEmpty = (obj: Array<any>) =>
    obj && Array.isArray(obj) && obj.length === 0;

  const getStatusColor = (status: RIDOperationalStatus) => {
    switch (status) {
      case "Undeclared":
        return "bg-gray-500";
      case "Ground":
        return "bg-gray-400";
      case "Airborne":
        return "bg-green-500";
      case "Emergency":
        return "bg-red-500";
      case "RemoteIDSystemFailure":
        return "bg-yellow-500";
      default:
        return "bg-gray-500";
    }
  };

  const onFlightsUpdate = () => {
    console.log("Flights updated:", flights);

    const currentFlightProviders: Record<string, FlightProvider> = {};
    const currentFlightDetails: Record<string, FlightDetail> = {};

    flightProviders.forEach((provider) => {
      currentFlightProviders[provider.name] = {
        ...provider,
      };
    });

    flightDetails.forEach((flight) => {
      currentFlightDetails[flight.id] = {
        ...flight,
      };
    });

    const newFlightProviders: Record<string, FlightProvider> = {};
    const newFlightDetails: Record<string, FlightDetail> = {};

    flights.forEach((flight) => {
      const providerName = flight.identification_service_area.owner;
      if (currentFlightProviders[providerName]) {
        newFlightProviders[providerName] = {
          ...currentFlightProviders[providerName],
        };
      } else {
        newFlightProviders[providerName] = {
          name: providerName,
          active: true,
        };
      }

      if (currentFlightDetails[flight.id]) {
        newFlightDetails[flight.id] = {
          ...currentFlightDetails[flight.id],
        };
      } else {
        newFlightDetails[flight.id] = {
          id: flight.id,
          operator: flight.details?.operator_id || "Unknown",
          description: flight.details?.operation_description || "N/A",
          aircraftType: flight.aircraft_type,
          status: flight.current_state.operational_status,
          position: flight.current_state.position,
          operatorPosition: flight.details?.operator_location || undefined,
          speed: flight.current_state.speed,
          vertical_speed: flight.current_state.vertical_speed,
          pressure_altitude: flight.current_state.position.pressure_altitude,
          owner: flight.identification_service_area.owner,
          uasId: flight.details?.uas_id.registration_id || "Unknown",
          active: true,
        };
      }
    });

    setFlightProviders(Object.values(newFlightProviders));
    setFlightDetails(Object.values(newFlightDetails));

    setFlightsFilter(
      Object.keys(newFlightDetails).filter((id) => newFlightDetails[id].active),
    );
    setFlightProvidersFilter(
      Object.keys(newFlightProviders).filter(
        (name) => newFlightProviders[name].active,
      ),
    );
  };

  useEffect(onFlightsUpdate, [flights]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Radio className="h-4 w-4 text-gray-400" />
          <span className="text-sm font-medium text-white">
            Live Flight Tracking
          </span>
        </div>
        {isLive && isArrayEmpty(flights) && (
          <Badge variant="default" className="text-xs">
            {flights.length} active
          </Badge>
        )}
      </div>

      {!isLive && isArrayEmpty(flights) && (
        <div className="p-3 rounded-lg border bg-gray-750 border-gray-600">
          <span className="text-xs text-gray-400">
            Toggle Live mode to see real-time flight data.
          </span>
        </div>
      )}

      {isLive && isArrayEmpty(flights) && (
        <div className="p-3 rounded-lg border bg-gray-750 border-gray-600">
          <span className="text-xs text-gray-400">
            No flights detected in the area.
          </span>
        </div>
      )}

      {/* Provider Selection */}
      {isLive && !isArrayEmpty(flights) && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-gray-300 justify-start">
            Select Providers:
          </span>
          <div className="space-y-1">
            {flightProviders.map((provider) => (
              <div key={provider.name} className="flex items-center space-x-2">
                <Checkbox
                  id={provider.name}
                  checked={provider.active}
                  onCheckedChange={() => toggleProvider(provider.name)}
                />
                <label
                  htmlFor={provider.name}
                  className="text-xs cursor-pointer text-gray-300"
                >
                  {provider.name.toUpperCase()}
                </label>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Flight List */}
      {isLive && !isArrayEmpty(flights) && (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {flightDetails.map((flight) => (
            <div
              key={flight.id}
              className={`p-3 rounded-lg border transition-colors ${
                flight.active
                  ? "bg-blue-900/30 border-blue-600"
                  : "bg-gray-750 border-gray-600 hover:bg-gray-700"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    checked={flight.active}
                    onCheckedChange={() => toggleFlightDetail(flight.id)}
                  />
                  <span className="text-sm font-medium text-white">
                    {flight.uasId}
                  </span>
                  <div
                    className={`w-2 h-2 rounded-full ${getStatusColor(flight.status)}`}
                  />
                </div>
                <Badge
                  variant={
                    flight.status === "Emergency" ? "destructive" : "secondary"
                  }
                  className="text-xs px-2 py-0"
                >
                  {flight.status}
                </Badge>
              </div>

              <div className="text-xs text-gray-400 mb-2">
                {flight.operator}
              </div>
              <div className="text-xs text-gray-400 mb-2">{flight.owner}</div>
              <div className="text-xs text-gray-400 mb-2">
                {flight.description}
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center space-x-1">
                  <span>Type: {flight.aircraftType}</span>
                </div>
                <div className="flex items-center space-x-1">
                  <span>Speed: {flight.speed.toFixed(3)}</span>
                </div>
                <div className="flex items-center space-x-1">
                  <span>V. Speed: {flight.vertical_speed}</span>
                </div>
                {flight.operatorPosition && (
                  <div className="flex items-center space-x-1">
                    <span>
                      Op. Lat: {flight.operatorPosition.lat.toFixed(2)}°
                    </span>
                  </div>
                )}
                {flight.operatorPosition && (
                  <div className="flex items-center space-x-1">
                    <span>
                      Op. Lng: {flight.operatorPosition.lng.toFixed(2)}°
                    </span>
                  </div>
                )}
              </div>

              <div className="text-xs mt-2 text-gray-500">
                {flight.position.lat.toFixed(4)}°,{" "}
                {flight.position.lng.toFixed(4)}°
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Quick Actions */}
      {isLive && !isArrayEmpty(flights) && (
        <div className="pt-2 border-t border-gray-600">
          <div className="flex gap-2">
            <button
              onClick={() => {
                const newFlightDetails = flightDetails.map((f) => ({
                  ...f,
                  active: true,
                }));
                setFlightDetails(newFlightDetails);
                setFlightsFilter(newFlightDetails.map((f) => f.id));
              }}
              className="text-xs px-2 py-1 rounded text-blue-400 hover:bg-gray-700"
            >
              Select All
            </button>
            <button
              onClick={() => {
                const newFlightDetails = flightDetails.map((f) => ({
                  ...f,
                  active: false,
                }));
                setFlightDetails(newFlightDetails);
                setFlightsFilter([]);
              }}
              className="text-xs px-2 py-1 rounded text-gray-400 hover:bg-gray-700"
            >
              Clear All
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
