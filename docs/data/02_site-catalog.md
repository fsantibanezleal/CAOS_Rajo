# 02 The site catalog

`data/examples/sites.json` (schema `rajo.sites/v1`) lists every candidate site. Contract 1
(`data-pipeline/rajo/contracts.py`) decides which rows enter the bake; the field table and the outlier
policy are in `data/README.md`.

## Categories (the coverage matrix)

| Category | Why it is in the catalog |
|---|---|
| `copper-chile` | the core: twelve Chilean copper operations from Collahuasi in the north to Los Bronces near Santiago, plus the Salar de Atacama ponds |
| `copper-world` | the world's largest copper pits, for scale and for the cross-check of the learned model outside Chile |
| `lithium-brine` | evaporation ponds change colour and extent within a year: a different spectral behaviour from a pit |
| `iron` | iron ore pits (Carajas, Mount Whaleback) are red and dark: the iron-oxide ratio is strong here |
| `gold` | the largest gold pits (Muruntau, Fimiston) sit in deserts with little vegetation contrast |
| `lignite` | the largest excavations by area in Europe, with temperate vegetation around them |
| `diamonds` | small, very deep, high-latitude pits with snow half the year: the seasonal window matters |
| `oil-sands` | forest cleared for mines: the change vector is vegetation to bare, at scale |
| `transition` | pits that went underground (Chuquicamata 2019, Grasberg 2019): the surface stops growing |
| `closure` | halted or closed operations (Cobre Panama 2023, Mir 2001): the signal flattens |

## The seasonal window

One frame per site per year is chosen inside a per-site season window (dry season, high sun, no snow):
Chile and Peru November to March, or May to September in the high Andes; Australia April to September;
temperate Northern Hemisphere June to September; Athabasca and the Russian pits July to August; Grasberg
and Panama any month, taking the lowest cloud fraction in the scene statistics.

## Bring your own site

A JSON file with the same shape as `sites.json` can be given to the bake, and the observatory accepts a
seed typed into the site box to run the browser lanes on any place on Earth. The same contract applies:
the seed must sit within 3 km of a reference polygon unless the row opts out, and every fact shown must
carry a source.
