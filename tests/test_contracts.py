"""Contract 1 accepts a good site, rejects the documented defects, and flags the documented suspicions."""
from __future__ import annotations

import copy
import json
import pathlib

from rajo.contracts import validate_sites
from rajo.geo import site_window, utm_epsg

REPO = pathlib.Path(__file__).resolve().parents[1]

GOOD = {
    "id": "test-pit",
    "name": {"en": "Test pit", "es": "Rajo de prueba"},
    "country": "CHL",
    "categories": ["copper-chile"],
    "seed": {"lon": -68.905, "lat": -22.305},
    "window_km": 20,
    "first_year": 1985,
    "season": {"start_month": 12, "end_month": 3},
    "facts": [{"text": {"en": "A fact.", "es": "Un hecho."}, "source": "https://example.org/fact"}],
}


def near(lon, lat, search):
    return 0.4


def far(lon, lat, search):
    return None


def test_accepts_a_good_site():
    r = validate_sites([GOOD], nearest_polygon_km=near)
    assert r.ok and r.accepted[0].id == "test-pit" and not r.flagged


def test_rejects_missing_source_and_bad_coordinates():
    bad = copy.deepcopy(GOOD)
    bad["facts"][0]["source"] = "no url"
    bad["seed"]["lat"] = 95
    r = validate_sites([bad], nearest_polygon_km=near)
    assert not r.accepted and "source" in r.rejected[0]["reason"] and "seed" in r.rejected[0]["reason"]


def test_rejects_seed_far_from_polygons_unless_opted_out():
    r = validate_sites([GOOD], nearest_polygon_km=far)
    assert not r.accepted and "reference polygon" in r.rejected[0]["reason"]
    opt = copy.deepcopy(GOOD)
    opt["no_reference_polygon"] = True
    r2 = validate_sites([opt], nearest_polygon_km=far)
    assert r2.accepted and r2.flagged and "opt-out" in r2.flagged[0]["flag"]


def test_rejects_duplicate_ids_and_unknown_category():
    dup = copy.deepcopy(GOOD)
    other = copy.deepcopy(GOOD)
    other["categories"] = ["unobtainium"]
    r = validate_sites([dup, other], nearest_polygon_km=near)
    assert len(r.accepted) == 1 and len(r.rejected) == 1


def test_committed_catalog_passes_contract_1_without_polygons():
    raw = json.loads((REPO / "data" / "examples" / "sites.json").read_text(encoding="utf-8"))["sites"]
    r = validate_sites(raw, nearest_polygon_km=None)
    assert not r.rejected, r.rejected
    assert len(r.accepted) >= 24
    assert sum("CHL" == s.country for s in r.accepted) >= 12


def test_window_is_square_on_the_utm_grid():
    assert utm_epsg(-68.9, -22.3) == 32719
    assert utm_epsg(-112.15, 40.52) == 32612
    w = site_window(-68.905, -22.305, 20)
    assert w.width == w.height == 2001 and w.width % 3 == 0
    assert w.left % 30 == 0 and w.top % 30 == 0
    bbox = w.bbox_wgs84()
    assert bbox[0] < -68.905 < bbox[2] and bbox[1] < -22.305 < bbox[3]
