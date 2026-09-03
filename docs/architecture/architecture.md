# Architecture

Rajo is a static web application over two kinds of evidence: artifacts baked offline by a deterministic
pipeline (frames, masks, series, elevation differences, manifests with sha256), and computations the
browser performs live against open, keyless, CORS-enabled data sources (Sentinel-2 cloud-optimized
GeoTIFFs, terrain tiles). There is no backend.

| Page | Content |
|---|---|
| [01_overview.md](01_overview.md) | the four lanes (bake, replay, live A: band math, live B: learned inference, relief) and what runs where |
| [02_data-contracts.md](02_data-contracts.md) | Contract 1 (ingestion, the bring-your-own-site gate) and Contract 2 (artifact, bake to web) |
| [03_determinism-and-provenance.md](03_determinism-and-provenance.md) | why every manifest is a pure function of its inputs, and how sha256 travels to the deploy |
| [04_deploy.md](04_deploy.md) | the static deploy, cache headers, the live content check |
