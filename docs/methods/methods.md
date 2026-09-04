# Methods

Twelve computations Rajo performs on real pixels, grouped by the question they answer. Each method gets
one page when its unit lands (theory, equations, sources, caveats, what runs where, and how it was
validated). A method appears in the app only once its page exists and its tests pass.

| Question | Methods | Page |
|---|---|---|
| What am I looking at? | M1 colour composites, M2 spectral indices | [01_composites-and-indices.md](01_composites-and-indices.md) |
| What am I looking at, mineralogically? | M3 mineral group ratios | [02_mineral-ratios.md](02_mineral-ratios.md) |
| Where is the mine? | M4 Otsu bare-ground mask, M5 k-means clustering, M6 spectral angle mapper | [03_classical-delineation.md](03_classical-delineation.md) |
| Where is the mine, learned? | M7 random forest, M8 U-Net | [04_learned-delineation.md](04_learned-delineation.md) |
| How did it change? | M9 change vector analysis, M10 CUSUM and PELT change points, M11 harmonic regression with breaks | [05_change-detection.md](05_change-detection.md) |
| How much rock moved? | M12 DEM differencing, profiles and volumes | [06_relief-and-volumes.md](06_relief-and-volumes.md) |

Notation used across the pages: reflectance in band b is written rho_b (0 to 1 after the Level-2 scale
and offset); Sentinel-2 band names are used, with the Landsat equivalents given in
[00_band-mapping.md](00_band-mapping.md).
