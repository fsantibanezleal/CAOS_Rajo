// KaTeX rendering for the in-app method pages: every equation shown in the app is the one written in the
// docs wiki, typeset here. Rendering errors are shown as the raw TeX rather than swallowed.
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useMemo } from 'react';

export function Tex({ tex, display = false }: { tex: string; display?: boolean }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: 'ignore', output: 'html' });
    } catch {
      return null;
    }
  }, [tex, display]);
  if (html === null) return <code className="tex-error">{tex}</code>;
  return <span className={display ? 'tex tex-display' : 'tex'} dangerouslySetInnerHTML={{ __html: html }} />;
}
