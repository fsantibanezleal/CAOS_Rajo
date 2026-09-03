"""Season windows and the same-day candidate grouping (no network: synthetic records)."""
from __future__ import annotations

from rajo.stac import Item, group_by_date, landsat_platforms_for, season_range


def test_season_range_wraps_the_year_boundary():
    assert season_range(2024, 11, 3) == ("2023-11-01", "2024-03-31")
    assert season_range(2020, 6, 9) == ("2020-06-01", "2020-09-30")
    assert season_range(2021, 1, 12) == ("2021-01-01", "2021-12-31")


def test_landsat_platform_ladder():
    assert landsat_platforms_for(1990) == ("landsat-5", "landsat-7")
    assert landsat_platforms_for(2012) == ("landsat-7",)
    assert landsat_platforms_for(2020)[0] == "landsat-8"


def _item(iid: str, minx: float, maxx: float, cov: float) -> Item:
    geom = {"type": "Polygon", "coordinates": [[[minx, -1], [maxx, -1], [maxx, 1], [minx, 1], [minx, -1]]]}
    return Item(id=iid, assets={}, epsg=32719, coverage=cov, extra={"geometry": geom})


def test_same_day_neighbours_are_one_candidate_and_full_coverage_ranks_first():
    bbox = (0.0, -0.5, 1.0, 0.5)
    # day A: two half tiles that together cover the window; day B: one tile covering 60%, clearer
    records = [
        ("2024-01-05", "sentinel-2a", 5.0, _item("A-left", -1.0, 0.5, 0.5)),
        ("2024-01-05", "sentinel-2a", 7.0, _item("A-right", 0.5, 2.0, 0.5)),
        ("2024-01-10", "sentinel-2b", 1.0, _item("B", -1.0, 0.6, 0.6)),
    ]
    cands = group_by_date(records, "sentinel-2-l2a", bbox)
    assert [c.date for c in cands] == ["2024-01-05", "2024-01-10"]
    assert cands[0].coverage > 0.99 and len(cands[0].items) == 2
    assert abs(cands[0].cloud_scene_pct - 6.0) < 1e-6
    assert cands[1].coverage < 0.7
    assert "geometry" not in cands[0].items[0].extra
