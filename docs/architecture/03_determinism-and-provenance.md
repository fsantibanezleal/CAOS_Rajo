# 03 Determinism and provenance

A manifest is a pure function of the accepted site definition, the reference polygons, the scene
selection rule, the engine version and the model versions. No wall-clock timestamp is written, so
re-baking an unchanged site produces byte-identical manifests and git stays clean; the acquisition dates
in the manifest are the scenes' own dates.

Provenance travels in three places: the manifest (scene ids, model sha256, engine version), the site card
(every fact with its source URL), and the deploy (the live catalog is compared with the local one before a
deploy is declared done). The training registry `models/registry.json` records the training data DOI, the
split hash, the seed, the epochs, the held-out metrics and the ONNX sha256 of every learned model.
