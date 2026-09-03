// The twelve methods as the app states them, transcribed from the docs wiki (docs/methods/01 to 06): the
// question each answers, where it runs, its equations (KaTeX), its sources with DOIs, and its caveats.
// Both languages live here; a method appears only once its page exists and its tests pass.

export type Lang = 'en' | 'es';
export type Lane = 'live' | 'baked' | 'both';

export interface Source {
  text: string;
  doi?: string;
  url?: string;
}

export interface MethodEntry {
  id: string; // M1 .. M12
  question: 'look' | 'find' | 'change' | 'relief';
  lane: Lane;
  doc: string; // docs/methods page
  name: Record<Lang, string>;
  summary: Record<Lang, string>;
  equations: Array<{ tex: string; label?: Record<Lang, string> }>;
  sources: Source[];
  caveats: Record<Lang, string[]>;
  where: Record<Lang, string>;
}

const REPO_DOCS = 'https://github.com/fsantibanezleal/CAOS_Rajo/blob/main/docs/methods/';

export const QUESTIONS: Record<MethodEntry['question'], Record<Lang, string>> = {
  look: { en: 'What am I looking at?', es: 'Que estoy mirando?' },
  find: { en: 'Where is the mine?', es: 'Donde esta la mina?' },
  change: { en: 'How did it change?', es: 'Como cambio?' },
  relief: { en: 'How much rock moved?', es: 'Cuanta roca se movio?' },
};

export const METHODS: MethodEntry[] = [
  {
    id: 'M1',
    question: 'look',
    lane: 'both',
    doc: '01_composites-and-indices.md',
    name: { en: 'Colour composites', es: 'Compuestos de color' },
    summary: {
      en: 'True colour (B4, B3, B2), false colour with the near infrared (B8, B4, B3) and the SWIR geology combination (B12, B8, B4). Each channel is clipped to its 2nd and 98th percentile over valid pixels and raised to a gamma of 1/1.35; the clip values are printed next to the composite and stored per frame, so a stretch is never hidden.',
      es: 'Color verdadero (B4, B3, B2), falso color con el infrarrojo cercano (B8, B4, B3) y la combinacion geologica SWIR (B12, B8, B4). Cada canal se recorta a sus percentiles 2 y 98 sobre los pixeles validos y se eleva a un gamma de 1/1.35; los valores de recorte se imprimen junto al compuesto y se guardan por cuadro, asi un estiramiento nunca se oculta.',
    },
    equations: [{ tex: '\\rho_b = \\frac{\\mathrm{DN} - 1000}{10000} \\;\\text{(Sentinel-2, baseline 04.00+)},\\qquad \\rho_b = 0.0000275\\,\\mathrm{DN} - 0.2 \\;\\text{(Landsat C2 L2)}', label: { en: 'Surface reflectance from the archived digital numbers', es: 'Reflectancia de superficie desde los numeros digitales archivados' } }],
    sources: [
      { text: 'van der Meer, F. D. et al. (2012), Multi- and hyperspectral geologic remote sensing: a review, Int. J. Appl. Earth Obs. Geoinf. 14, 112-128', doi: '10.1016/j.jag.2011.08.002' },
      { text: 'van der Werff, H. and van der Meer, F. (2015), Sentinel-2 for mapping iron absorption feature parameters, Remote Sens. Environ. 148, 124-133', doi: '10.1016/j.rse.2014.03.022' },
    ],
    caveats: {
      en: ['The stretch is per scene: absolute brightness is not comparable across frames; the indices are.', 'Landsat frames before 2017 map their bands to the Sentinel-2 names; cross-sensor consistency is a known limitation.'],
      es: ['El estiramiento es por escena: el brillo absoluto no es comparable entre cuadros; los indices si.', 'Los cuadros Landsat anteriores a 2017 mapean sus bandas a los nombres Sentinel-2; la consistencia entre sensores es una limitacion conocida.'],
    },
    where: { en: 'Live in the Look view on the latest clear Sentinel-2 scene; baked as the yearly frames.', es: 'En vivo en la vista Mirar sobre la escena Sentinel-2 mas reciente; cocinado como los cuadros anuales.' },
  },
  {
    id: 'M2',
    question: 'look',
    lane: 'both',
    doc: '01_composites-and-indices.md',
    name: { en: 'Spectral indices', es: 'Indices espectrales' },
    summary: {
      en: 'Six normalised differences computed per pixel from surface reflectance: vegetation (NDVI), water (NDWI, MNDWI), built-up and bare rock (NDBI), bare soil (BSI) and burn (NBR). Invalid pixels (no data, cloud, shadow, cirrus per the scene classification) are excluded from every statistic, and a difference of two near-zero reflectances is NaN rather than noise.',
      es: 'Seis diferencias normalizadas por pixel desde la reflectancia de superficie: vegetacion (NDVI), agua (NDWI, MNDWI), construido y roca desnuda (NDBI), suelo desnudo (BSI) y quema (NBR). Los pixeles invalidos (sin dato, nube, sombra, cirro segun la clasificacion de escena) quedan fuera de toda estadistica, y una diferencia de dos reflectancias cercanas a cero es NaN y no ruido.',
    },
    equations: [
      { tex: '\\mathrm{NDVI} = \\frac{\\rho_{B8} - \\rho_{B4}}{\\rho_{B8} + \\rho_{B4}}' },
      { tex: '\\mathrm{MNDWI} = \\frac{\\rho_{B3} - \\rho_{B11}}{\\rho_{B3} + \\rho_{B11}}, \\qquad \\mathrm{NDBI} = \\frac{\\rho_{B11} - \\rho_{B8}}{\\rho_{B11} + \\rho_{B8}}' },
      { tex: '\\mathrm{BSI} = \\frac{(\\rho_{B11} + \\rho_{B4}) - (\\rho_{B8} + \\rho_{B2})}{(\\rho_{B11} + \\rho_{B4}) + (\\rho_{B8} + \\rho_{B2})}' },
    ],
    sources: [
      { text: 'Rouse, J. W. et al. (1974), Monitoring vegetation systems in the Great Plains with ERTS, Third ERTS Symposium, NASA SP-351, 309-317' },
      { text: 'McFeeters, S. K. (1996), The use of the Normalized Difference Water Index (NDWI) in the delineation of open water features, Int. J. Remote Sens. 17(7), 1425-1432', doi: '10.1080/01431169608948714' },
      { text: 'Xu, H. (2006), Modification of normalised difference water index (NDWI) to enhance open water features in remotely sensed imagery, Int. J. Remote Sens. 27(14), 3025-3033', doi: '10.1080/01431160600589179' },
      { text: 'Zha, Y., Gao, J. and Ni, S. (2003), Use of normalized difference built-up index in automatically mapping urban areas from TM imagery, Int. J. Remote Sens. 24(3), 583-594', doi: '10.1080/01431160304987' },
      { text: 'Rikimaru, A., Roy, P. S. and Miyatake, S. (2002), Tropical forest cover density mapping, Tropical Ecology 43(1), 39-47' },
    ],
    caveats: {
      en: ['Bright salt crusts mimic water in NDWI; MNDWI separates ponds from salt and tailings better, which is why it is the water test inside the bare-ground mask.', 'Deserts are bare everywhere: BSI needs a threshold that respects the scene (M4).'],
      es: ['Las costras de sal brillantes imitan agua en NDWI; MNDWI separa mejor las pozas de la sal y los relaves, por eso es la prueba de agua dentro de la mascara de suelo desnudo.', 'Los desiertos son desnudos en todas partes: BSI necesita un umbral que respete la escena (M4).'],
    },
    where: { en: 'Live in the Look view with a perceptually uniform colormap, histogram, statistics and a cursor readout; the envelope means per year in the series drawer.', es: 'En vivo en la vista Mirar con un mapa de color perceptualmente uniforme, histograma, estadisticas y lectura bajo el cursor; las medias de la envolvente por ano en el cajon de series.' },
  },
  {
    id: 'M3',
    question: 'look',
    lane: 'live',
    doc: '02_mineral-ratios.md',
    name: { en: 'Mineral group ratios', es: 'Razones de grupos minerales' },
    summary: {
      en: 'Band ratios that respond to the broad absorption features of mineral groups: iron oxides (red over blue), hydroxyl-bearing clays and carbonates (B11 over B12) and ferrous minerals (B12 over the near infrared). With two shortwave-infrared bands Sentinel-2 cannot resolve species, so the app labels them indicators, never mineral maps.',
      es: 'Razones de bandas que responden a los rasgos de absorcion amplios de grupos minerales: oxidos de hierro (rojo sobre azul), arcillas con hidroxilo y carbonatos (B11 sobre B12) y minerales ferrosos (B12 sobre el infrarrojo cercano). Con dos bandas SWIR Sentinel-2 no resuelve especies, asi que la app los llama indicadores, nunca mapas minerales.',
    },
    equations: [
      { tex: 'R_{\\mathrm{Fe}^{3+}} = \\frac{\\rho_{B4}}{\\rho_{B2}}, \\qquad R_{\\mathrm{OH}} = \\frac{\\rho_{B11}}{\\rho_{B12}}, \\qquad R_{\\mathrm{Fe}^{2+}} = \\frac{\\rho_{B12}}{\\rho_{B8A}}' },
    ],
    sources: [
      { text: 'Sabins, F. F. (1999), Remote sensing for mineral exploration, Ore Geology Reviews 14, 157-183', doi: '10.1016/S0169-1368(99)00007-4' },
      { text: 'van der Werff, H. and van der Meer, F. (2016), Sentinel-2 for mapping iron absorption feature parameters, Remote Sensing 8(10)', doi: '10.3390/rs71012635' },
      { text: 'Ge, W. et al. (2020), Assessment of the capability of Sentinel-2 imagery for iron-bearing minerals mapping: a case study in the Cuprite area, Nevada, Remote Sensing 12(18), 3028', doi: '10.3390/rs12183028' },
    ],
    caveats: {
      en: ['The ratios respond to oxidised waste and leach pads as much as to outcrop.', 'Shadowed pit walls lower every band and can shift ratios; atmospheric residuals affect the blue band most, so the iron ratio is the noisiest.'],
      es: ['Las razones responden a residuos oxidados y pilas de lixiviacion tanto como al afloramiento.', 'Las paredes en sombra bajan todas las bandas y pueden correr las razones; los residuos atmosfericos afectan mas a la banda azul, asi que la razon de hierro es la mas ruidosa.'],
    },
    where: { en: 'Live in the Look view (mineral group indicators).', es: 'En vivo en la vista Mirar (indicadores de grupos minerales).' },
  },
  {
    id: 'M4',
    question: 'find',
    lane: 'both',
    doc: '03_classical-delineation.md',
    name: { en: 'Otsu bare-ground mask', es: 'Mascara de suelo desnudo por Otsu' },
    summary: {
      en: "Otsu's threshold on the BSI histogram (the middle of the optimal plateau, not its first bin), combined with a vegetation test (NDVI below 0.2) and a water test (MNDWI below 0), then a 3 x 3 opening and the removal of small 4-connected components. The threshold slider lets the reader move the cut and watch the area respond.",
      es: 'El umbral de Otsu sobre el histograma de BSI (el centro de la meseta optima, no su primer bin), combinado con una prueba de vegetacion (NDVI bajo 0.2) y una de agua (MNDWI bajo 0), luego una apertura 3 x 3 y la eliminacion de componentes 4-conexas pequenas. El deslizador del umbral deja mover el corte y ver como responde el area.',
    },
    equations: [
      { tex: 't^* = \\arg\\max_t\\; \\omega_0(t)\\,\\omega_1(t)\\,\\left[\\mu_0(t) - \\mu_1(t)\\right]^2' },
      { tex: 'M = [\\mathrm{BSI} > t^*] \\wedge [\\mathrm{NDVI} < 0.2] \\wedge [\\mathrm{MNDWI} < 0]' },
    ],
    sources: [{ text: 'Otsu, N. (1979), A threshold selection method from gray-level histograms, IEEE Trans. Syst. Man Cybern. 9(1), 62-66', doi: '10.1109/TSMC.1979.4310076' }],
    caveats: {
      en: ['In a desert the whole scene is bare, so the bimodality Otsu needs is between darker rock and brighter mined ground, and the threshold drifts with the season.', 'Works best over vegetated sites (Carajas, Hambach, Athabasca).'],
      es: ['En un desierto toda la escena es desnuda, asi que la bimodalidad que Otsu necesita esta entre roca mas oscura y suelo minado mas claro, y el umbral deriva con la estacion.', 'Funciona mejor en sitios con vegetacion (Carajas, Hambach, Athabasca).'],
    },
    where: { en: 'Live in the Find view; baked on every frame as the otsu series.', es: 'En vivo en la vista Encontrar; cocinado sobre cada cuadro como la serie otsu.' },
  },
  {
    id: 'M5',
    question: 'find',
    lane: 'live',
    doc: '03_classical-delineation.md',
    name: { en: 'k-means on the spectra', es: 'k-means sobre los espectros' },
    summary: {
      en: 'Each valid pixel is a vector of the six reflectances plus NDVI and MNDWI, standardised feature by feature; k-means++ seeding, Lloyd iterations on a stratified sample, then every pixel assigned to its nearest centroid with a seeded generator, so a run is reproducible. The table shows each cluster area and centroid spectrum; the reader decides which clusters are the mine, the honest limit of an unsupervised method.',
      es: 'Cada pixel valido es un vector de las seis reflectancias mas NDVI y MNDWI, estandarizado atributo por atributo; siembra k-means++, iteraciones de Lloyd sobre una muestra estratificada y luego cada pixel asignado a su centroide mas cercano con un generador con semilla, asi una corrida es reproducible. La tabla muestra el area y el espectro de cada cluster; el lector decide cuales son la mina, el limite honesto de un metodo no supervisado.',
    },
    equations: [{ tex: '\\arg\\min_{S}\\; \\sum_{j=1}^{k} \\sum_{\\mathbf{x} \\in S_j} \\lVert \\mathbf{z}(\\mathbf{x}) - \\boldsymbol{\\mu}_j \\rVert^2' }],
    sources: [
      { text: 'Lloyd, S. P. (1982), Least squares quantization in PCM, IEEE Trans. Inf. Theory 28(2), 129-137', doi: '10.1109/TIT.1982.1056489' },
      { text: 'Arthur, D. and Vassilvitskii, S. (2007), k-means++: the advantages of careful seeding, SODA 2007, 1027-1035' },
    ],
    caveats: {
      en: ['Clusters are spectral, not semantic: the pit and a road can share one, and shadow splits a material in two.'],
      es: ['Los clusters son espectrales, no semanticos: el rajo y un camino pueden compartir uno, y la sombra parte un material en dos.'],
    },
    where: { en: 'Live in the Find view; in the benchmark the cluster with the highest mean BSI among low-NDVI clusters is scored.', es: 'En vivo en la vista Encontrar; en el benchmark se evalua el cluster de mayor BSI medio entre los de NDVI bajo.' },
  },
  {
    id: 'M6',
    question: 'find',
    lane: 'live',
    doc: '03_classical-delineation.md',
    name: { en: 'Spectral angle mapper', es: 'Mapeador de angulo espectral' },
    summary: {
      en: 'The angle between each six-band pixel spectrum and an endmember: the mean spectrum of the pixels inside the reference mining polygons on this very scene, or the brightest bare quartile when no polygon lands on the grid. The angle ignores the magnitude of the spectrum, so shadowed pit walls, the same material at lower illumination, still match.',
      es: 'El angulo entre el espectro de seis bandas de cada pixel y un endmember: el espectro medio de los pixeles dentro de los poligonos mineros de referencia sobre esta misma escena, o el cuartil desnudo mas brillante cuando ningun poligono cae en la grilla. El angulo ignora la magnitud del espectro, asi que las paredes en sombra, el mismo material con menos iluminacion, igual coinciden.',
    },
    equations: [{ tex: '\\theta(\\mathbf{x}, \\mathbf{e}) = \\arccos\\frac{\\mathbf{x}\\cdot\\mathbf{e}}{\\lVert\\mathbf{x}\\rVert\\,\\lVert\\mathbf{e}\\rVert}, \\qquad M = [\\theta \\le \\theta^*]' }],
    sources: [{ text: 'Kruse, F. A. et al. (1993), The spectral image processing system (SIPS): interactive visualization and analysis of imaging spectrometer data, Remote Sens. Environ. 44, 145-163', doi: '10.1016/0034-4257(93)90013-N' }],
    caveats: {
      en: ['The endmember is the reference polygons themselves, so the method is supervised by the dataset it is compared with; the benchmark chooses the angle on validation tiles and freezes it.'],
      es: ['El endmember son los propios poligonos de referencia, asi que el metodo esta supervisado por el dataset con que se compara; el benchmark elige el angulo en teselas de validacion y lo congela.'],
    },
    where: { en: 'Live in the Find view with the angle slider.', es: 'En vivo en la vista Encontrar con el deslizador del angulo.' },
  },
  {
    id: 'M7',
    question: 'find',
    lane: 'both',
    doc: '04_learned-delineation.md',
    name: { en: 'Random forest on per-pixel features', es: 'Bosque aleatorio sobre atributos por pixel' },
    summary: {
      en: 'Sixteen features per pixel (six bands, four indices, three mineral ratios, three 3 x 3 textures), computed identically in Python and in the browser and pinned by a golden fixture. Trained on two million pixels from the Jasansky et al. 2024 tiles with balanced class weights; bounded on purpose (64 trees, depth 12, 50 samples per leaf) because it ships as an ONNX tree ensemble. Every catalog site was held out.',
      es: 'Dieciseis atributos por pixel (seis bandas, cuatro indices, tres razones minerales, tres texturas 3 x 3), calculados igual en Python y en el navegador y fijados por un fixture dorado. Entrenado con dos millones de pixeles de las teselas de Jasansky et al. 2024 con pesos de clase balanceados; acotado a proposito (64 arboles, profundidad 12, 50 muestras por hoja) porque viaja como un ensamble de arboles ONNX. Todos los sitios del catalogo quedaron fuera.',
    },
    equations: [{ tex: 'p(\\text{mine} \\mid \\mathbf{f}) = \\frac{1}{T}\\sum_{t=1}^{T} h_t(\\mathbf{f}), \\qquad \\mathbf{f} \\in \\mathbb{R}^{16}' }],
    sources: [
      { text: 'Breiman, L. (2001), Random forests, Machine Learning 45, 5-32', doi: '10.1023/A:1010933404324' },
      { text: 'Jasansky, S., Maus, V., Popa, N. and Wilbik, A. (2024), Global ML-ready dataset for mining areas in satellite images', doi: '10.5281/zenodo.14195737' },
    ],
    caveats: {
      en: ['Trained on Sentinel-2 at 10 m: the Landsat years of the baked series are a domain shift and carry the flag cross_sensor.', 'The forest sees 3 x 3 neighbourhoods and nothing larger.'],
      es: ['Entrenado con Sentinel-2 a 10 m: los anos Landsat de la serie cocinada son un cambio de dominio y llevan la bandera cross_sensor.', 'El bosque ve vecindarios 3 x 3 y nada mayor.'],
    },
    where: { en: 'Live in the Find view (onnxruntime-web, CPU provider); baked on every frame as the rf series.', es: 'En vivo en la vista Encontrar (onnxruntime-web, proveedor CPU); cocinado sobre cada cuadro como la serie rf.' },
  },
  {
    id: 'M8',
    question: 'find',
    lane: 'both',
    doc: '04_learned-delineation.md',
    name: { en: 'U-Net semantic segmentation', es: 'Segmentacion semantica U-Net' },
    summary: {
      en: 'A four-level encoder-decoder with skip connections (base width 32, 7.85 million parameters) on the six bands at 10 m, trained with binary cross-entropy plus Dice over valid pixels, mixed precision, augmentations and early stopping on validation IoU. Exported to ONNX (opset 17, dynamic axes), it runs in the browser in 512 px windows with overlap blending on the WebGPU provider when the page has one and on single-thread WASM otherwise.',
      es: 'Un codificador-decodificador de cuatro niveles con conexiones de salto (ancho base 32, 7.85 millones de parametros) sobre las seis bandas a 10 m, entrenado con entropia cruzada binaria mas Dice sobre pixeles validos, precision mixta, aumentos y parada temprana por IoU de validacion. Exportado a ONNX (opset 17, ejes dinamicos), corre en el navegador en ventanas de 512 px con mezcla de solape sobre el proveedor WebGPU cuando la pagina lo tiene y sobre WASM de un hilo si no.',
    },
    equations: [{ tex: '\\mathcal{L} = \\mathrm{BCE} + \\left(1 - \\frac{2\\sum_i p_i g_i + \\epsilon}{\\sum_i p_i + \\sum_i g_i + \\epsilon}\\right)' }],
    sources: [
      { text: 'Ronneberger, O., Fischer, P. and Brox, T. (2015), U-Net: convolutional networks for biomedical image segmentation, MICCAI', doi: '10.1007/978-3-319-24574-4_28' },
      { text: 'Milletari, F., Navab, N. and Ahmadi, S.-A. (2016), V-Net: fully convolutional neural networks for volumetric medical image segmentation, 3DV', doi: '10.1109/3DV.2016.79' },
      { text: 'MacDonald, E., Jacoby, D. and Coady, Y. (2023), MineSegSAT: an automated system to evaluate mining disturbed area extents from Sentinel-2 imagery', url: 'https://arxiv.org/abs/2311.01676' },
      { text: 'Gallwey, J. et al. (2020), A Sentinel-2 based multispectral convolutional neural network for detecting artisanal small-scale mining in Ghana, Remote Sens. Environ. 248, 111970', doi: '10.1016/j.rse.2020.111970' },
    ],
    caveats: {
      en: ['The labels are polygons of mining land use, not ore and not disturbance of a given year: a rehabilitated dump stays inside the polygon.', 'Evaluated on Sentinel-2 only; the Landsat frames are not its domain, so the baked unet series starts in 2017.'],
      es: ['Las etiquetas son poligonos de uso minero del suelo, no mineral ni perturbacion de un ano dado: un botadero rehabilitado sigue dentro del poligono.', 'Evaluado solo con Sentinel-2; los cuadros Landsat no son su dominio, asi que la serie unet cocinada empieza en 2017.'],
    },
    where: { en: 'Live in the Find view (coarse or full grid); baked on the Sentinel-2 frames as the unet series.', es: 'En vivo en la vista Encontrar (grilla gruesa o completa); cocinado sobre los cuadros Sentinel-2 como la serie unet.' },
  },
  {
    id: 'M9',
    question: 'change',
    lane: 'live',
    doc: '05_change-detection.md',
    name: { en: 'Change vector analysis', es: 'Analisis de vector de cambio' },
    summary: {
      en: 'For two live dates, the difference of the index vector (NDVI, MNDWI, BSI, the hydroxyl ratio): its magnitude flags change above an Otsu threshold and its direction separates vegetation to bare (a new pit or dump), bare to water (a new pond) and water to salt (a pond drying).',
      es: 'Para dos fechas en vivo, la diferencia del vector de indices (NDVI, MNDWI, BSI, la razon de hidroxilo): su magnitud marca cambio sobre un umbral de Otsu y su direccion separa vegetacion a desnudo (un rajo o botadero nuevo), desnudo a agua (una poza nueva) y agua a sal (una poza que se seca).',
    },
    equations: [{ tex: '\\Delta\\mathbf{v} = \\mathbf{v}(t_2) - \\mathbf{v}(t_1), \\qquad \\lVert\\Delta\\mathbf{v}\\rVert_2, \\qquad \\phi = \\operatorname{atan2}(\\Delta\\mathrm{BSI}, -\\Delta\\mathrm{NDVI})' }],
    sources: [{ text: 'Malila, W. A. (1980), Change vector analysis: an approach for detecting forest changes with Landsat, LARS Symposia, Purdue University' }],
    caveats: {
      en: ['Two dates in different seasons change the illumination and the vegetation before the land does; pick the same season.'],
      es: ['Dos fechas en estaciones distintas cambian la iluminacion y la vegetacion antes que el suelo; elija la misma estacion.'],
    },
    where: { en: 'Live, between two Sentinel-2 reads of the same window.', es: 'En vivo, entre dos lecturas Sentinel-2 de la misma ventana.' },
  },
  {
    id: 'M10',
    question: 'change',
    lane: 'both',
    doc: '05_change-detection.md',
    name: { en: 'CUSUM and PELT change points', es: 'Puntos de cambio CUSUM y PELT' },
    summary: {
      en: 'On the yearly mined-area series of each method inside the site envelope: a one-sided CUSUM on the first differences (target the median difference, k = 0.5 sigma, h = 4 sigma, reset after an alarm) and PELT with the L2 cost of a piecewise-constant mean, minimum segment three years and penalty 3 sigma squared log n, both scaled by a robust noise estimate (1.4826 times the MAD of the differences). The in-house solver agrees with ruptures; the browser reruns it with a penalty slider.',
      es: 'Sobre la serie anual de area minada de cada metodo dentro de la envolvente del sitio: un CUSUM unilateral sobre las primeras diferencias (objetivo la mediana de la diferencia, k = 0.5 sigma, h = 4 sigma, reinicio tras una alarma) y PELT con el costo L2 de una media constante por tramos, segmento minimo de tres anos y penalizacion 3 sigma al cuadrado log n, ambos escalados por una estimacion robusta del ruido (1.4826 veces la MAD de las diferencias). El solucionador propio coincide con ruptures; el navegador lo reejecuta con un deslizador de penalizacion.',
    },
    equations: [
      { tex: 'S_0 = 0,\\qquad S_t = \\max\\bigl(0,\\; S_{t-1} + (\\Delta A_t - \\mu_0 - k)\\bigr),\\qquad \\text{alarm when } S_t > h' },
      { tex: '\\min_{\\tau}\\; \\sum_{i=1}^{m+1} \\mathcal{C}\\bigl(A_{\\tau_{i-1}+1:\\tau_i}\\bigr) + \\beta m, \\qquad \\beta = 3\\sigma^2 \\log n' },
    ],
    sources: [
      { text: 'Page, E. S. (1954), Continuous inspection schemes, Biometrika 41, 100-115', doi: '10.1093/biomet/41.1-2.100' },
      { text: 'Killick, R., Fearnhead, P. and Eckley, I. A. (2012), Optimal detection of changepoints with a linear computational cost, J. Am. Stat. Assoc. 107(500), 1590-1598', doi: '10.1080/01621459.2012.737745' },
      { text: 'Truong, C., Oudre, L. and Vayatis, N. (2020), Selective review of offline change point detection methods, Signal Processing 167, 107299', doi: '10.1016/j.sigpro.2019.107299' },
    ],
    caveats: {
      en: ['A year with a cloudy envelope is a null, never an interpolated value.', 'A break that sits on the 2017 sensor boundary is suspect until the frames on both sides are looked at.'],
      es: ['Un ano con la envolvente nublada es un nulo, nunca un valor interpolado.', 'Un quiebre que cae en el borde de sensor de 2017 es sospechoso hasta mirar los cuadros a ambos lados.'],
    },
    where: { en: 'Baked in the series stage; rerun live in the series drawer.', es: 'Cocinado en la etapa de series; reejecutado en vivo en el cajon de series.' },
  },
  {
    id: 'M11',
    question: 'change',
    lane: 'both',
    doc: '05_change-detection.md',
    name: { en: 'Harmonic regression with breaks', es: 'Regresion armonica con quiebres' },
    summary: {
      en: 'On the dense Sentinel-2 series of the envelope mean of BSI (every clear date since 2017 at 60 m): a trend plus two harmonics of the annual cycle, fitted piecewise between break dates found by an exhaustive search over one or two breaks with a minimum segment of a year, accepted only when the BIC of the broken model beats the unbroken one. BFAST-style, not the BFAST package.',
      es: 'Sobre la serie densa Sentinel-2 de la media de BSI en la envolvente (cada fecha despejada desde 2017 a 60 m): una tendencia mas dos armonicos del ciclo anual, ajustados por tramos entre fechas de quiebre halladas por busqueda exhaustiva sobre uno o dos quiebres con un segmento minimo de un ano, aceptadas solo cuando el BIC del modelo con quiebre supera al sin quiebre. Al estilo BFAST, no el paquete BFAST.',
    },
    equations: [{ tex: 'y_t = \\alpha + \\beta t + \\sum_{k=1}^{2}\\left[\\gamma_k \\cos\\frac{2\\pi k t}{T} + \\delta_k \\sin\\frac{2\\pi k t}{T}\\right] + \\varepsilon_t, \\qquad T = 365.25\\;\\text{d}' }],
    sources: [
      { text: 'Verbesselt, J., Hyndman, R., Newnham, G. and Culvenor, D. (2010), Detecting trend and seasonal changes in satellite image time series, Remote Sens. Environ. 114, 106-115', doi: '10.1016/j.rse.2009.08.014' },
      { text: 'Zhu, Z. and Woodcock, C. E. (2014), Continuous change detection and classification of land cover using all available Landsat data, Remote Sens. Environ. 144, 152-171', doi: '10.1016/j.rse.2014.01.011' },
      { text: 'Zhu, Z. (2017), Change detection using Landsat time series: a review of frequencies, preprocessing, algorithms, and applications, ISPRS J. Photogramm. Remote Sens. 130, 370-384', doi: '10.1016/j.isprsjprs.2017.06.013' },
    ],
    caveats: {
      en: ['The dense series depends on how cloudy the site is; an Andean site keeps a fraction of its dates.'],
      es: ['La serie densa depende de cuan nublado es el sitio; un sitio andino conserva una fraccion de sus fechas.'],
    },
    where: { en: 'Baked in the dense and series stages; charted in the series drawer.', es: 'Cocinado en las etapas dense y series; graficado en el cajon de series.' },
  },
  {
    id: 'M12',
    question: 'relief',
    lane: 'both',
    doc: '06_relief-and-volumes.md',
    name: { en: 'DEM differencing, profiles and volumes', es: 'Diferencia de DEM, perfiles y volumenes' },
    summary: {
      en: 'SRTM (February 2000) and the Copernicus DEM (TanDEM-X, 2011 to 2015) warped onto the site grid at 30 m; SRTM moved from EGM96 to EGM2008 with the geoid difference at the site; the median offset over stable ground removed; the noise floor measured there (robust scale of the difference outside the envelope on slopes below 10 degrees); cut and fill summed beyond twice that floor. The Copernicus surface is also baked as terrain tiles, so the map can switch epoch and the profile tool reads both surfaces in the browser.',
      es: 'SRTM (febrero de 2000) y el DEM Copernicus (TanDEM-X, 2011 a 2015) reproyectados a la grilla del sitio a 30 m; SRTM llevado de EGM96 a EGM2008 con la diferencia de geoide en el sitio; el sesgo mediano sobre terreno estable removido; el piso de ruido medido alli (escala robusta de la diferencia fuera de la envolvente con pendiente bajo 10 grados); corte y relleno sumados mas alla del doble de ese piso. La superficie Copernicus tambien se cocina como teselas de terreno, asi el mapa cambia de epoca y la herramienta de perfil lee ambas superficies en el navegador.',
    },
    equations: [
      { tex: '\\Delta h = h_{\\mathrm{COP}} - \\bigl(h_{\\mathrm{SRTM}} + (N_{96} - N_{2008})\\bigr) - b, \\qquad \\tau = 2 \\cdot 1.4826\\,\\mathrm{MAD}(\\Delta h_{\\text{stable}})' },
      { tex: 'V_{\\mathrm{cut}} = \\sum_{\\Delta h < -\\tau} |\\Delta h|\\, a, \\qquad V_{\\mathrm{fill}} = \\sum_{\\Delta h > \\tau} \\Delta h\\, a, \\qquad a = 900\\;\\text{m}^2' },
    ],
    sources: [
      { text: 'Farr, T. G. et al. (2007), The Shuttle Radar Topography Mission, Reviews of Geophysics 45, RG2004', doi: '10.1029/2005RG000183' },
      { text: 'Rizzoli, P. et al. (2017), Generation and performance assessment of the global TanDEM-X digital elevation model, ISPRS J. Photogramm. Remote Sens. 132, 119-139', doi: '10.1016/j.isprsjprs.2017.08.008' },
      { text: 'Remote Sensing 13(9), 1861 (2021), SRTM minus TanDEM-X over an open pit', doi: '10.3390/rs13091861' },
    ],
    caveats: {
      en: ['Both are radar surface models and the interval is a single decade: a pit deepened after 2015 shows nothing here.', 'Water and brine ponds are unreliable in both radars; a change below the threshold is invisible by construction.'],
      es: ['Ambos son modelos radar de superficie y el intervalo es una sola decada: un rajo profundizado despues de 2015 no muestra nada aqui.', 'Las pozas de agua y salmuera son poco fiables en ambos radares; un cambio bajo el umbral es invisible por construccion.'],
    },
    where: { en: 'Baked in the dem stage; the Relief tab drapes the difference, switches the epoch and draws the profile.', es: 'Cocinado en la etapa dem; la pestana Relieve drapea la diferencia, cambia la epoca y dibuja el perfil.' },
  },
];

export function docUrl(entry: MethodEntry): string {
  return `${REPO_DOCS}${entry.doc}`;
}
