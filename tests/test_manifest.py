"""The manifest writer emits LF on every platform and the file refs hash the bytes on disk.

A CRLF artifact written on Windows and hashed there drifts from the LF bytes git stores (and CI
checks out); this cost a red CI run on the first site catalog. The writer is pinned to LF and the
artifact guard refuses CR bytes in text artifacts.
"""
import hashlib
import json

from rajo.manifest import file_ref, read_json, write_json


def test_write_json_emits_lf_only(tmp_path):
    p = tmp_path / "a" / "site.json"
    write_json(p, {"id": "x", "rows": [1, 2, 3]})
    raw = p.read_bytes()
    assert b"\r" not in raw
    assert raw.endswith(b"\n")
    assert read_json(p) == {"id": "x", "rows": [1, 2, 3]}


def test_file_ref_hashes_the_bytes_on_disk(tmp_path):
    root = tmp_path / "derived"
    site = root / "sites" / "x"
    p = site / "polygons.geojson"
    write_json(p, {"type": "FeatureCollection", "features": []})
    ref = file_ref(site, root, p, "polygons")
    assert ref["path"] == "sites/x/polygons.geojson"
    assert ref["bytes"] == p.stat().st_size
    assert ref["sha256"] == hashlib.sha256(p.read_bytes()).hexdigest()
    assert json.loads(p.read_text(encoding="utf-8"))["type"] == "FeatureCollection"
