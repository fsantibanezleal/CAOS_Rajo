// Country context for the copper sites, transcribed from U.S. Geological Survey, Mineral Commodity
// Summaries 2026, Copper (February 2026), "World Mine and Refinery Production and Reserves": mine
// production in thousand metric tons of copper content, 2025 estimated; reserves in thousand metric
// tons. Only the rows of countries that host a catalog site, plus the world total. Chile's reported
// 2025 figure (Cochilco, by-company workbook, "Total Chile") sits next to the USGS estimate.
// Persisted research: CAOS_MANAGE wip/rajo/research-08 (2026-09-03).

export const USGS_MCS_2026_COPPER_URL = 'https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-copper.pdf';
export const COCHILCO_BY_COMPANY_URL = 'https://www.cochilco.cl/web/historico-produccion-de-cobre-y-molibdeno/';

export interface CountryProduction {
  iso3: string;
  name: { en: string; es: string };
  mine2024: number; // thousand metric tons of copper content
  mine2025e: number; // estimated
  reserves: number | null; // thousand metric tons; null where the table prints a dash
  reported2025?: { value: number; source: 'cochilco' }; // the national statistics office's reported figure
}

export const COPPER_BY_COUNTRY: CountryProduction[] = [
  { iso3: 'CHL', name: { en: 'Chile', es: 'Chile' }, mine2024: 5510, mine2025e: 5300, reserves: 180000, reported2025: { value: 5415.271, source: 'cochilco' } },
  { iso3: 'COD', name: { en: 'Congo (Kinshasa)', es: 'Congo (Kinshasa)' }, mine2024: 2990, mine2025e: 3200, reserves: 80000 },
  { iso3: 'PER', name: { en: 'Peru', es: 'Peru' }, mine2024: 2740, mine2025e: 2700, reserves: 85000 },
  { iso3: 'USA', name: { en: 'United States', es: 'Estados Unidos' }, mine2024: 1050, mine2025e: 1000, reserves: 47000 },
  { iso3: 'IDN', name: { en: 'Indonesia', es: 'Indonesia' }, mine2024: 1010, mine2025e: 710, reserves: 21000 },
  { iso3: 'AUS', name: { en: 'Australia', es: 'Australia' }, mine2024: 765, mine2025e: 730, reserves: 100000 },
  { iso3: 'POL', name: { en: 'Poland', es: 'Polonia' }, mine2024: 400, mine2025e: 410, reserves: 33000 },
  { iso3: 'RUS', name: { en: 'Russia', es: 'Rusia' }, mine2024: 1020, mine2025e: 1300, reserves: 80000 },
  { iso3: 'CAN', name: { en: 'Canada', es: 'Canada' }, mine2024: 515, mine2025e: 500, reserves: 7000 },
];

export const COPPER_WORLD = { mine2024: 23000, mine2025e: 23000, reserves: 980000 };

/** Countries the USGS table folds into "Other countries" (2,850 in 2024, 3,000 in 2025e). */
export const COPPER_OTHER_COUNTRIES = ['MNG', 'BRA', 'PAN', 'UZB'];
