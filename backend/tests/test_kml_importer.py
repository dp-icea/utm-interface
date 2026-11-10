from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from adapters.kml_importer import import_kml
from domain.scenario import Datum, FeatureCategory

KMZ = Path(__file__).resolve().parents[2] / "SandBOX_UTM_DCTA_v2.kmz"
needs_kmz = pytest.mark.skipif(not KMZ.exists(), reason="sample KMZ not present")


@pytest.fixture(scope="module")
def imported():
    if not KMZ.exists():
        pytest.skip("sample KMZ not present")
    return import_kml(KMZ.name, KMZ.read_bytes(), scenario_id="test")


def features(scenario):
    return [f for layer in scenario.layers for f in layer.features]


def by_name(scenario, name):
    return next(f for f in features(scenario) if f.properties.name == name)


def test_opeas(imported):
    scenario, _ = imported
    opeas = [f for f in features(scenario) if f.properties.category == FeatureCategory.OPEA]
    assert len(opeas) == 975
    pole = next(f for f in opeas if f.properties.attributes.get("objectid") == "BRAGA0166300")
    assert pole.properties.lower.value == 646.0
    assert pole.properties.upper.value == 697.0
    assert pole.properties.upper.datum == Datum.MSL
    assert pole.geometry.coordinates == [-45.89845833, -23.25734444]


def test_zea_steps(imported):
    scenario, _ = imported
    tops = sorted(
        f.properties.upper.value
        for f in features(scenario)
        if f.properties.name.startswith("UAS_FRZ_ZEA_IFR")
    )
    assert tops == [637, 667, 697, 727]
    zea = by_name(scenario, "UAS_FRZ_ZEA_IFR_ICA100_40_637m")
    assert zea.properties.category == FeatureCategory.AIRPORT_RESTRICTION
    assert zea.properties.lower is None
    assert any(w.startswith("needs_floor") for w in zea.properties.warnings)


def test_speedbird_is_agl(imported):
    scenario, _ = imported
    fence = by_name(scenario, "Fence Polygon")
    assert fence.properties.upper.datum == Datum.AGL
    assert fence.properties.upper.value == 45
    assert by_name(scenario, "Contingency Polygon").properties.category == FeatureCategory.CONTINGENCY


def test_sandbox_mismatch_and_category(imported):
    scenario, _ = imported
    f = by_name(scenario, "DCTA_BR_UTM_SANDBOX_647m_2123ft")
    assert f.properties.category == FeatureCategory.UTM_ZONE
    assert any(w.startswith("name_altitude_mismatch") for w in f.properties.warnings)
    multi = by_name(scenario, "160ft AGL")
    assert multi.geometry.type == "MultiPolygon"


def test_heliport_limits_from_description(imported):
    scenario, _ = imported
    zeh = by_name(scenario, "UAS_FRZ_ZEH_SOMBRA_GEA (ZEH)")
    assert zeh.properties.category == FeatureCategory.HELIPORT_RESTRICTION
    assert zeh.properties.lower.value == 0
    assert zeh.properties.upper.value == 99999
    assert zeh.properties.upper.datum == Datum.AGL


def test_zad_flat_surface(imported):
    scenario, _ = imported
    zad = by_name(scenario, "ZAD SBSJ RWY16")
    assert zad.properties.category == FeatureCategory.AIRPORT_RESTRICTION
    assert zad.properties.upper.value == zad.properties.lower.value == 647


def test_skipped_content_reported(imported):
    _, warnings = imported
    assert any(w.startswith("NetworkLink skipped") for w in warnings)
    assert any(w.startswith("GroundOverlay skipped") for w in warnings)


@needs_kmz
def test_api_roundtrip(tmp_path):
    from app import app
    from infrastructure.scenario_store import ScenarioStore
    from routes.scenarios import get_store

    app.dependency_overrides[get_store] = lambda: ScenarioStore(tmp_path)
    try:
        client = TestClient(app)
        r = client.post(
            "/scenarios/import",
            files={"file": (KMZ.name, KMZ.read_bytes(), "application/vnd.google-earth.kmz")},
            data={"scenario_id": "rt", "save": "true"},
        )
        assert r.status_code == 200, r.text
        assert client.get("/scenarios").json()["data"][0]["feature_count"] > 990
        scenario = client.get("/scenarios/rt").json()["data"]
        scenario["name"] = "edited"
        assert client.put("/scenarios/rt", json=scenario).status_code == 200
        assert client.get("/scenarios/rt").json()["data"]["name"] == "edited"
        assert client.get("/scenarios/nope").status_code == 404
        assert client.put("/scenarios/Bad..id", json={**scenario, "id": "Bad..id"}).status_code == 400
    finally:
        app.dependency_overrides.clear()


def test_follow_network_link(monkeypatch):
    import io
    import adapters.kml_importer as ki

    linked = b"""<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Arena</name>
      <Folder><name>Area A</name><Placemark><name>Area A</name><Polygon><outerBoundaryIs>
      <LinearRing><coordinates>-45.87,-23.21,0 -45.86,-23.21,0 -45.86,-23.20,0 -45.87,-23.21,0
      </coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Folder></Document></kml>"""
    main = b"""<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>root</name>
      <Folder><name>Top</name><Document><name>Arena DCTA ITA</name><NetworkLink><name>Arena</name>
      <Link><href>https://example.com/arena.kml</href></Link></NetworkLink></Document></Folder>
      </Document></kml>"""

    class Resp(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(ki.urllib.request, "urlopen", lambda req, timeout: Resp(linked))

    skipped, warnings = import_kml("m.kml", main)
    assert not features(skipped)
    assert any(w.startswith("NetworkLink skipped") for w in warnings)

    scenario, warnings = import_kml("m.kml", main, follow_links=True)
    assert [layer.name for layer in scenario.layers] == ["Arena DCTA ITA"]
    area = by_name(scenario, "Area A")
    assert area.properties.category == FeatureCategory.OPERATION
    assert any(w.startswith("NetworkLink fetched") for w in warnings)
