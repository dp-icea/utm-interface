"""File-backed store for analysis scenarios (backend/data/scenarios/*.json)."""

import re
from pathlib import Path

from domain.scenario import Scenario, ScenarioSummary

DEFAULT_DIR = Path(__file__).resolve().parent.parent / "data" / "scenarios"
_SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,99}$")


class ScenarioStore:
    def __init__(self, directory: Path = DEFAULT_DIR):
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)

    def _path(self, scenario_id: str) -> Path:
        if not _SAFE_ID.match(scenario_id):
            raise ValueError(f"Invalid scenario id: {scenario_id!r}")
        return self.directory / f"{scenario_id}.json"

    def list(self) -> list[ScenarioSummary]:
        out = []
        for path in sorted(self.directory.glob("*.json")):
            s = Scenario.model_validate_json(path.read_text())
            out.append(
                ScenarioSummary(
                    id=s.id,
                    name=s.name,
                    description=s.description,
                    created_at=s.created_at,
                    layer_count=len(s.layers),
                    feature_count=sum(len(layer.features) for layer in s.layers),
                )
            )
        return out

    def get(self, scenario_id: str) -> Scenario | None:
        path = self._path(scenario_id)
        if not path.exists():
            return None
        return Scenario.model_validate_json(path.read_text())

    def exists(self, scenario_id: str) -> bool:
        return self._path(scenario_id).exists()

    def save(self, scenario: Scenario) -> Scenario:
        self._path(scenario.id).write_text(scenario.model_dump_json(indent=1))
        return scenario
