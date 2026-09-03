// Every source Rajo reads, as probed and licensed (transcribed from docs/data/01_sources.md, probed live
// on 2026-09-02 with a browser-like Origin header). "browser: yes" means the response carried CORS for
// a static page; "no" means the offline bake reads it. Both languages live here.
import type { Lang } from './methods';

export type SourceGroup = 'imagery' | 'elevation' | 'footprints' | 'basemaps';

export interface SourceRow {
  id: string;
  group: SourceGroup;
  name: string;
  url?: string;
  doi?: string;
  role: Record<Lang, string>;
  access: Record<Lang, string>;
  browser: 'yes' | 'no' | 'partial';
  licence: Record<Lang, string>;
}

export const SOURCES: SourceRow[] = [
  {
    id: 'sentinel2',
    group: 'imagery',
    name: 'Sentinel-2 L2A cloud-optimized GeoTIFFs, 2017 to today, 10 m',
    url: 'https://registry.opendata.aws/sentinel-2-l2a-cogs/',
    role: { en: 'The yearly frames from 2017, the live scene reads in the browser, the dense series, the training tiles', es: 'Los cuadros anuales desde 2017, las lecturas en vivo en el navegador, la serie densa, las teselas de entrenamiento' },
    access: { en: 'Earth Search v1 STAC (collection sentinel-2-l2a) and the sentinel-cogs bucket on AWS Open Data, free, not requester-pays', es: 'STAC Earth Search v1 (coleccion sentinel-2-l2a) y el bucket sentinel-cogs en AWS Open Data, gratuito, sin cobro al solicitante' },
    browser: 'yes',
    licence: { en: 'Copernicus Sentinel data legal notice: free, full and open; "Contains modified Copernicus Sentinel data [year]"', es: 'Aviso legal de datos Copernicus Sentinel: libres, completos y abiertos; "Contains modified Copernicus Sentinel data [year]"' },
  },
  {
    id: 'landsat',
    group: 'imagery',
    name: 'Landsat Collection 2 Level-2, 1982 to today, 30 m',
    url: 'https://planetarycomputer.microsoft.com/dataset/landsat-c2-l2',
    role: { en: 'The yearly frames 1985 to 2016 (Landsat 5, 7, 8 and 9)', es: 'Los cuadros anuales de 1985 a 2016 (Landsat 5, 7, 8 y 9)' },
    access: { en: 'Microsoft Planetary Computer STAC (collection landsat-c2-l2), assets on Azure blob with an anonymous SAS token of about 24 h', es: 'STAC del Planetary Computer de Microsoft (coleccion landsat-c2-l2), activos en Azure blob con un token SAS anonimo de unas 24 h' },
    browser: 'no',
    licence: { en: 'USGS Landsat data are public domain; attribution to the U.S. Geological Survey', es: 'Los datos Landsat del USGS son de dominio publico; atribucion al U.S. Geological Survey' },
  },
  {
    id: 'terrain',
    group: 'elevation',
    name: 'Terrain Tiles (Mapzen / Tilezen), global terrarium PNG',
    url: 'https://registry.opendata.aws/terrain-tiles/',
    role: { en: 'The 3D relief and hillshade of the globe, the global epoch of the profile tool', es: 'El relieve 3D y el sombreado del globo, la epoca global de la herramienta de perfil' },
    access: { en: 's3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', es: 's3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png' },
    browser: 'yes',
    licence: { en: 'Attribution "Mapzen" plus the regional credits (SRTM, GMTED2010, ETOPO1, 3DEP, Geoscience Australia CC BY 4.0, EU-DEM, CDEM, LINZ). In South America the surface is the year-2000 SRTM', es: 'Atribucion "Mapzen" mas los creditos regionales (SRTM, GMTED2010, ETOPO1, 3DEP, Geoscience Australia CC BY 4.0, EU-DEM, CDEM, LINZ). En Sudamerica la superficie es el SRTM del ano 2000' },
  },
  {
    id: 'copdem',
    group: 'elevation',
    name: 'Copernicus DEM GLO-30, TanDEM-X 2011 to 2015, 30 m',
    url: 'https://registry.opendata.aws/copernicus-dem/',
    role: { en: 'The later epoch of the elevation difference and the per-site terrain tiles', es: 'La epoca posterior de la diferencia de elevacion y las teselas de terreno por sitio' },
    access: { en: 'copernicus-dem-30m bucket, one COG per 1 x 1 degree tile', es: 'bucket copernicus-dem-30m, un COG por tesela de 1 x 1 grado' },
    browser: 'no',
    licence: { en: 'Copernicus DEM licence: free with attribution to DLR and Airbus under COPERNICUS by the European Union and ESA; absolute vertical accuracy under 4 m at 90%', es: 'Licencia del DEM Copernicus: libre con atribucion a DLR y Airbus bajo COPERNICUS por la Union Europea y ESA; exactitud vertical absoluta bajo 4 m al 90%' },
  },
  {
    id: 'srtm',
    group: 'elevation',
    name: 'SRTM GL1, February 2000, 30 m, void-filled',
    url: 'https://opentopography.org/',
    doi: '10.1029/2005RG000183',
    role: { en: 'The earlier epoch of the elevation difference', es: 'La epoca anterior de la diferencia de elevacion' },
    access: { en: 'OpenTopography S3, 1 x 1 degree GeoTIFF tiles', es: 'S3 de OpenTopography, teselas GeoTIFF de 1 x 1 grado' },
    browser: 'yes',
    licence: { en: 'Farr et al. 2007; OpenTopography acknowledgement required', es: 'Farr et al. 2007; se requiere reconocimiento a OpenTopography' },
  },
  {
    id: 'maus',
    group: 'footprints',
    name: 'Maus et al. 2022, Global-scale mining polygons v2',
    doi: '10.1594/PANGAEA.942325',
    role: { en: 'The reference polygons of every site: catalog validation, the envelope of the series, the SAM endmember', es: 'Los poligonos de referencia de cada sitio: validacion del catalogo, la envolvente de las series, el endmember SAM' },
    access: { en: '44,929 polygons, 101,583 km2, digitised on the 2019 Sentinel-2 cloudless mosaic; overall accuracy 88.3%, F1 0.87', es: '44.929 poligonos, 101.583 km2, digitalizados sobre el mosaico Sentinel-2 sin nubes de 2019; exactitud global 88,3%, F1 0,87' },
    browser: 'partial',
    licence: { en: 'CC BY-SA 4.0 (share-alike: the per-site polygon layers Rajo publishes stay CC BY-SA 4.0)', es: 'CC BY-SA 4.0 (share-alike: las capas de poligonos por sitio que Rajo publica siguen CC BY-SA 4.0)' },
  },
  {
    id: 'tang',
    group: 'footprints',
    name: 'Tang and Werner 2023, Global mining footprint mapped from high-resolution satellite imagery',
    doi: '10.1038/s43247-023-00805-6',
    role: { en: 'The second label source inside the training set', es: 'La segunda fuente de etiquetas dentro del conjunto de entrenamiento' },
    access: { en: 'Zenodo, doi:10.5281/zenodo.6806817', es: 'Zenodo, doi:10.5281/zenodo.6806817' },
    browser: 'no',
    licence: { en: 'CC BY 4.0', es: 'CC BY 4.0' },
  },
  {
    id: 'jasansky',
    group: 'footprints',
    name: 'Jasansky, Maus, Popa and Wilbik 2024, Global ML-ready dataset for mining areas in satellite images',
    doi: '10.5281/zenodo.14195737',
    role: { en: 'The training, validation and test tiles of the learned models (1,514 tiles over 1,210 sites; mine type and scale; a site-level split)', es: 'Las teselas de entrenamiento, validacion y prueba de los modelos aprendidos (1.514 teselas sobre 1.210 sitios; tipo y escala; particion por sitio)' },
    access: { en: 'A 35.6 MB GeoPackage with geometry, product ids and the split; the pixels are fetched from Earth Search by product id', es: 'Un GeoPackage de 35,6 MB con geometria, ids de producto y la particion; los pixeles se traen de Earth Search por id de producto' },
    browser: 'no',
    licence: { en: 'CC BY-SA 4.0', es: 'CC BY-SA 4.0' },
  },
  {
    id: 'eox',
    group: 'basemaps',
    name: 'EOX Sentinel-2 cloudless, yearly global mosaics',
    url: 'https://s2maps.eu',
    role: { en: 'The imagery basemap of the globe (the 2024 mosaic)', es: 'El mapa base de imagenes del globo (el mosaico 2024)' },
    access: { en: 'WMTS tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857', es: 'WMTS tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857' },
    browser: 'yes',
    licence: { en: 'CC BY-NC-SA 4.0 for non-commercial use, attribution verbatim: "Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024)"', es: 'CC BY-NC-SA 4.0 para uso no comercial, atribucion textual: "Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024)"' },
  },
  {
    id: 'ofm',
    group: 'basemaps',
    name: 'OpenFreeMap (OpenMapTiles over OpenStreetMap)',
    url: 'https://openfreemap.org',
    role: { en: 'The place labels and boundaries', es: 'Las etiquetas de lugares y los limites' },
    access: { en: 'tiles.openfreemap.org, no key, no request limits', es: 'tiles.openfreemap.org, sin clave, sin limites de peticiones' },
    browser: 'yes',
    licence: { en: 'Attribution "OpenFreeMap (c) OpenMapTiles Data from OpenStreetMap"', es: 'Atribucion "OpenFreeMap (c) OpenMapTiles Data from OpenStreetMap"' },
  },
];
