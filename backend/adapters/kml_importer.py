"""Convert KML/KMZ files into analysis scenarios.

Mapping rules (see docs plan "Airspace Analysis Layers"):
- altitudeMode absolute      -> upper = max coordinate altitude, datum MSL
- altitudeMode relativeToGround -> upper = max coordinate altitude, datum AGL
- extruded volumes have no floor in KML (Google Earth draws 0 -> top), so
  ``lower`` is left empty and a ``needs_floor`` warning is attached
- clamped (2D) polygons take limits from a ``Limites: X - Y AGL`` description
  when present (DECEA FRZ/ZEH exports)
- points carrying DECEA OPEA SchemaData become ``opea`` obstacles with
  lower = altitude_base and upper = altitude_topo (MSL)
- GroundOverlays and NetworkLinks are skipped and reported as warnings

Usage: python -m adapters.kml_importer <file.kmz> [scenario_id]
"""

import html
import io
import json
import re
import sys
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Iterable, Optional

from domain.scenario import (
    AltitudeLimit,
    AnalysisFeature,
    AnalysisLayer,
    Datum,
    FeatureCategory,
    FeatureProperties,
    Geometry,
    Scenario,
)

KML_NS = "{http://www.opengis.net/kml/2.2}"
GX_NS = "{http://www.google.com/kml/ext/2.2}"
CONTAINERS = ("Document", "Folder")

# Ordered: first match wins. Checked against "<container path> / <name>".
CATEGORY_RULES: list[tuple[re.Pattern, FeatureCategory]] = [
    (re.compile(r"contingency|conting[eê]ncia", re.I), FeatureCategory.CONTINGENCY),
    (re.compile(r"zeh|heliponto|sjci|\bfrz\b", re.I), FeatureCategory.HELIPORT_RESTRICTION),
    (re.compile(r"\bzea\b|\bzad\b|_zea_|sbsj|aer[oó]dromo", re.I), FeatureCategory.AIRPORT_RESTRICTION),
    (re.compile(r"sandbox|zona utm|utm zone|\d+\s*ft\s*agl", re.I), FeatureCategory.UTM_ZONE),
    (re.compile(r"fence|ground risk|waypoint|proposta|rota", re.I), FeatureCategory.OPERATION),
    (re.compile(r"\bsbp\b|restri[cç][aã]o|radar|\bsbr\b|\bsbd\b", re.I), FeatureCategory.RESTRICTED_AREA),
]

NAME_ALT_M = re.compile(r"(?<![\d.])(\d{2,4}(?:\.\d+)?)\s*m(?![a-z])", re.I)
LIMITS_DESC = re.compile(
    r"Limites:\s*(\d+(?:\.\d+)?)\s*m\s*-\s*(\d+(?:\.\d+)?)\s*m\s*(AGL|AMSL|MSL)?",
    re.I,
)
TAG_RE = re.compile(r"<[^>]+>")


def _tag(el: ET.Element) -> str:
    return el.tag.split("}", 1)[-1]


def _text(el: ET.Element, child: str) -> str:
    found = el.find(KML_NS + child)
    return (found.text or "").strip() if found is not None and found.text else ""


def _slug(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "item"


def _parse_coords(text: str) -> list[tuple[float, float, float]]:
    coords = []
    for chunk in text.split():
        parts = chunk.split(",")
        if len(parts) < 2:
            continue
        lng, lat = float(parts[0]), float(parts[1])
        alt = float(parts[2]) if len(parts) > 2 and parts[2] else 0.0
        coords.append((lng, lat, alt))
    return coords


def _strip_html(text: str) -> str:
    return html.unescape(TAG_RE.sub("\n", text)).strip()


def _categorize(path: str, name: str) -> FeatureCategory:
    haystack = f"{path} / {name}"
    for pattern, category in CATEGORY_RULES:
        if pattern.search(haystack):
            return category
    return FeatureCategory.CUSTOM


class _Geom:
    """Intermediate geometry with altitude info kept."""

    def __init__(self, kind: str, rings: list[list[tuple[float, float, float]]],
                 altitude_mode: str, extrude: bool):
        self.kind = kind  # Point | LineString | Polygon
        self.rings = rings
        self.altitude_mode = altitude_mode
        self.extrude = extrude

    @property
    def altitudes(self) -> list[float]:
        return [c[2] for ring in self.rings for c in ring]


def _altitude_mode(el: ET.Element) -> str:
    for tag in (KML_NS + "altitudeMode", GX_NS + "altitudeMode"):
        found = el.find(tag)
        if found is not None and found.text:
            return found.text.strip()
    return "clampToGround"


def _collect_geoms(el: ET.Element) -> list[_Geom]:
    geoms: list[_Geom] = []
    for child in el:
        kind = _tag(child)
        if kind == "MultiGeometry":
            geoms.extend(_collect_geoms(child))
            continue
        if kind not in ("Point", "LineString", "Polygon", "LinearRing"):
            continue
        mode = _altitude_mode(child)
        extrude = _text(child, "extrude") == "1"
        if kind == "Polygon":
            rings = []
            outer = child.find(f"{KML_NS}outerBoundaryIs/{KML_NS}LinearRing/{KML_NS}coordinates")
            if outer is None or not outer.text:
                continue
            rings.append(_parse_coords(outer.text))
            for inner in child.findall(
                f"{KML_NS}innerBoundaryIs/{KML_NS}LinearRing/{KML_NS}coordinates"
            ):
                if inner.text:
                    rings.append(_parse_coords(inner.text))
            geoms.append(_Geom("Polygon", rings, mode, extrude))
        else:
            coords_el = child.find(KML_NS + "coordinates")
            if coords_el is None or not coords_el.text:
                continue
            coords = _parse_coords(coords_el.text)
            geoms.append(
                _Geom("Polygon" if kind == "LinearRing" else kind, [coords], mode, extrude)
            )
    return geoms


def _schema_data(placemark: ET.Element) -> dict[str, str]:
    data: dict[str, str] = {}
    ext = placemark.find(KML_NS + "ExtendedData")
    if ext is None:
        return data
    for simple in ext.iter(KML_NS + "SimpleData"):
        if simple.get("name"):
            data[simple.get("name")] = (simple.text or "").strip()
    for d in ext.iter(KML_NS + "Data"):
        if d.get("name"):
            data[d.get("name")] = _text(d, "value")
    return data


def _to_float(value: Optional[str]) -> Optional[float]:
    try:
        return float(value) if value not in (None, "") else None
    except ValueError:
        return None


class KmlImporter:
    def __init__(self, source_name: str):
        self.source_name = source_name
        self.layers: dict[str, AnalysisLayer] = {}
        self.warnings: list[str] = []
        self._ids: set[str] = set()

    # ------------------------------------------------------------------ API
    def parse(self, kml_bytes: bytes) -> list[AnalysisLayer]:
        root = ET.fromstring(kml_bytes)
        self._walk(root, [])
        return [layer for layer in self.layers.values() if layer.features]

    # ------------------------------------------------------------- internal
    def _walk(self, el: ET.Element, path: list[str]) -> None:
        for child in el:
            kind = _tag(child)
            if kind in CONTAINERS:
                name = _text(child, "name") or kind
                self._walk(child, path + [name])
            elif kind == "Placemark":
                self._placemark(child, path)
            elif kind == "GroundOverlay":
                # Chart image pyramids: report once per top chart folder.
                key = " / ".join(path[:4])
                msg = f"GroundOverlay skipped (raster): {key}"
                if msg not in self.warnings:
                    self.warnings.append(msg)
            elif kind == "NetworkLink":
                href = child.find(f"{KML_NS}Link/{KML_NS}href")
                self.warnings.append(
                    "NetworkLink skipped (external content): "
                    f"{' / '.join(path)} -> {href.text if href is not None else '?'}"
                )
            elif kind == "kml":
                self._walk(child, path)

    def _layer_for(self, path: list[str]) -> AnalysisLayer:
        # Drop the outer document wrapper(s) so layers read "ZEA IFR SBSJ".
        trimmed = path[2:] if len(path) > 2 else path[-1:]
        name = " / ".join(trimmed) or "root"
        if name not in self.layers:
            self.layers[name] = AnalysisLayer(id=_slug(name), name=name)
        return self.layers[name]

    def _unique_id(self, base: str) -> str:
        candidate, n = base, 1
        while candidate in self._ids:
            n += 1
            candidate = f"{base}-{n}"
        self._ids.add(candidate)
        return candidate

    def _placemark(self, pm: ET.Element, path: list[str]) -> None:
        name = _text(pm, "name")
        description = _strip_html(_text(pm, "description"))
        data = _schema_data(pm)
        geoms = _collect_geoms(pm)
        if not geoms:
            return

        layer = self._layer_for(path)
        path_str = " / ".join(path)
        category = _categorize(path_str, name)
        base_id = pm.get("id") or f"{layer.id}-{_slug(name)}"

        if "aixm_code" in data:
            feature = self._opea(pm, base_id, data, geoms[0], path_str)
            layer.features.append(feature)
            return

        polygons = [g for g in geoms if g.kind == "Polygon"]
        others = [g for g in geoms if g.kind != "Polygon"]

        groups: list[tuple[Geometry, list[_Geom]]] = []
        if polygons:
            if len(polygons) == 1:
                geometry = Geometry(type="Polygon", coordinates=self._rings2d(polygons[0]))
            else:
                geometry = Geometry(
                    type="MultiPolygon",
                    coordinates=[self._rings2d(p) for p in polygons],
                )
            groups.append((geometry, polygons))
        for g in others:
            coords2d = [[c[0], c[1]] for c in g.rings[0]]
            geometry = (
                Geometry(type="Point", coordinates=coords2d[0])
                if g.kind == "Point"
                else Geometry(type="LineString", coordinates=coords2d)
            )
            groups.append((geometry, [g]))

        for geometry, group in groups:
            props = FeatureProperties(
                name=name or geometry.type,
                category=(
                    FeatureCategory.REFERENCE
                    if geometry.type == "Point" and category == FeatureCategory.CUSTOM
                    else category
                ),
                source=f"{self.source_name}: {path_str}",
                attributes=data,
                notes=description,
            )
            self._limits(props, group, name, description)
            layer.features.append(
                AnalysisFeature(
                    id=self._unique_id(base_id),
                    geometry=geometry,
                    properties=props,
                )
            )

    @staticmethod
    def _rings2d(g: _Geom) -> list[list[list[float]]]:
        rings = []
        for ring in g.rings:
            pts = [[c[0], c[1]] for c in ring]
            if pts and pts[0] != pts[-1]:
                pts.append(pts[0])
            rings.append(pts)
        return rings

    def _limits(self, props: FeatureProperties, geoms: list[_Geom],
                name: str, description: str) -> None:
        mode = geoms[0].altitude_mode
        extrude = any(g.extrude for g in geoms)
        alts = [a for g in geoms for a in g.altitudes]
        top = max(alts) if alts else 0.0
        bottom = min(alts) if alts else 0.0

        if mode in ("absolute", "relativeToGround", "relativeToSeaFloor"):
            datum = Datum.MSL if mode == "absolute" else Datum.AGL
            props.upper = AltitudeLimit(value=top, datum=datum)
            if abs(top - bottom) > 0.5:
                props.warnings.append(
                    f"non_flat_top: vertex altitudes range {bottom:g}-{top:g} m; "
                    "upper uses the maximum"
                )
            if extrude:
                props.warnings.append(
                    "needs_floor: KML extrudes from the ground; set the lower limit"
                )
            else:
                # Flat surface, not a volume: treat as a 0-thickness plane.
                props.lower = AltitudeLimit(value=top, datum=datum)

            hinted = NAME_ALT_M.findall(name)
            if datum == Datum.MSL and hinted:
                hint = float(hinted[-1])
                if abs(hint - top) > 1.0:
                    props.warnings.append(
                        f"name_altitude_mismatch: name says {hint:g} m but "
                        f"geometry top is {top:g} m"
                    )
            return

        # clampToGround: 2D. Try DECEA description limits.
        match = LIMITS_DESC.search(description)
        if match:
            ref = (match.group(3) or "AGL").upper()
            datum = Datum.AGL if ref == "AGL" else Datum.MSL
            props.lower = AltitudeLimit(value=float(match.group(1)), datum=datum)
            props.upper = AltitudeLimit(value=float(match.group(2)), datum=datum)
            return
        if geoms[0].kind != "Point":
            props.warnings.append("no_limits: 2D shape; set lower and upper limits")

    def _opea(self, pm: ET.Element, base_id: str, data: dict[str, str],
              geom: _Geom, path_str: str) -> AnalysisFeature:
        lng = _to_float(data.get("longitude")) or geom.rings[0][0][0]
        lat = _to_float(data.get("latitude")) or geom.rings[0][0][1]
        base = _to_float(data.get("altitude_base"))
        topo = _to_float(data.get("altitude_topo"))
        height = _to_float(data.get("altura"))
        if topo is None and base is not None and height is not None:
            topo = base + height
        if base is None and topo is not None and height is not None:
            base = topo - height

        code = data.get("aixm_code", "OTHER")
        props = FeatureProperties(
            name=_text(pm, "name") or (f"{code} {height:g} m" if height is not None else code),
            category=FeatureCategory.OPEA,
            lower=AltitudeLimit(value=base, datum=Datum.MSL) if base is not None else None,
            upper=AltitudeLimit(value=topo, datum=Datum.MSL) if topo is not None else None,
            radius_m=5.0,
            source=f"{self.source_name}: {path_str}",
            attributes=data,
        )
        if (data.get("uom") or "M").upper() != "M":
            props.warnings.append(f"unit: OPEA declared in {data.get('uom')}, expected M")
        ident = data.get("objectid") or data.get("id") or base_id
        return AnalysisFeature(
            id=self._unique_id(f"opea-{_slug(ident)}"),
            geometry=Geometry(type="Point", coordinates=[lng, lat]),
            properties=props,
        )


def read_kml_bytes(filename: str, content: bytes) -> bytes:
    """Return the main KML document from a .kml or .kmz payload."""
    if filename.lower().endswith(".kmz") or content[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            names = [n for n in zf.namelist() if n.lower().endswith(".kml")]
            if not names:
                raise ValueError("KMZ has no .kml document")
            main = "doc.kml" if "doc.kml" in names else sorted(names, key=len)[0]
            return zf.read(main)
    return content


def import_kml(filename: str, content: bytes, scenario_id: Optional[str] = None,
               name: Optional[str] = None) -> tuple[Scenario, list[str]]:
    importer = KmlImporter(Path(filename).name)
    layers = importer.parse(read_kml_bytes(filename, content))
    stem = Path(filename).stem
    scenario = Scenario(
        id=scenario_id or _slug(stem),
        name=name or stem,
        description=f"Imported from {Path(filename).name}",
        layers=layers,
    )
    return scenario, importer.warnings


def feature_warnings(layers: Iterable[AnalysisLayer]) -> list[str]:
    out = []
    for layer in layers:
        for f in layer.features:
            for w in f.properties.warnings:
                out.append(f"{layer.name} / {f.properties.name}: {w}")
    return out


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    src = Path(sys.argv[1])
    sid = sys.argv[2] if len(sys.argv) > 2 else None
    scenario, warnings = import_kml(src.name, src.read_bytes(), scenario_id=sid)
    out_dir = Path(__file__).resolve().parent.parent / "data" / "scenarios"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{scenario.id}.json"
    out.write_text(scenario.model_dump_json(indent=1))
    print(f"Wrote {out}")
    for layer in scenario.layers:
        print(f"  {layer.name}: {len(layer.features)} features")
    for w in warnings + feature_warnings(scenario.layers):
        print(f"  ! {w}")
