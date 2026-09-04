# 06 Relief and volumes: DEM differencing (M12)

Question 4, how much rock moved. Two global elevation surfaces a decade apart, differenced on the
site's 30 m grid, with the noise floor of that difference measured on ground that did not move, and
the volumes that clear the floor. The later surface is also baked as terrain tiles per site so the map
can switch its relief from the year-2000 radar surface to the 2011 to 2015 one, and a profile tool reads
both surfaces along a line drawn on the map.

## The two surfaces

| Epoch | Surface | Sensor and dates | Vertical datum | Access |
|---|---|---|---|---|
| 2000 | SRTM GL1, void-filled version 3 | Shuttle Radar Topography Mission, C-band, 11 to 22 February 2000 | EGM96 orthometric | OpenTopography S3, 1 x 1 degree GeoTIFF tiles (CORS) |
| 2011 to 2015 | Copernicus DEM GLO-30 | TanDEM-X, X-band, acquisitions 2011 to 2015 | EGM2008 orthometric | AWS Open Data, COG tiles (no CORS, bake only) |

Farr, T. G. et al. 2007, *The Shuttle Radar Topography Mission*, Reviews of Geophysics 45, RG2004,
doi:10.1029/2005RG000183. Rizzoli, P. et al. 2017, *Generation and performance assessment of the global
TanDEM-X digital elevation model*, ISPRS Journal of Photogrammetry and Remote Sensing 132, 119-139,
doi:10.1016/j.isprsjprs.2017.08.008. The Copernicus DEM is produced using Copernicus WorldDEM-30, DLR
e.V. 2010-2014 and Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European
Union and ESA; SRTM GL1 is distributed by OpenTopography (acknowledgement required).

Both are surface models: they see dump crests and pond surfaces, not the ground under them. SRTM's
C-band penetrates vegetation little and was void-filled on steep faces; TanDEM-X X-band has its own
artefacts on pit walls and on water. And the interval is one decade, a single difference, not a series:
a pit deepened after 2015 shows nothing here, which is what the time-lapse is for.

## Method

Both surfaces are warped onto the site's 30 m grid (bilinear, first data wins across the 1 x 1 degree
tile seams; the warped extent of a tile is taken from its alpha band, because the Copernicus tiles
declare no no-data value and would otherwise pour zeros across the seam). SRTM heights are moved from
EGM96 to EGM2008 with the geoid difference at the site centre, obtained from the PROJ grids
(`EPSG:4326+5773` and `EPSG:4326+3855` to ellipsoidal heights); when the grids cannot be fetched the
offset is recorded as null and the result carries the flag `geoid_uncorrected`.

$$\Delta h = h_{\mathrm{COP}} - \bigl(h_{\mathrm{SRTM}} + (N_{96} - N_{2008})\bigr) - b$$

where $b$ is the median of $\Delta h$ over stable ground, removed as datum and tie-point residue. Stable
ground is every cell outside the reference envelope (the mining polygons dilated by one kilometre) with
a slope below 10 degrees on the Copernicus surface. The noise floor is the robust scale of $\Delta h$
there, $\sigma = 1.4826 \cdot \mathrm{MAD}$, and the threshold is $\tau = 2\sigma$. Volumes, with cell
area $a = 900$ m2:

$$V_{\mathrm{cut}} = \sum_{\Delta h < -\tau} |\Delta h|\, a, \qquad V_{\mathrm{fill}} = \sum_{\Delta h > \tau} \Delta h\, a$$

reported over the envelope (the mine) and over the whole window (context: a dam, a town, a landslide
outside the envelope is real change too). The map drapes $\Delta h$ as a diverging image (blue below,
red above, transparent where either surface has no data), with the range set at the 98th percentile of
$|\Delta h|$ inside the envelope and never below 5 m.

Precedents: SRTM minus TanDEM-X over an open pit, Remote Sensing 2021, 13(9), 1861,
doi:10.3390/rs13091861; Copernicus versus TanDEM-X artefacts, Remote Sensing 2021, 13(19), 3931,
doi:10.3390/rs13193931; DSM differencing for excavation volumes, Remote Sensing 2026, 18(4), 654,
doi:10.3390/rs18040654.

## What Antamina says (the validation site)

On the first run (2026-09-03, Antamina, 16 km window): geoid difference -3.60 m, stable bias -2.22 m,
noise floor 2.77 m, threshold 5.53 m over 17,482 stable cells; inside the envelope 586 million m3 of
cut and 916 million m3 of fill (11.5 and 22.5 km2 above the threshold), a deepest change of -330 m in
the pit and +315 m on the dumps. Order of magnitude: Antamina moves on the order of a hundred million
tonnes of rock a year, about forty million cubic metres, so thirteen years at that pace is the size of
the cut reported. The fill exceeding the cut is expected: dumps are bulked, tailings are placed, and the
pit walls below 2000's floor are what the radar sees as cut.

## The epoch terrain and the profile

The Copernicus surface is baked as Web Mercator terrarium tiles (zooms 10 to 13, 256 px, the encoding
of the global terrain source: elevation = R x 256 + G + B / 256 - 32768) under the site directory, so the
map can switch its 3D relief and hillshade to the 2011 to 2015 epoch over the site window; outside the
window the global source (SRTM-era in South America) stays. The profile tool samples both terrarium
sources along a line drawn on the map (200 samples, bilinear inside a tile, tiles decoded in the
browser) and charts the two elevations and their difference; the depth of a pit below its 2000 rim is
read directly from that chart.

## Caveats

- A change smaller than the threshold is invisible by construction; the threshold is printed next to
  every volume, and the floor differs from site to site (flat deserts around 1 to 2 m, rugged Andes
  several metres).
- Water (ponds, tailings) is unreliable in both radars; brine ponds may show as spurious cut or fill.
- Tiles at the edge of the 1 x 1 degree grid come from two files; the seam is handled, but a void-filled
  SRTM cell next to a real one can leave a one-cell step.
- The geoid offset is a single value at the site centre; over a 40 km window its variation is below
  the noise floor.
