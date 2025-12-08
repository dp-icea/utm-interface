# New airspace routes with better naming and hexagonal architecture
from http import HTTPStatus
from fastapi import APIRouter, Body, Depends
import json
import time
import os
from datetime import datetime
from typing import List

from application.airspace_use_case import AirspaceQueryUseCase
from adapters.dss_adapter import DSSAdapter
from adapters.uss_adapter import USSAdapter
from adapters.flights_adapter import FlightsAdapter
from domain.base import Volume4D, Volume3D, Altitude, Polygon, LatLngPoint, Time
from domain.airspace import AirspaceAllocations, AirspaceFlights
from domain.flights import Flight
from domain.external.uss.common import OperationalIntent, OperationalIntentDetails, Constraint, ConstraintDetails
from domain.external.uss.remoteid import RIDFlight, RIDAircraftState, RIDAircraftPosition, RIDFlightDetails, UASID, RIDAuthData
from domain.external.dss.common import OperationalIntentReference, ConstraintReference
from domain.external.dss.remoteid import IdentificationServiceArea
from schemas.api import ApiResponse
from schemas.requests.flights import QueryFlightsRequest
from schemas.enums import (
    AltitudeReference, AltitudeUnits, UAType, RIDOperationalStatus, 
    OperationalIntentState, UssAvailabilityState, SpeedAccuracy
)
from uuid import uuid4, UUID
import hashlib

router = APIRouter()

# Load mock scenarios
def load_mock_scenarios():
    scenarios = []
    for i in range(1, 4):
        with open(f"mock_scenarios/{i}.geojson", "r") as f:
            scenarios.append(json.load(f))
    return scenarios

MOCK_SCENARIOS = load_mock_scenarios()

def generate_deterministic_uuid(coordinates, state) -> UUID:
    """Generate a deterministic UUID based on geometry coordinates and state"""
    # Create a string representation of the coordinates and state
    coord_str = str(sorted(coordinates))
    state_str = str(state)
    combined_str = f"{coord_str}_{state_str}"
    
    # Create a hash of the coordinates and state
    hash_obj = hashlib.md5(combined_str.encode())
    hash_hex = hash_obj.hexdigest()
    
    # Convert to UUID format (8-4-4-4-12)
    uuid_str = f"{hash_hex[:8]}-{hash_hex[8:12]}-{hash_hex[12:16]}-{hash_hex[16:20]}-{hash_hex[20:32]}"
    
    return UUID(uuid_str)

def get_current_scenario():
    """Get current scenario with complex activation sequence"""
    current_time = int(time.time())
    step_index = (current_time // 10)  # Change every 10 seconds
    
    # Calculate which base scenario and activation step we're in
    # Scenario 0: Empty scenario (1 step)
    # Scenario 1: Step-by-step activation (reduced steps)
    # Scenario 2: Always all activated
    # Scenario 3: Always all activated
    scenario_index = 0
    activation_step = 0
    
    # Count operational intents in scenario 1 for activation steps
    scenario_1_oi_count = sum(1 for f in MOCK_SCENARIOS[0]["features"] if f["properties"]["type"] == "Operational Intent")
    
    # Calculate steps for each scenario:
    # Scenario 0: 1 step (empty scenario)
    # Scenario 1: oi_count + 1 steps (ACCEPTED + individual activations)
    # Scenario 2: 1 step (always all activated)
    # Scenario 3: 1 step (always all activated)
    scenario_0_steps = 1  # Empty scenario
    scenario_1_steps = scenario_1_oi_count + 1  # Full progression: ACCEPTED then activate each OI individually
    scenario_2_steps = 1
    scenario_3_steps = 1
    
    total_steps = scenario_0_steps + scenario_1_steps + scenario_2_steps + scenario_3_steps
    
    # Determine current position in the cycle
    current_step = step_index % total_steps
    
    # Find which scenario and activation step we're in
    if current_step < scenario_0_steps:
        # Empty scenario
        scenario_index = -1  # Special flag for empty scenario
        activation_step = 0
    elif current_step < scenario_0_steps + scenario_1_steps:
        # Scenario 1 (original scenario 1)
        scenario_index = 0
        activation_step = current_step - scenario_0_steps
    elif current_step < scenario_0_steps + scenario_1_steps + scenario_2_steps:
        # Scenario 2 (original scenario 2) - always all activated
        scenario_index = 1
        activation_step = -1  # Special flag for "all activated"
    else:
        # Scenario 3 (original scenario 3) - always all activated
        scenario_index = 2
        activation_step = -1  # Special flag for "all activated"
    
    # Return empty scenario for scenario_index -1
    if scenario_index == -1:
        empty_scenario = {"type": "FeatureCollection", "features": []}
        return empty_scenario, scenario_index, activation_step
    
    return MOCK_SCENARIOS[scenario_index], scenario_index, activation_step

def convert_geojson_to_operational_intent(feature, index, scenario_index, activation_step) -> OperationalIntent:
    """Convert GeoJSON feature to OperationalIntent domain model"""
    coordinates = feature["geometry"]["coordinates"][0]  # Polygon coordinates
    vertices = [LatLngPoint(lng=coord[0], lat=coord[1]) for coord in coordinates[:-1]]  # Remove last duplicate point
    
    polygon = Polygon(vertices=vertices)
    volume3d = Volume3D(
        outline_polygon=polygon,
        altitude_lower=Altitude(value=680, reference=AltitudeReference.W84, units=AltitudeUnits.M),
        altitude_upper=Altitude(value=780, reference=AltitudeReference.W84, units=AltitudeUnits.M)
    )
    
    volume4d = Volume4D(
        volume=volume3d,
        time_start=Time(value=datetime.now()),
        time_end=Time(value=datetime.now())
    )
    
    # Complex activation logic:
    # Scenario 1 (index 1) and Scenario 2 (index 2): All OIs always ACTIVATED
    # Scenario 0 (index 0): Step-by-step activation (ACCEPTED -> activate each OI individually)
    if scenario_index == 1 or scenario_index == 2:  # Scenarios 2 and 3
        state = OperationalIntentState.ACTIVATED
    elif scenario_index == 0:  # Scenario 1 (step-by-step)
        if activation_step == 0:
            state = OperationalIntentState.ACCEPTED
        else:
            # Activate OIs one by one: step 1 activates OI 0, step 2 activates OI 1, etc.
            state = OperationalIntentState.ACTIVATED if index < activation_step else OperationalIntentState.ACCEPTED
    else:
        # Default fallback
        state = OperationalIntentState.ACCEPTED
    
    # Generate deterministic UUID based on geometry coordinates and state
    deterministic_id = generate_deterministic_uuid(coordinates, state)
    
    reference = OperationalIntentReference(
        id=deterministic_id,
        manager="mock_uss",
        uss_base_url="http://mock-uss.com",
        version=1,
        state=state,
        ovn="mock_ovn",
        time_start=Time(value=datetime.now()),
        time_end=Time(value=datetime.now()),
        uss_availability=UssAvailabilityState.UNKNOWN
    )
    
    details = OperationalIntentDetails(volumes=[volume4d], priority=0)
    
    return OperationalIntent(reference=reference, details=details)

def convert_geojson_to_constraint(feature, index) -> Constraint:
    """Convert GeoJSON feature to Constraint domain model"""
    coordinates = feature["geometry"]["coordinates"][0]  # Polygon coordinates
    vertices = [LatLngPoint(lng=coord[0], lat=coord[1]) for coord in coordinates[:-1]]  # Remove last duplicate point
    
    polygon = Polygon(vertices=vertices)
    volume3d = Volume3D(
        outline_polygon=polygon,
        altitude_lower=Altitude(value=680, reference=AltitudeReference.W84, units=AltitudeUnits.M),
        altitude_upper=Altitude(value=780, reference=AltitudeReference.W84, units=AltitudeUnits.M)
    )
    
    volume4d = Volume4D(
        volume=volume3d,
        time_start=Time(value=datetime.now()),
        time_end=Time(value=datetime.now())
    )
    
    # Generate deterministic UUID based on geometry coordinates (constraints don't change state)
    deterministic_id = generate_deterministic_uuid(coordinates, "CONSTRAINT")
    
    reference = ConstraintReference(
        id=deterministic_id,
        manager="mock_uss",
        uss_base_url="http://mock-uss.com",
        version=1,
        ovn="mock_ovn",
        time_start=Time(value=datetime.now()),
        time_end=Time(value=datetime.now()),
        uss_availability=UssAvailabilityState.UNKNOWN
    )
    
    details = ConstraintDetails(volumes=[volume4d], type="RESTRICTION")
    
    return Constraint(reference=reference, details=details)

def convert_geojson_to_flight(feature, index) -> Flight:
    """Convert GeoJSON drone location to Flight domain model with detailed information"""
    coordinates = feature["geometry"]["coordinates"]  # Point coordinates
    
    # Drone names and operators for variety
    drone_names = ["SkyGuard-Alpha", "AeroScout-Beta", "CloudRanger-Gamma", "WindHawk-Delta"]
    operators = ["AeroLogistics Corp", "SkyTech Solutions", "DroneOps Ltd", "AirVision Systems"]
    operations = [
        "Infrastructure inspection mission",
        "Environmental monitoring survey", 
        "Emergency response patrol",
        "Cargo delivery operation"
    ]
    
    drone_name = drone_names[index % len(drone_names)]
    operator_name = operators[index % len(operators)]
    operation_desc = operations[index % len(operations)]
    
    position = RIDAircraftPosition(
        lat=coordinates[1],
        lng=coordinates[0],
        alt=730,  # 730m altitude within 680-780 range
        accuracy_h="HA3m",
        accuracy_v="VA3m",
        extrapolated=False
    )
    
    current_state = RIDAircraftState(
        timestamp=Time(value=datetime.now()),
        timestamp_accuracy=0.5,
        position=position,
        speed_accuracy=SpeedAccuracy.SA3mps,
        operational_status=RIDOperationalStatus.Airborne,
        track=45.0 + (index * 30) % 360,  # Varying headings
        speed=15.0 + (index * 2),  # Varying speeds 15-21 m/s
        vertical_speed=0.0
    )
    
    # Create detailed UAS ID
    uas_id = UASID(registration_id=f"BR-{drone_name[:4].upper()}-{1000 + index}")
    
    # Create authentication data
    auth_data = RIDAuthData(
        format=1,
        data=f"AUTH-{drone_name}-{index:03d}"
    )
    
    # Create operator location (slightly offset from drone)
    operator_location = LatLngPoint(
        lat=coordinates[1] + 0.001 * (index + 1),
        lng=coordinates[0] + 0.001 * (index + 1)
    )
    
    # Create detailed flight information
    flight_details = RIDFlightDetails(
        id=f"flight_{drone_name.lower()}_{index}",
        uas_id=uas_id,
        operator_id=f"OP-{operator_name.replace(' ', '').upper()[:8]}",
        operator_location=operator_location,
        operation_description=operation_desc,
        auth_data=auth_data
    )
    
    rid_flight = RIDFlight(
        id=flight_details.id,
        aircraft_type=UAType.Other,
        current_state=current_state,
        simulated=True
    )
    
    # Create a mock ISA
    isa = IdentificationServiceArea(
        id=f"isa_{drone_name.lower()}_{index}",
        uss_base_url="http://mock-uss.com",
        owner=operator_name,
        time_start=Time(value=datetime.now()),
        time_end=Time(value=datetime.now()),
        version="1"
    )
    
    return Flight(
        id=rid_flight.id,
        aircraft_type=rid_flight.aircraft_type,
        current_state=rid_flight.current_state,
        simulated=rid_flight.simulated,
        identification_service_area=isa,
        details=flight_details
    )

def get_airspace_query_use_case() -> AirspaceQueryUseCase:
    """Dependency injection for airspace query use case"""
    dss_adapter = DSSAdapter()
    uss_adapter = USSAdapter()
    flights_adapter = FlightsAdapter()

    return AirspaceQueryUseCase(
        airspace_references_port=dss_adapter,
        airspace_details_port=uss_adapter,
        flight_port=flights_adapter,
    )


@router.post(
    "/allocations",
    response_description="Get complete airspace allocations for an area",
    response_model=ApiResponse,
    status_code=HTTPStatus.OK.value,
)
async def get_airspace_snapshot(
    area_of_interest: Volume4D = Body(),
    use_case: AirspaceQueryUseCase = Depends(get_airspace_query_use_case),
):
    """
    Get a complete snapshot of the allocations in the airspace including:
    - Constraints (no-fly zones, restrictions)
    - Operational intents (planned flights)
    - Identification service areas (remote ID coverage)
    """
    current_scenario, scenario_index, activation_step = get_current_scenario()
    
    # Convert GeoJSON features to proper domain models
    operational_intents = []
    constraints = []
    
    oi_index = 0
    constraint_index = 0
    
    for feature in current_scenario["features"]:
        feature_type = feature["properties"]["type"]
        if feature_type == "Operational Intent":
            operational_intents.append(convert_geojson_to_operational_intent(feature, oi_index, scenario_index, activation_step))
            oi_index += 1
        elif feature_type == "Constraint":
            constraints.append(convert_geojson_to_constraint(feature, constraint_index))
            constraint_index += 1
    
    # Create AirspaceAllocations domain model
    allocations = AirspaceAllocations(
        timestamp=datetime.now(),
        area_of_interest=area_of_interest,
        constraints=constraints,
        operational_intents=operational_intents,
        identification_service_areas=[]  # Empty for mock
    )
    
    return ApiResponse(
        message=f"Mock airspace snapshot with {len(operational_intents)} operational intents and {len(constraints)} constraints",
        data=allocations,
    )


@router.post(
    "/flights",
    response_description="Get active flights in an area",
    response_model=ApiResponse,
    status_code=HTTPStatus.OK.value,
)
async def get_active_flights(
    area: QueryFlightsRequest = Body(),
    use_case: AirspaceQueryUseCase = Depends(get_airspace_query_use_case),
):
    """
    Get live flight data for drones
    currently active in the specified area
    """
    current_scenario, scenario_index, activation_step = get_current_scenario()
    
    # First, determine which Operational Intents are ACTIVATED
    activated_oi_indices = []
    oi_index = 0
    
    for feature in current_scenario["features"]:
        if feature["properties"]["type"] == "Operational Intent":
            # Use same logic as convert_geojson_to_operational_intent to determine state
            if scenario_index == 1 or scenario_index == 2:  # Scenarios 2 and 3
                activated_oi_indices.append(oi_index)
            elif scenario_index == 0 and activation_step > 0 and oi_index < activation_step:  # Scenario 1 step-by-step
                activated_oi_indices.append(oi_index)
            oi_index += 1
    
    # Convert drone locations to Flight domain models only if their corresponding OI is ACTIVATED
    flights = []
    flight_index = 0
    
    for feature in current_scenario["features"]:
        if feature["properties"]["type"] == "Drone Location":
            # Only show drone if its corresponding OI is activated
            # Assume drone index corresponds to OI index (first drone -> first OI, etc.)
            if flight_index in activated_oi_indices:
                flights.append(convert_geojson_to_flight(feature, flight_index))
            flight_index += 1
    
    # Create AirspaceFlights domain model
    airspace_flights = AirspaceFlights(
        timestamp=datetime.now(),
        flights=flights
    )
    
    return ApiResponse(
        message=f"Mock flight data with {len(flights)} active flights at 730m altitude",
        data=airspace_flights,
    )
