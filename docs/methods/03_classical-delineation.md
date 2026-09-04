# 03 Classical delineation of disturbed land (M4, M5, M6)

Question answered: where is the mine? Three classical answers on one scene, each with its area and a
comparison with the reference polygons (Maus et al. 2022), all running live in the browser (Find view)
and, from the masks unit, in the bake on every frame. "Mine" means the land the reference datasets call
mining land: pits, dumps, tailings, ponds, plants. None of these methods knows what ore is.

## M4 Otsu threshold on the bare-soil index

Otsu's threshold $t^*$ maximises the between-class variance of the BSI histogram:

$$t^* = \arg\max_t\; \omega_0(t)\,\omega_1(t)\,\left[\mu_0(t) - \mu_1(t)\right]^2$$

where $\omega_0, \omega_1$ are the class weights and $\mu_0, \mu_1$ the class means below and above $t$.
Between two separated modes the criterion is flat across the empty bins, so the implementation returns the
middle of the optimal plateau rather than its first bin (the first bin sits on the shoulder of the lower
mode; the unit test on a bimodal histogram caught that). The mask is then

$$M = [\mathrm{BSI} > t^*] \wedge [\mathrm{NDVI} < 0.2] \wedge [\mathrm{MNDWI} < 0]$$

followed by a $3 \times 3$ morphological opening (erosion then dilation, which removes one-pixel specks
and thin lines) and the removal of 4-connected components smaller than a minimum size (20 pixels live).
The threshold slider lets the reader move $t$ and see the area respond; the Otsu value is the default.

Source: Otsu, N. (1979), A threshold selection method from gray-level histograms, IEEE Trans. Syst. Man
Cybern. 9(1), 62-66, doi:10.1109/TSMC.1979.4310076.

Where it fails: in a desert the whole scene is bare, so the bimodality Otsu needs is between darker rock
and brighter mined ground, and the threshold drifts with the season's illumination; over vegetated sites
(Carajas, Hambach, Athabasca) it works best.

## M5 k-means on the spectra

Each valid pixel is a vector of the six reflectances plus NDVI and MNDWI, standardised feature by feature
(mean and standard deviation over the valid pixels). k-means++ seeding, then Lloyd iterations to
convergence (at most 30) on a stratified sample of up to 40,000 pixels, then the assignment of every pixel
to its nearest centroid; the generator is seeded, so a run is reproducible. Clusters are ordered from dark
to bright (by the mean of the six de-standardised reflectances) so their colours are stable between runs
and sites. The table shows each cluster's area and centroid spectrum; the reader decides which clusters
are the mine, which is the honest limit of an unsupervised method.

Sources: Lloyd, S. P. (1982), Least squares quantization in PCM, IEEE Trans. Inf. Theory 28(2), 129-137,
doi:10.1109/TIT.1982.1056489; Arthur, D. and Vassilvitskii, S. (2007), k-means++: the advantages of careful
seeding, SODA 2007, 1027-1035 (ACM, no DOI in the proceedings index).

## M6 Spectral angle mapper

$$\theta(\mathbf{x}, \mathbf{e}) = \arccos\frac{\mathbf{x}\cdot\mathbf{e}}{\lVert\mathbf{x}\rVert\,\lVert\mathbf{e}\rVert}$$

where $\mathbf{x}$ is the six-band pixel spectrum and $\mathbf{e}$ the endmember: the mean spectrum of the
pixels inside the reference mining polygons on this very scene (rasterised onto the live grid with an
even-odd scanline fill), or, when no polygon lands on the grid, the mean of the brightest bare quartile.
The mask is $\theta \le \theta^*$; the angle slider sets $\theta^*$ (0.12 rad by default). The angle
ignores the magnitude of the spectrum, so shadowed pit walls, which are the same material at lower
illumination, still match, which is the property the other two methods lack.

Source: Kruse, F. A. et al. (1993), The spectral image processing system (SIPS): interactive visualization
and analysis of imaging spectrometer data, Remote Sens. Environ. 44, 145-163,
doi:10.1016/0034-4257(93)90013-N.

## Reading the results

Every method reports its masked area in km2 next to the area of the reference polygons on the same grid,
and the cursor readout shows the underlying value (BSI, cluster, angle) of the pixel under the pointer.
Differences between the three are the point: the bare-soil threshold over-reaches on desert sites, the
clusters split the pit from the dumps and the ponds, and the spectral angle follows the reference's
material into shadow. The learned methods (M7, M8) are evaluated against the same reference on held-out
sites in the benchmark.

Implementation: `frontend/src/lib/indices.ts` (Otsu, morphology, components), `frontend/src/workers/
indices.worker.ts` (k-means, spectral angle), `frontend/src/lib/rasterize.ts` (reference mask); tests in
`indices.test.ts` and `rasterize.test.ts`.
