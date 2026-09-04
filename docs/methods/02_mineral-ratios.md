# 02 Mineral group ratios (M3)

Question answered: what am I looking at, mineralogically? Runs live in the browser (Look view, the
"Mineral group indicators" group of the index selector). These are band ratios that respond to the broad
absorption features of mineral groups; with two shortwave-infrared bands Sentinel-2 cannot resolve
species, so the app labels them indicators, never mineral maps.

$$R_{\mathrm{Fe}^{3+}} = \frac{\rho_{B4}}{\rho_{B2}} \qquad \text{(iron oxide, the Landsat TM 3/1 ratio)}$$

Ferric oxides and hydroxides (hematite, goethite, jarosite) absorb in the blue and reflect in the red, so
the red-over-blue ratio rises over oxidised rock, gossans, oxidised waste dumps and leach pads.

$$R_{\mathrm{OH}} = \frac{\rho_{B11}}{\rho_{B12}} \qquad \text{(hydroxyl, clay and carbonate, the TM 5/7 ratio)}$$

Al-OH and Mg-OH minerals (kaolinite, sericite, chlorite) and carbonates absorb near 2.2 to 2.35 um, which
darkens B12 (2190 nm) relative to B11 (1610 nm), so the ratio rises over argillic alteration and over clay-
rich tailings.

$$R_{\mathrm{Fe}^{2+}} = \frac{\rho_{B12}}{\rho_{B8A}} \qquad \text{(ferrous minerals)}$$

Ferrous iron in silicates lowers the near-infrared reflectance, so the SWIR-over-NIR ratio rises over fresh,
un-oxidised rock and dark dumps. The app uses B8 where B8A is not read live.

Sentinel-2-specific iron feature ratios $\rho_{B6}/\rho_{B1}$ and $\rho_{B6}/\rho_{B8A}$ were proposed for
hematite and goethite mixtures; they need the 60 m coastal band and are part of the bake, not the live
lane.

Sources: Sabins, F. F. (1999), Remote sensing for mineral exploration, Ore Geology Reviews 14, 157-183,
doi:10.1016/S0169-1368(99)00007-4; van der Werff, H. and van der Meer, F. (2016), Sentinel-2 for mapping
iron absorption feature parameters, Remote Sensing 8(10), doi:10.3390/rs71012635; Ge, W. et al. (2020),
Assessment of the capability of Sentinel-2 imagery for iron-bearing minerals mapping: a case study in the
Cuprite area, Nevada, Remote Sensing 12(18), 3028, doi:10.3390/rs12183028; van der Meer, F. D. et al.
(2012), doi:10.1016/j.jag.2011.08.002.

Caveats stated in the app: the ratios respond to oxidised waste and leach pads as much as to outcrop;
shadowed pit walls lower every band and can shift ratios; atmospheric residuals in the Level-2 product
affect the blue band most, so the iron ratio is the noisiest of the three; none of these is a mineral map.
