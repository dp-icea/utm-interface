"""Analysis scenario model: imported/drawn airspace volumes and obstacles.

Unlike BR-UTM volumes (always W84), analysis features keep the datum they
were declared in (KML "absolute" is MSL, relativeToGround is AGL) and the
viewer converts them at render time.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class Datum(str, Enum):
    MSL = "MSL"
    W84 = "W84"
    AGL = "AGL"


class FeatureCategory(str, Enum):
    UTM_ZONE = "utm_zone"
    OPERATION = "operation"
    CONTINGENCY = "contingency"
    AIRPORT_RESTRICTION = "airport_restriction"
    HELIPORT_RESTRICTION = "heliport_restriction"
    RESTRICTED_AREA = "restricted_area"
    OPEA = "opea"
    REFERENCE = "reference"
    CUSTOM = "custom"


class AltitudeLimit(BaseModel):
    value: float
    datum: Datum


class Geometry(BaseModel):
    """GeoJSON geometry (Point, LineString, Polygon, MultiPolygon)."""

    type: Literal["Point", "LineString", "Polygon", "MultiPolygon"]
    coordinates: Any


class FeatureProperties(BaseModel):
    name: str = ""
    category: FeatureCategory = FeatureCategory.CUSTOM
    lower: Optional[AltitudeLimit] = None
    upper: Optional[AltitudeLimit] = None
    radius_m: Optional[float] = None
    color: Optional[str] = None
    source: Optional[str] = None
    attributes: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    notes: str = ""


class AnalysisFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    id: str
    geometry: Geometry
    properties: FeatureProperties


class AnalysisLayer(BaseModel):
    id: str
    name: str
    visible: bool = True
    features: list[AnalysisFeature] = Field(default_factory=list)


class SimEntity(BaseModel):
    """A simulated aircraft. Routes are a list of legs, expanded by the viewer:
    {"type": "waypoint", "lng", "lat" | "at_feature", "height", "hold_s"?, "speed_mps"?}
    {"type": "lawnmower", "area", "height", "spacing_m", "inset_m"?, "sortie"?, "sorties"?}
    {"type": "orbit", "center", "radius_m", "height", "turns"?, "start_bearing_deg"?, "clockwise"?}
    """

    id: str
    kind: Literal["drone", "helicopter", "plane"]
    callsign: str
    color: Optional[str] = None
    speed_mps: float
    climb_mps: Optional[float] = None
    start_offset_s: float = 0.0
    loop: Literal["pingpong", "cycle"] = "cycle"
    route: list[dict[str, Any]] = Field(default_factory=list)
    # Drones: feature ids whose union the drone must stay inside.
    conformance_volume_ids: list[str] = Field(default_factory=list)
    # Manned aircraft: layer ids whose volumes the aircraft must not enter.
    avoid_layer_ids: list[str] = Field(default_factory=list)
    notes: str = ""


class Simulation(BaseModel):
    entities: list[SimEntity] = Field(default_factory=list)


class Scenario(BaseModel):
    id: str
    name: str
    description: str = ""
    # EGM2008 geoid undulation (W84 = MSL + N) applied to MSL limits.
    # None = not set yet; the viewer then treats MSL as W84 and warns.
    geoid_undulation_m: Optional[float] = None
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    layers: list[AnalysisLayer] = Field(default_factory=list)
    # Inherit layers (and geoid) from another scenario; own layers with the
    # same id override the base ones.
    base_scenario_id: Optional[str] = None
    simulation: Optional[Simulation] = None


class ScenarioSummary(BaseModel):
    id: str
    name: str
    description: str = ""
    created_at: datetime
    layer_count: int
    feature_count: int
    has_simulation: bool = False
