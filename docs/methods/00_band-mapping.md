# 00 Band mapping across sensors

The bake and the browser lanes work on six reflectance channels (blue, green, red, near infrared, and two
shortwave infrared bands). The same channel comes from a different physical band on each sensor:

| Channel | Sentinel-2 MSI | Landsat 5 TM and 7 ETM+ | Landsat 8 and 9 OLI | Native resolution |
|---|---|---|---|---|
| blue | B2 (490 nm) | B1 | B2 | 10 m / 30 m |
| green | B3 (560 nm) | B2 | B3 | 10 m / 30 m |
| red | B4 (665 nm) | B3 | B4 | 10 m / 30 m |
| NIR | B8 (842 nm), B8A (865 nm) for ratios against SWIR | B4 | B5 | 10 m (B8A 20 m) / 30 m |
| SWIR1 | B11 (1610 nm) | B5 | B6 | 20 m / 30 m |
| SWIR2 | B12 (2190 nm) | B7 | B7 | 20 m / 30 m |

Scaling to reflectance: Sentinel-2 L2A `(DN - 1000) / 10000` (processing baseline 04.00 and later; Earth
Search items expose `scale 0.0001`, `offset -0.1`); Landsat Collection 2 Level-2 `DN * 0.0000275 - 0.2`.

Cross-sensor consistency is a known limitation (Wulder et al. 2019, Current status of Landsat program,
science, and applications, Remote Sensing of Environment 225, 127-147, doi:10.1016/j.rse.2019.02.015).
Rajo keeps the Landsat and Sentinel-2 segments of every time series visually distinct and never fits a
break across the sensor boundary without the sensor as a covariate.
