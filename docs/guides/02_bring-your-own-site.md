# 02 Bring your own site

## Add a site to the catalog

Append a row to `data/examples/sites.json` with the shape below and run the catalog stage. Contract 1
rejects the row with a reason if anything is missing or out of range; the reason names the field.

```json
{
  "id": "my-pit",
  "name": {"en": "My pit", "es": "Mi rajo"},
  "country": "CHL",
  "categories": ["copper-chile"],
  "commodity": "copper",
  "operator": "Operator name",
  "seed": {"lon": -69.0, "lat": -23.0},
  "window_km": 20,
  "first_year": 1985,
  "season": {"start_month": 11, "end_month": 3},
  "facts": [
    {"text": {"en": "A sourced sentence.", "es": "Una oracion con fuente."}, "source": "https://example.org/the-source"}
  ]
}
```

Rules that bite: the seed must sit within 3 km of a reference polygon of the Maus 2022 dataset, or the
row must say `"no_reference_polygon": true` (the site is then accepted with a flag and its footprint
statistics come only from the segmentation models); every fact needs a source URL; the window is 4 to
40 km; the season months pick the yearly frame.

## Run the browser lanes anywhere

The observatory's site box accepts a place typed as `lon, lat`. The live lanes then search the Sentinel-2
archive for the latest clear scene over that point, read the window from the cloud-optimized GeoTIFFs and
compute the composites, indices, ratios and masks in your browser. Nothing is uploaded; the only requests
leave your browser for the public data buckets. Time-lapse frames, series and elevation differences exist
only for baked sites.
