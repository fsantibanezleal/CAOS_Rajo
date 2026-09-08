// The Spanish surface must read as Spanish: written accents, the enye, and the opening question
// mark. The app shipped its whole es locale in ASCII once ("ano" for "ano" is the worst of it) and
// the deficiency reached published screenshots, so it is a gate now rather than a review habit.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import es from './es.json';

// The unaccented form on the left is never a word this product means to write. Words whose accent
// depends on the sentence (esta/esta, aun/aun, mas/mas, como/como, si/si, publica/publica,
// termino/termino, marco/marco, bajo/bajo, cual/cual, donde/donde, cuanta/cuanta) are NOT listed
// here: they are checked in context by the second test below.
const MISSPELLED = [
  'absorcion', 'alla', 'alli', 'analisis', 'angulo', 'ano', 'anos', 'anonimo', 'aqui', 'arbol',
  'arboles', 'area', 'areas', 'armonica', 'armonicos', 'articulos', 'asi', 'atomico', 'atribucion',
  'bilingue', 'bilingues', 'boton', 'busqueda', 'caian', 'cajon', 'calculo', 'calculos', 'catalogo',
  'categoria', 'categorias', 'clasica', 'clasicas', 'clasico', 'clasicos', 'clasificacion',
  'codificacion', 'codigo', 'coleccion', 'combinacion', 'compilacion', 'computo', 'creditos',
  'decada', 'decadas', 'decodificacion', 'delineacion', 'dias', 'dieciseis', 'dinamicos',
  'direccion', 'documentacion', 'elevacion', 'eliminacion', 'entropia', 'epoca', 'epocas',
  'estadistica', 'estadisticas', 'estan', 'estandares', 'estatica', 'estatico', 'estimacion',
  'evaporacion', 'exageracion', 'explotacion', 'ferricos', 'fraccion', 'geologica', 'geologia',
  'geometria', 'guias', 'iluminacion', 'imagenes', 'indice', 'indices', 'informacion', 'invalidos',
  'investigacion', 'items', 'kilometro', 'kilometros', 'leido', 'leidos', 'limite', 'limites',
  'linea', 'lineas', 'lixiviacion', 'mascara', 'mascaras', 'maximo', 'mediria', 'metodo', 'metodos',
  'metricas', 'mineria', 'minimo', 'movio', 'multiplo', 'ningun', 'notacion', 'nucleo', 'numero',
  'numeros', 'operacion', 'optima', 'orbita', 'oxidos', 'pagina', 'paginas', 'pais', 'paises',
  'parametros', 'particion', 'penalizacion', 'pequenas', 'pequenos', 'pestana', 'pixel', 'pixeles',
  'plomeria', 'poligono', 'poligonos', 'precision', 'produccion', 'proposito', 'razon', 'redaccion',
  'regresion', 'reporto', 'respondio', 'satelites', 'segmentacion', 'segun', 'semantica', 'senal',
  'senales', 'subio', 'sudamerica', 'tambien', 'teledeteccion', 'titulo', 'traia', 'ultimos',
  'vacios', 'validacion', 'valido', 'validos', 'vegetacion', 'verificacion', 'volumenes',
  // words that only the architecture diagrams use
  'canonico', 'comun', 'construccion', 'definicion', 'ecuacion', 'estaticas', 'estaticos',
  'identico', 'matematica', 'reproduccion', 'resolucion', 'retencion', 'superposicion', 'ultima',
];

// Phrases that were wrong in context and must stay fixed. Left side is the defect.
const IN_CONTEXT = [
  'Donde corre', 'Donde vive', 'Como citar', 'Como funciona', 'Como se diseno',
  'y por que:', 'Que estoy mirando?', 'Donde esta la mina?', 'Como cambio?',
  'heredado esta en', 'ventana esta limpia', 'tal como esta cocinado', 'diagrama esta dibujado',
  'completa esta en la wiki', 'no esta en esta compilacion', 'aun no incluye', 'aun no ha llegado',
  'aun sin cocinar', 'aun no tiene', 'igual marco ', 'el terreno bajo,', 'el termino share-alike',
  'muestra publica', 'observatorio publico', 'dominio publico', 'Dominio publico',
  'Divulgaciones publicas', 'web publicas', 'Navegador: si"', 'ver como responde',
  'decide cuales son', 'donde y cuanta roca',
  // the same words inside the architecture diagrams
  'Que es', 'Carriles: que corre', 'entre si con fixtures', 'honestidad, como citar',
  'declara lo que dibujo', 'y donde están las compuertas', 'es como ocurre una cocina',
];

// Spanish strings live in the locale, in the bilingual content modules, and in the l-es text nodes
// of the hand-authored architecture diagrams.
const CONTENT_DIR = join(__dirname, '..', 'content');
const SVG_DIR = join(__dirname, '..', '..', 'public', 'svg', 'tech');

function spanishStrings(): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(es);
  for (const f of readdirSync(CONTENT_DIR).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
    const src = readFileSync(join(CONTENT_DIR, f), 'utf8');
    // every string literal inside an `es:` value, single literal or array of them
    const re = /\bes:\s*(\[[\s\S]*?\]|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`)/g;
    for (const m of src.matchAll(re)) {
      for (const s of (m[1] ?? '').matchAll(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`/g)) {
        out.push(String(s[0]).slice(1, -1));
      }
    }
  }
  for (const f of readdirSync(SVG_DIR).filter((n) => n.endsWith('.svg'))) {
    const src = readFileSync(join(SVG_DIR, f), 'utf8');
    for (const m of src.matchAll(/<(text|tspan)\b[^>]*class="[^"]*\bl-es\b[^"]*"[^>]*>([^<]*)</g)) {
      out.push(m[2] ?? '');
    }
  }
  return out;
}

// identifiers, paths, placeholders and URLs are not Spanish prose
const CODE = /https?:\/\/\S+|\{\{[^}]*\}\}|[A-Za-z][A-Za-z0-9]*(?:[_./\\-][A-Za-z0-9]+)+|`[^`]*`/g;

describe('the Spanish surface is written in Spanish', () => {
  const strings = spanishStrings();

  it('reads more than the locale file alone', () => {
    expect(strings.length).toBeGreaterThan(400);
  });

  it('never ships a word that is missing its written accent', () => {
    const bad: string[] = [];
    const set = new Set(MISSPELLED);
    for (const s of strings) {
      const prose = s.replace(CODE, ' ');
      for (const w of prose.matchAll(/[A-Za-zÀ-ɏ]+/g)) {
        if (set.has(w[0].toLowerCase())) bad.push(`${w[0]} in "${s.slice(0, 70)}"`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('keeps the phrases whose accent depends on the sentence', () => {
    const bad = IN_CONTEXT.filter((p) => strings.some((s) => s.includes(p)));
    expect(bad).toEqual([]);
  });

  it('opens every question with an inverted question mark', () => {
    // a query string (?site=) is not a question
    const bad = strings
      .map((s) => s.replace(CODE, ' ').replace(/\?[A-Za-z_]+=?/g, ' '))
      .filter((s) => s.includes('?') && !s.includes('¿'));
    expect(bad).toEqual([]);
  });

  it('carries the accents and the enye it is supposed to carry', () => {
    const joined = strings.join(' ');
    for (const ch of ['á', 'é', 'í', 'ó', 'ú', 'ñ', '¿', 'ü']) {
      expect(joined.includes(ch), `expected ${ch} somewhere in the Spanish surface`).toBe(true);
    }
  });
});
