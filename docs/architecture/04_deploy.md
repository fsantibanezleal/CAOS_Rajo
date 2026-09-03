# 04 Deploy

Rajo is a static site. The deploy builds the frontend locally over the committed artifacts, verifies
the artifact contract, ships the `dist/` folder to the web root over SSH (tar over ssh, an atomic swap
through a staging directory), reloads nginx, and then checks the LIVE content: the page title and the live
`catalog.json` must agree with the local build on the number of sites and the engine version. A 200 from
an SPA fallback proves only that nginx is running, which is why the content check exists.

Cache policy: `index.html` no-cache; hashed assets one year immutable; `/data/` one day; `.onnx` and
`.wasm` seven days with explicit MIME types; gzip for text assets. The nginx site file and the scripts live
in `deploy/`.
