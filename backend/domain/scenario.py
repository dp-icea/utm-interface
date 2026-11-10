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


class ScenarioSummary(BaseModel):
    id: str
    name: str
    description: str = ""
    created_at: datetime
    layer_count: int
    feature_count: int
