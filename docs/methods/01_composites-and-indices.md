# 01 Colour composites and spectral indices (M1, M2)

Question answered: what am I looking at? Runs live in the browser on the latest clear Sentinel-2 scene
(the Look view of the instrument panel) and offline in the bake (the frames are the true-colour and the
SWIR composites of every year). Reflectance $\rho_b$ is surface reflectance in band $b$, in $[0, 1]$
after the Level-2 scale and offset (`(DN - 1000) / 10000` for Sentinel-2 processing baseline 04.00 and
later; `DN * 0.0000275 - 0.2` for Landsat Collection 2); invalid pixels (no data, cloud, shadow, cirrus
per the scene classification) are excluded from every statistic.

## M1 Composites

| Composite | Channels (R, G, B) | What it shows |
|---|---|---|
| true colour | B4, B3, B2 | the scene as an eye would see it: red-brown iron-rich waste, grey-blue fresh rock, white salt and tailings |
| false colour (NIR) | B8, B4, B3 | vegetation in red, bare ground in grey-blue, water dark |
| SWIR geology | B12, B8A (or B8), B4 | the classic geological combination: clays and hydroxyl-bearing rocks appear dark in B12, iron oxides bright in B4, vegetation green |

Display stretch: each channel is clipped to its 2nd and 98th percentile over the valid pixels and raised
to $\gamma = 1/1.35$; the clip values are printed next to the composite in the app and stored per frame in
the manifest (`stretch`), so a stretch is never hidden. The stretch is per scene, so absolute brightness is
not comparable across frames; the indices are.

Sources: van der Meer, F. D. et al. (2012), Multi- and hyperspectral geologic remote sensing: a review,
Int. J. Appl. Earth Obs. Geoinf. 14, 112-128, doi:10.1016/j.jag.2011.08.002; van der Werff, H. and van
der Meer, F. (2015), Sentinel-2 for mapping iron absorption feature parameters, Remote Sens. Environ. 148,
124-133, doi:10.1016/j.rse.2014.03.022.

## M2 Spectral indices

$$\mathrm{NDVI} = \frac{\rho_{B8} - \rho_{B4}}{\rho_{B8} + \rho_{B4}}$$

Rouse, J. W., Haas, R. H., Schell, J. A. and Deering, D. W. (1974), Monitoring vegetation systems in the
Great Plains with ERTS, Third ERTS Symposium, NASA SP-351, 309-317 (no DOI). Bare pits and dumps sit near
zero; irrigated fields and riparian strips light up.

$$\mathrm{NDWI} = \frac{\rho_{B3} - \rho_{B8}}{\rho_{B3} + \rho_{B8}}$$

McFeeters, S. K. (1996), The use of the Normalized Difference Water Index (NDWI) in the delineation of
open water features, Int. J. Remote Sens. 17(7), 1425-1432, doi:10.1080/01431169608948714. Bright salt
crusts can mimic water in NDWI.

$$\mathrm{MNDWI} = \frac{\rho_{B3} - \rho_{B11}}{\rho_{B3} + \rho_{B11}}$$

Xu, H. (2006), Modification of normalised difference water index (NDWI) to enhance open water features in
remotely sensed imagery, Int. J. Remote Sens. 27(14), 3025-3033, doi:10.1080/01431160600589179. Separates
ponds and brine from bright salt and tailings better than NDWI; the reason it is the water test inside the
bare-ground mask.

$$\mathrm{NDBI} = \frac{\rho_{B11} - \rho_{B8}}{\rho_{B11} + \rho_{B8}}$$

Zha, Y., Gao, J. and Ni, S. (2003), Use of normalized difference built-up index in automatically mapping
urban areas from TM imagery, Int. J. Remote Sens. 24(3), 583-594, doi:10.1080/01431160304987. Bare rock,
dumps and plants all score high: built-up is not mine.

$$\mathrm{BSI} = \frac{(\rho_{B11} + \rho_{B4}) - (\rho_{B8} + \rho_{B2})}{(\rho_{B11} + \rho_{B4}) + (\rho_{B8} + \rho_{B2})}$$

Rikimaru, A., Roy, P. S. and Miyatake, S. (2002), Tropical forest cover density mapping, Tropical Ecology
43(1), 39-47 (no DOI; the common form of the bare soil index). The workhorse of the classical masks;
deserts are bare everywhere, so the threshold matters (M4).

$$\mathrm{NBR} = \frac{\rho_{B8} - \rho_{B12}}{\rho_{B8} + \rho_{B12}}$$

Key, C. H. and Benson, N. C. (2006), Landscape assessment (LA), in FIREMON: Fire Effects Monitoring and
Inventory System, USDA Forest Service RMRS-GTR-164-CD (no DOI). Used here as a dryness contrast over bare
rock, not as a burn index.

## What runs where

| Lane | Implementation | Grid |
|---|---|---|
| live (browser) | `frontend/src/lib/indices.ts` in `workers/indices.worker.ts`, on a same-day Sentinel-2 group read from the cloud-optimized GeoTIFFs with `lib/cog.ts` | the site window at 10, 20 or 40 m so the longer side stays at or below 1600 px |
| bake (Python) | `data-pipeline/rajo/raster.py` (composites) and, from the masks unit, `data-pipeline/rajo/indices.py` on the chip cache | the site grid at 10 m (Sentinel-2) or 30 m (Landsat) |

Every value on screen is computed from reflectance; the cursor readout shows the index value of the pixel
under the pointer, the histogram shows the distribution of the valid pixels and the percentiles that set
the display range, and the range can be set by hand. Tests: `frontend/src/lib/indices.test.ts` (index
values on synthetic spectra, percentiles ignoring NaN, Otsu on a bimodal histogram, the bare mask on a
synthetic block).
