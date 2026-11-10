"""Analysis scenarios: imported KML/KMZ layers, OPEAs and drawn volumes."""

from http import HTTPStatus
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile

from adapters.kml_importer import feature_warnings, import_kml
from domain.scenario import Scenario
from infrastructure.scenario_store import ScenarioStore
from schemas.api import ApiException, ApiResponse

router = APIRouter()

MAX_UPLOAD_BYTES = 50 * 1024 * 1024


def get_store() -> ScenarioStore:
    return ScenarioStore()


def _not_found(scenario_id: str) -> ApiException:
    return ApiException(
        status_code=HTTPStatus.NOT_FOUND.value,
        message=f"Scenario {scenario_id} not found",
    )


@router.get("", response_model=ApiResponse)
async def list_scenarios(store: ScenarioStore = Depends(get_store)):
    scenarios = store.list()
    return ApiResponse(
        message=f"{len(scenarios)} scenarios", data=[s.model_dump() for s in scenarios]
    )


@router.get("/{scenario_id}", response_model=ApiResponse)
async def get_scenario(scenario_id: str, store: ScenarioStore = Depends(get_store)):
    scenario = store.get(scenario_id)
    if scenario is None:
        raise _not_found(scenario_id)
    return ApiResponse(message="Scenario retrieved", data=scenario.model_dump(mode="json"))


@router.post("/import", response_model=ApiResponse)
async def import_scenario(
    file: UploadFile = File(...),
    scenario_id: Optional[str] = Form(None),
    name: Optional[str] = Form(None),
    save: bool = Form(False),
    store: ScenarioStore = Depends(get_store),
):
    """Parse a KML/KMZ into a scenario. With save=true it is also persisted
    (refusing to overwrite an existing id)."""
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise ApiException(status_code=413, message="File too large")
    try:
        scenario, warnings = import_kml(
            file.filename or "upload.kml", content, scenario_id=scenario_id, name=name
        )
    except Exception as e:  # malformed XML / zip
        raise ApiException(status_code=400, message=f"Could not parse file: {e}")

    if save:
        if store.exists(scenario.id):
            raise ApiException(
                status_code=HTTPStatus.CONFLICT.value,
                message=f"Scenario {scenario.id} already exists",
            )
        store.save(scenario)

    return ApiResponse(
        message=f"Imported {sum(len(l.features) for l in scenario.layers)} features",
        data={
            "scenario": scenario.model_dump(mode="json"),
            "warnings": warnings + feature_warnings(scenario.layers),
        },
    )


@router.put("/{scenario_id}", response_model=ApiResponse)
async def save_scenario(
    scenario_id: str, scenario: Scenario, store: ScenarioStore = Depends(get_store)
):
    if scenario.id != scenario_id:
        raise ApiException(status_code=400, message="Body id does not match path id")
    try:
        store.save(scenario)
    except ValueError as e:
        raise ApiException(status_code=400, message=str(e))
    return ApiResponse(message="Scenario saved", data={"id": scenario.id})
