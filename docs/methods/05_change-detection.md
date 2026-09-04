# 05 Change detection: change vector analysis (M9), change points (M10), harmonic breaks (M11)

Question 3, how did it change. Three computations at three time scales: two dates (M9), the yearly
series of the time-lapse (M10), and the dense Sentinel-2 record since 2017 (M11). The yearly and dense
series are baked offline and their detectors are mirrored in the browser, where the user can move the
penalty and watch the breaks move; the browser code is pinned to the Python code by a golden fixture
(`frontend/src/lib/changepoints.test.ts`).

## The mined-area series

Every baked frame gets one mask per method on the 30 m grid (the Sentinel-2 chips are mean-pooled by
three): the Otsu bare-ground mask of [03](03_classical-delineation.md) on every sensor, the random
forest of [04](04_learned-delineation.md) on every sensor (Landsat years flagged `cross_sensor`: the
forest was trained on Sentinel-2 at 10 m), and the U-Net on the Sentinel-2 years only. Each mask is
scored inside the site ENVELOPE, the reference polygons dilated by one kilometre; a mask over the whole
window would measure the desert, not the mine. A year whose envelope was less than 70% clear is a null
in every series: a cloud is not a shrinking mine. The stage also records the envelope means of NDVI,
MNDWI and BSI per year.

## M9 Change vector analysis between two dates

For two dates $t_1, t_2$ and the index vector $\mathbf{v} = (\mathrm{NDVI}, \mathrm{MNDWI}, \mathrm{BSI}, R_{OH})$:

$$\Delta\mathbf{v} = \mathbf{v}(t_2) - \mathbf{v}(t_1), \qquad \lVert\Delta\mathbf{v}\rVert_2 \text{ (magnitude)}, \qquad \phi = \operatorname{atan2}(\Delta\mathrm{BSI}, -\Delta\mathrm{NDVI}) \text{ (direction)}$$

Magnitude above an Otsu threshold flags change; the direction separates vegetation to bare (a new
pit or dump), bare to water (a new pond) and water to salt (a pond drying). Malila 1980, *Change vector
analysis: an approach for detecting forest changes with Landsat*, LARS Symposia, Purdue (no DOI). In the
app the two dates are two live Sentinel-2 reads of the same window.

## M10 CUSUM and PELT on the yearly series

The signal is $A_t$, the area of the method's mask inside the envelope, in km2, one value per year
with nulls skipped. Two detectors, both scaled by a robust estimate of the noise, $\sigma = 1.4826
\cdot \mathrm{MAD}(\Delta A)$ (the median absolute deviation of the first differences, so one real jump
does not inflate the threshold that should detect it):

CUSUM (Page 1954, *Continuous inspection schemes*, Biometrika 41, 100-115, doi:10.1093/biomet/41.1-2.100),
one-sided upward on the first differences with target $\mu_0$ the median difference, $k = 0.5\sigma$,
$h = 4\sigma$, reset after an alarm:

$$S_0 = 0,\qquad S_t = \max\bigl(0,\; S_{t-1} + (\Delta A_t - \mu_0 - k)\bigr),\qquad \text{alarm when } S_t > h$$

PELT (Killick, Fearnhead and Eckley 2012, *Optimal detection of changepoints with a linear computational
cost*, Journal of the American Statistical Association 107(500), 1590-1598,
doi:10.1080/01621459.2012.737745) minimises

$$\sum_{i=1}^{m+1} \mathcal{C}\bigl(A_{\tau_{i-1}+1:\tau_i}\bigr) + \beta m$$

with the L2 cost of a piecewise-constant mean, a minimum segment of three years and
$\beta = 3\sigma^2 \log n$. With $n$ about forty the exact optimal partition is a dynamic programme with
pruning, which is what PELT is; the in-house solver agrees with the `ruptures` implementation (Truong,
Oudre and Vayatis 2020, *Selective review of offline change point detection methods*, Signal Processing
167, 107299, doi:10.1016/j.sigpro.2019.107299) on the same penalty, and the test suite checks it. Each
segment is reported with its mean and its least-squares slope in km2 per year.

The browser reruns PELT with the penalty scaled by a slider (0.25 to 4 times the baked value) so the
reader sees which breaks are robust and which appear only under a lenient penalty. The bake's breaks are
the ones at scale 1.

## M11 Harmonic regression with breaks on the dense series

On the dense series of the envelope mean of BSI (every Sentinel-2 date since 2017 whose envelope is at
least 70% clear, read at 60 m from the COG overviews), fit

$$y_t = \alpha + \beta t + \sum_{k=1}^{K}\left[\gamma_k \cos\frac{2\pi k t}{T} + \delta_k \sin\frac{2\pi k t}{T}\right] + \varepsilon_t$$

with $K = 2$ and $T = 365.25$ days, piecewise between break dates chosen by an exhaustive search over one
or two breaks with a minimum segment of one year, accepted only when the BIC of the broken model beats
the unbroken one. The seasonal term absorbs the illumination cycle so that a break is a real land
change. This is BFAST-style (Verbesselt, Hyndman, Newnham and Culvenor 2010, *Detecting trend and
seasonal changes in satellite image time series*, Remote Sensing of Environment 114, 106-115,
doi:10.1016/j.rse.2009.08.014), not the BFAST package; the related CCDC (Zhu and Woodcock 2014,
doi:10.1016/j.rse.2014.01.011) and LandTrendr (Kennedy, Yang and Cohen 2010, doi:10.1016/j.rse.2010.07.008)
are the precedents, and Zhu 2017 (doi:10.1016/j.isprsjprs.2017.06.013) the review.

## Caveats

- The Landsat and Sentinel-2 segments of every series are drawn with the Landsat years shaded; a break
  that sits exactly on the 2017 sensor boundary is suspect until the frames on both sides are looked at
  (Wulder et al. 2019, doi:10.1016/j.rse.2019.02.015 on cross-sensor consistency).
- The Otsu series measures bare ground, which in a desert saturates at the envelope; there the learned
  series carry the signal, and before 2017 only the cross-sensor forest does.
- Nulls are honest: a year with a cloudy envelope is a hole in the chart, never an interpolated value.
- The dense series depends on how cloudy the site is; an Andean site keeps a fraction of its dates and
  the harmonic fit then has fewer points per season than a desert site.
