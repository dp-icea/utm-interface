"""File-backed store for analysis scenarios (backend/data/scenarios/*.json).

A scenario may set `base_scenario_id` to inherit another scenario's layers
(e.g. the simulation scenario reuses the plain sandbox airspace). On read the
base layers are merged in; on write only the layers that differ from the base
are kept, so the base file stays the single source of truth.
"""

import re
from pathlib import Path

from domain.scenario import Scenario, ScenarioSummary

DEFAULT_DIR = Path(__file__).resolve().parent.parent / "data" / "scenarios"
_SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,99}$")
_MAX_DEPTH = 5


class ScenarioStore:
    def __init__(self, directory: Path = DEFAULT_DIR):
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)

    def _path(self, scenario_id: str) -> Path:
        if not _SAFE_ID.match(scenario_id):
            raise ValueError(f"Invalid scenario id: {scenario_id!r}")
        return self.directory / f"{scenario_id}.json"

    def _read_raw(self, scenario_id: str) -> Scenario | None:
        path = self._path(scenario_id)
        if not path.exists():
            return None
        return Scenario.model_validate_json(path.read_text())

    def _resolve(self, scenario: Scenario, depth: int = 0) -> Scenario:
        if not scenario.base_scenario_id or depth >= _MAX_DEPTH:
            return scenario
        base = self._read_raw(scenario.base_scenario_id)
        if base is None or base.id == scenario.id:
            return scenario
        base = self._resolve(base, depth + 1)
        own = {layer.id: layer for layer in scenario.layers}
        merged = [own.pop(layer.id, layer) for layer in base.layers] + list(own.values())
        return scenario.model_copy(
            update={
                "layers": merged,
                "geoid_undulation_m": scenario.geoid_undulation_m
                if scenario.geoid_undulation_m is not None
                else base.geoid_undulation_m,
            }
        )

    def list(self) -> list[ScenarioSummary]:
        out = []
        for path in sorted(self.directory.glob("*.json")):
            s = self._resolve(Scenario.model_validate_json(path.read_text()))
            out.append(
                ScenarioSummary(
                    id=s.id,
                    name=s.name,
                    description=s.description,
                    created_at=s.created_at,
                    layer_count=len(s.layers),
                    feature_count=sum(len(layer.features) for layer in s.layers),
                    has_simulation=bool(s.simulation and s.simulation.entities),
                )
            )
        return out

    def get(self, scenario_id: str) -> Scenario | None:
        raw = self._read_raw(scenario_id)
        return self._resolve(raw) if raw else None

    def exists(self, scenario_id: str) -> bool:
        return self._path(scenario_id).exists()

    def save(self, scenario: Scenario) -> Scenario:
        to_write = scenario
        if scenario.base_scenario_id:
            base = self.get(scenario.base_scenario_id)
            if base is not None and base.id != scenario.id:
                base_layers = {layer.id: layer for layer in base.layers}
                own = [l for l in scenario.layers if base_layers.get(l.id) != l]
                geoid = scenario.geoid_undulation_m
                to_write = scenario.model_copy(
                    update={
                        "layers": own,
                        "geoid_undulation_m": None if geoid == base.geoid_undulation_m else geoid,
                    }
                )
        self._path(scenario.id).write_text(
            to_write.model_dump_json(indent=1, exclude_none=False)
        )
        return scenario
