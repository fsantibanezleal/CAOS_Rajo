// Architecture / "How it works" modal content (ADR-0058), Rajo. Five tabs, each pairing ONE
// hand-authored, theme-aware, bilingual SVG (public/svg/tech/) with an explanation at complete depth.
// Copy is product-specific and describes the system as built; every file and stage named here exists.
import type { Lang } from './methods';

export interface ArchTab {
  id: string;
  svg: string;
  label: Record<Lang, string>;
  body: Record<Lang, string[]>;
}

export const ARCH_TABS: ArchTab[] = [
  {
    id: 'app',
    svg: '01-the-app.svg',
    label: { en: 'The app', es: 'La app' },
    body: {
      en: [
        'Rajo is a public observatory of the open-pit mines and lithium ponds of the world: thirty sites (twelve in Chile), each a window of 12 to 40 km on its own UTM grid, seen every year from 1985 to today (Landsat 5, 7, 8 and 9 to 2016, Sentinel-2 from 2017) and computed on in the browser from open archives. Nothing is uploaded and there is no backend.',
        'Design-build lifecycle: research first (every data source probed for CORS, range reads and licence; thirty-five papers with resolved DOIs; the plan persisted in the management repo), then the two data contracts (ingestion: the site catalog validated against the reference polygons; artifact: the manifests with bytes and sha256 of every file), then the staged offline bake (catalog, scenes, frames, masks, series, dense, dem, export, validate) run detached and in parallel, then the training of the learned models, then the SPA (React 19 + Vite, MapLibre GL, uPlot, onnxruntime-web, geotiff.js), then a static deploy with a live content check.',
        'The committed artifacts under data/derived and the ONNX models under models/ are the product; the web app replays them and adds three genuinely live lanes: Sentinel-2 reads from the cloud-optimized GeoTIFFs, the spectral and classical computations in a Web Worker, the random forest traversed in that worker from flat node arrays, and the U-Net on the WebGPU or WASM provider.',
      ],
      es: [
        'Rajo es un observatorio publico de los rajos y las pozas de litio del mundo: treinta sitios (doce en Chile), cada uno una ventana de 12 a 40 km sobre su propia grilla UTM, vistos cada ano desde 1985 hasta hoy (Landsat 5, 7, 8 y 9 hasta 2016, Sentinel-2 desde 2017) y calculados en el navegador desde archivos abiertos. Nada se sube y no hay backend.',
        'Ciclo de diseno y construccion: investigacion primero (cada fuente de datos probada por CORS, lecturas por rango y licencia; treinta y cinco articulos con DOI resuelto; el plan persistido en el repositorio de gestion), luego los dos contratos de datos (ingesta: el catalogo de sitios validado contra los poligonos de referencia; artefacto: los manifiestos con bytes y sha256 de cada archivo), luego la cocina offline por etapas (catalog, scenes, frames, masks, series, dense, dem, export, validate) corrida desacoplada y en paralelo, luego el entrenamiento de los modelos aprendidos, luego la SPA (React 19 + Vite, MapLibre GL, uPlot, onnxruntime-web, geotiff.js), luego un despliegue estatico con una verificacion de contenido en vivo.',
        'Los artefactos versionados bajo data/derived y los modelos ONNX bajo models/ son el producto; la app web los reproduce y agrega tres carriles genuinamente en vivo: lecturas Sentinel-2 desde los GeoTIFF optimizados para la nube, los calculos espectrales y clasicos en un Web Worker, y los modelos aprendidos sobre el proveedor WebGPU o WASM.',
      ],
    },
  },
  {
    id: 'lanes',
    svg: '02-lanes.svg',
    label: { en: 'Lanes: web, offline, compute', es: 'Carriles: web, offline, computo' },
    body: {
      en: [
        'Live in the web: the instrument reads the latest clear Sentinel-2 same-day group straight from the sentinel-cogs bucket (HTTP range requests through geotiff.js, a decoding pool, an abort signal) onto the site grid; the band-math worker (indices.worker.ts) computes composites, nine indices, Otsu, k-means and the spectral angle; the same worker builds the sixteen feature planes, walks the random forest from flat node arrays (forest.ts, since onnxruntime-web has no tree-ensemble kernel) and runs the U-Net through onnxruntime-web (webgpu when the page has it, wasm otherwise); the series drawer reruns PELT in TypeScript; the profile tool decodes terrarium tiles of both epochs.',
        'Offline (the bake, a Python 3.12 venv, plain scripts by path): the catalog stage validates the sites and cuts the reference polygons; scenes searches Earth Search and the Planetary Computer per site and year; frames warps the bands onto the grid (rasterio WarpedVRT), composites Landsat 7 gaps, renders WebP frames and caches the chips; masks scores every frame with Otsu, the forest and the U-Net inside the envelope; series builds the mined-area series and its change points; dense reads every clear Sentinel-2 date since 2017 at 60 m; dem differences SRTM and the Copernicus DEM and bakes the terrain tiles; export writes the manifests and validate refuses a hole.',
        'Compute (the GPU lane): fetch_tiles.py pulls the 1,207 training tiles of Jasansky et al. 2024 from Earth Search, train_rf.py fits the forest and exports it with a scikit-learn versus onnxruntime parity gate, train_unet.py trains the U-Net from a memory-mapped crop bank and export_unet.py ships fp32 and fp16 with a PyTorch versus onnxruntime parity gate; evaluate.py scores every method on the same held-out tiles. Replay is the shared fallback: the web loads the committed artifacts and never recomputes the bake.',
      ],
      es: [
        'En vivo en la web: el instrumento lee el grupo Sentinel-2 del mismo dia mas reciente y despejado directamente del bucket sentinel-cogs (peticiones HTTP por rango con geotiff.js, un pool de decodificacion, una senal de aborto) sobre la grilla del sitio; el worker de matematica de bandas (indices.worker.ts) calcula compuestos, nueve indices, Otsu, k-means y el angulo espectral; el mismo worker construye los dieciseis planos de atributos, recorre el bosque aleatorio desde arreglos planos de nodos (forest.ts, porque onnxruntime-web no tiene kernel para ensambles de arboles) y corre la U-Net con onnxruntime-web (webgpu cuando la pagina lo tiene, wasm si no); el cajon de series reejecuta PELT en TypeScript; la herramienta de perfil decodifica teselas terrarium de ambas epocas.',
        'Offline (la cocina, un venv Python 3.12, scripts planos por ruta): la etapa catalog valida los sitios y recorta los poligonos de referencia; scenes busca en Earth Search y el Planetary Computer por sitio y ano; frames reproyecta las bandas a la grilla (rasterio WarpedVRT), compone los vacios de Landsat 7, renderiza cuadros WebP y guarda los chips; masks evalua cada cuadro con Otsu, el bosque y la U-Net dentro de la envolvente; series construye la serie de area minada y sus puntos de cambio; dense lee cada fecha Sentinel-2 despejada desde 2017 a 60 m; dem diferencia SRTM y el DEM Copernicus y cocina las teselas de terreno; export escribe los manifiestos y validate rechaza un hueco.',
        'Computo (el carril GPU): fetch_tiles.py trae las 1.207 teselas de entrenamiento de Jasansky et al. 2024 desde Earth Search, train_rf.py ajusta el bosque y lo exporta con una compuerta de paridad scikit-learn contra onnxruntime, train_unet.py entrena la U-Net desde un banco de recortes mapeado en memoria y export_unet.py entrega fp32 y fp16 con una compuerta de paridad PyTorch contra onnxruntime; evaluate.py evalua cada metodo sobre las mismas teselas retenidas. La reproduccion es el respaldo comun: la web carga los artefactos versionados y nunca recomputa la cocina.',
      ],
    },
  },
  {
    id: 'webapp',
    svg: '03-web-flow.svg',
    label: { en: 'Web-app flow', es: 'Flujo de la app' },
    body: {
      en: [
        'One page is the instrument: the Observatory. A globe with 3D terrain (MapLibre GL, raster-dem terrarium tiles, hillshade, the EOX Sentinel-2 cloudless imagery and OpenFreeMap labels) holds the site window, the reference polygons, the yearly frame draped on the relief, the baked mask of the year, the DEM difference and the live raster. The rail selects the site and reads its card; the timeline plays the years (paused by default, keyboard, ticks, sensor and date, flags); the instrument panel has Look (composites, indices), Find (Otsu, k-means, SAM, random forest, U-Net) and Relief (epoch, difference, profile); the series drawer charts the mined-area series with breaks and alarms.',
        'The other pages are documentation that reads the same artifacts: Atlas (the catalog table), Methods (the twelve methods with KaTeX equations, DOIs and the held-out benchmark from models/benchmark.json), Data (sources, licences, attribution, the two contracts) and About. EN and ES, light and dark, no flash of the wrong theme; the URL carries the site (?site=).',
        'Build: copy-data.mjs overlays data/derived, models/ and the onnxruntime-web runtime into public/; contract.ts mirrors the artifact contract and gates every read; scripts/check_artifacts.py verifies bytes and sha256 on disk and at deploy time; deploy/deploy.ps1 builds, ships over ssh into a release directory, swaps the web root atomically, reloads nginx and then checks the live title, catalog and a deep link. CI runs the pipeline tests, the frontend typecheck, unit tests and build, and the repository guards.',
      ],
      es: [
        'Una pagina es el instrumento: el Observatorio. Un globo con terreno 3D (MapLibre GL, teselas raster-dem terrarium, sombreado, la imagen Sentinel-2 sin nubes de EOX y etiquetas OpenFreeMap) sostiene la ventana del sitio, los poligonos de referencia, el cuadro anual drapeado sobre el relieve, la mascara cocinada del ano, la diferencia de DEM y el raster en vivo. El riel elige el sitio y muestra su ficha; la linea de tiempo reproduce los anos (en pausa por defecto, teclado, marcas, sensor y fecha, banderas); el panel de instrumento tiene Mirar (compuestos, indices), Encontrar (Otsu, k-means, SAM, bosque aleatorio, U-Net) y Relieve (epoca, diferencia, perfil); el cajon de series grafica la serie de area minada con quiebres y alarmas.',
        'Las otras paginas son documentacion que lee los mismos artefactos: Atlas (la tabla del catalogo), Metodos (los doce metodos con ecuaciones KaTeX, DOI y el benchmark retenido desde models/benchmark.json), Datos (fuentes, licencias, atribucion, los dos contratos) y Acerca de. EN y ES, claro y oscuro, sin destello del tema equivocado; la URL lleva el sitio (?site=).',
        'Construccion: copy-data.mjs superpone data/derived, models/ y el runtime de onnxruntime-web en public/; contract.ts refleja el contrato de artefacto y controla cada lectura; scripts/check_artifacts.py verifica bytes y sha256 en disco y al desplegar; deploy/deploy.ps1 construye, envia por ssh a un directorio de release, cambia la raiz web de forma atomica, recarga nginx y luego verifica el titulo en vivo, el catalogo y un enlace profundo. CI corre las pruebas del pipeline, el typecheck del frontend, las pruebas unitarias y el build, y las guardas del repositorio.',
      ],
    },
  },
  {
    id: 'science',
    svg: '04-the-science.svg',
    label: { en: 'The science', es: 'La ciencia' },
    body: {
      en: [
        'Four questions, twelve methods, every one with its equation and its source on the Methods page. What am I looking at: surface reflectance from the Level-2 digital numbers (scale and offset per archive), composites with a printed stretch, normalised-difference indices with denominator floors, and three mineral group ratios that the app calls indicators, never mineral maps.',
        'Where is the mine: Otsu on the bare-soil index with vegetation and water tests, k-means++ on the standardised spectra, the spectral angle against the reference polygons; then the learned pair, a bounded random forest on sixteen per-pixel features and a 7.85 M parameter U-Net on the six bands, both trained on Jasansky et al. 2024 with every catalog site held out, both exported to ONNX with parity gates, both scored on the same held-out tiles as the classical three.',
        'How did it change: change vectors between two live dates; CUSUM and PELT (checked against ruptures) on the yearly mined-area series inside the envelope; a harmonic regression with breaks on the dense Sentinel-2 series. How much rock moved: the Copernicus DEM minus SRTM on the 30 m grid, geoid-corrected and de-biased on stable ground, with a measured noise floor and the cut and fill volumes beyond it.',
      ],
      es: [
        'Cuatro preguntas, doce metodos, cada uno con su ecuacion y su fuente en la pagina Metodos. Que estoy mirando: reflectancia de superficie desde los numeros digitales de nivel 2 (escala y desplazamiento por archivo), compuestos con un estiramiento impreso, indices de diferencia normalizada con pisos de denominador, y tres razones de grupos minerales que la app llama indicadores, nunca mapas minerales.',
        'Donde esta la mina: Otsu sobre el indice de suelo desnudo con pruebas de vegetacion y agua, k-means++ sobre los espectros estandarizados, el angulo espectral contra los poligonos de referencia; luego el par aprendido, un bosque aleatorio acotado sobre dieciseis atributos por pixel y una U-Net de 7,85 M de parametros sobre las seis bandas, ambos entrenados con Jasansky et al. 2024 con todos los sitios del catalogo retenidos, ambos exportados a ONNX con compuertas de paridad, ambos evaluados sobre las mismas teselas retenidas que los tres clasicos.',
        'Como cambio: vectores de cambio entre dos fechas en vivo; CUSUM y PELT (verificado contra ruptures) sobre la serie anual de area minada dentro de la envolvente; una regresion armonica con quiebres sobre la serie densa Sentinel-2. Cuanta roca se movio: el DEM Copernicus menos SRTM sobre la grilla de 30 m, corregido por geoide y sin sesgo sobre terreno estable, con un piso de ruido medido y los volumenes de corte y relleno mas alla de el.',
      ],
    },
  },
  {
    id: 'contracts',
    svg: '05-data-contracts.svg',
    label: { en: 'Data contracts', es: 'Contratos de datos' },
    body: {
      en: [
        'Contract 1, ingestion: data/examples/sites.json declares each site (id, names, ISO3 country, categories, seed, window in km, first year, season months, facts with a source URL); the catalog stage refuses a seed farther than 3 km from a reference polygon, a window outside 4 to 40 km, a fact without a source, and it writes site.json (the UTM grid: a width that is a multiple of three so the 30 m Landsat grid nests inside the 10 m one) and polygons.geojson.',
        'Contract 2, artifact: every stage writes a JSON side-car (scenes, frames with gaps, masks, series, dense, dem) and the export stage assembles manifest.json per site with bytes and sha256 of every file and catalog.json; validate re-reads everything and refuses a missing file, a drifted hash, a year without a frame or a recorded reason, a series that names a year without a frame, or two engine versions in one tree. Text artifacts are LF on every platform and hashed as stored.',
        'The same contract is mirrored in contract.ts, so the web reads only what the manifests declare; the artifact guard runs in CI and before every deploy; the models carry their own registry (training data, split, seed, held-out scores, parity, sha256). Bring your own site: add it to sites.json, run the bake, and every page of the app follows.',
      ],
      es: [
        'Contrato 1, ingesta: data/examples/sites.json declara cada sitio (id, nombres, pais ISO3, categorias, semilla, ventana en km, primer ano, meses de temporada, hechos con URL de fuente); la etapa catalog rechaza una semilla a mas de 3 km de un poligono de referencia, una ventana fuera de 4 a 40 km, un hecho sin fuente, y escribe site.json (la grilla UTM: un ancho multiplo de tres para que la grilla Landsat de 30 m anide en la de 10 m) y polygons.geojson.',
        'Contrato 2, artefacto: cada etapa escribe un JSON lateral (scenes, frames con huecos, masks, series, dense, dem) y la etapa export arma manifest.json por sitio con bytes y sha256 de cada archivo y catalog.json; validate relee todo y rechaza un archivo faltante, un hash desviado, un ano sin cuadro ni razon registrada, una serie que nombra un ano sin cuadro, o dos versiones del motor en un arbol. Los artefactos de texto son LF en toda plataforma y se hashean tal como se guardan.',
        'El mismo contrato se refleja en contract.ts, asi la web lee solo lo que los manifiestos declaran; la guarda de artefactos corre en CI y antes de cada despliegue; los modelos llevan su propio registro (datos de entrenamiento, particion, semilla, puntajes retenidos, paridad, sha256). Traiga su propio sitio: agreguelo a sites.json, corra la cocina, y cada pagina de la app lo sigue.',
      ],
    },
  },
];
