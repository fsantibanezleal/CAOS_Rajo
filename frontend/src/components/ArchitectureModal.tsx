// The Architecture / "How it works" modal (ADR-0058): a centred dialog (Esc to close, focus managed,
// role="dialog") with a tab strip; each tab pairs ONE hand-authored, theme-aware SVG with a bilingual
// explanation at complete depth. The SVG is fetched and INLINED so it inherits the app's CSS variables
// (an <img> would not follow the theme), and the diagram carries both languages in one file: text nodes
// tagged l-en and l-es, the panel's data-arch-lang attribute shows exactly one.
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ARCH_TABS } from '../content/architecture';
import { useUI } from '../state/ui';

function svgUrl(file: string): string {
  return `${import.meta.env.BASE_URL}svg/tech/${file}`;
}

export function ArchitectureModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const [active, setActive] = useState(0);
  // the inlined markup is keyed by its file, so a tab switch never shows the previous diagram for a
  // frame (the gates count the text nodes of the tab they clicked, and the render declares its state)
  const [loaded, setLoaded] = useState<{ file: string; svg: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const tab = ARCH_TABS[active] ?? ARCH_TABS[0]!;
  const svg = loaded && loaded.file === tab.svg ? loaded.svg : '';
  const state = svg ? 'ready' : failed === tab.svg ? 'missing' : 'loading';

  useEffect(() => {
    let cancelled = false;
    const file = tab.svg;
    fetch(svgUrl(file), { cache: 'no-cache' })
      .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('svg') ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((txt) => !cancelled && setLoaded({ file, svg: txt }))
      .catch(() => !cancelled && setFailed(file));
    return () => {
      cancelled = true;
    };
  }, [tab.svg]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="arch-overlay" onClick={onClose} role="presentation" data-testid="arch-overlay">
      <div className="arch-modal" role="dialog" aria-modal="true" aria-label={t('arch.title')} tabIndex={-1} ref={dialogRef} onClick={(e) => e.stopPropagation()} data-arch-lang={lang} data-testid="arch-modal">
        <header className="arch-head">
          <div>
            <h2>{t('arch.title')}</h2>
            <p className="arch-sub">{t('arch.subtitle')}</p>
          </div>
          <button type="button" className="arch-close" onClick={onClose} aria-label={t('arch.close')} data-testid="arch-close">
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="arch-tabs" role="tablist" aria-label={t('arch.title')}>
          {ARCH_TABS.map((tb, i) => (
            <button key={tb.id} type="button" role="tab" aria-selected={i === active} className={i === active ? 'arch-tab on' : 'arch-tab'} onClick={() => setActive(i)} data-testid={`arch-tab-${tb.id}`}>
              <span className="arch-tab-n">{i + 1}</span>
              {tb.label[lang]}
            </button>
          ))}
        </div>
        <div className="arch-body">
          <div className="arch-diagram" data-testid="arch-diagram" data-tab={tab.id} data-state={state}>
            {svg ? (
              <div className="arch-svg-wrap" dangerouslySetInnerHTML={{ __html: svg }} />
            ) : state === 'missing' ? (
              <p className="bad small">{t('arch.diagramMissing')} ({tab.svg})</p>
            ) : (
              <p className="muted small">{t('common.loading')}</p>
            )}
          </div>
          <div className="arch-text">
            {tab.body[lang].map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </div>
        <footer className="arch-foot">{t('arch.footer')}</footer>
      </div>
    </div>
  );
}
