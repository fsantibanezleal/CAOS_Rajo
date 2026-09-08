// Numbers are read differently in the two languages this app speaks: Chilean Spanish writes a comma
// for the decimal mark and a point for thousands, English the reverse. Printing `272.9` inside a
// Spanish sentence is the same class of defect as printing an English word there, so every displayed
// number goes through here. Values that are not prose (an <input> value, a CSS percentage, a key)
// keep toFixed on purpose.
import i18n from '../i18n';

function locale(): string {
  return i18n.language && i18n.language.startsWith('es') ? 'es-CL' : 'en-US';
}

/** A displayed number with a fixed number of decimals, in the reader's language. */
export function num(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '-';
  return new Intl.NumberFormat(locale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
}

/** A displayed integer with the reader's thousands separator. */
export function int(v: number): string {
  if (!Number.isFinite(v)) return '-';
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(v);
}
