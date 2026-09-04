import { Code, Info, Languages, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';

import { ArchitectureModal } from './components/ArchitectureModal';
import { APP_VERSION } from './lib/version';
import { ROUTES } from './router';
import { useUI } from './state/ui';

const GITHUB = 'https://github.com/fsantibanezleal/CAOS_Rajo';

function Mark() {
  return (
    <svg className="mark" viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="32" cy="34" rx="24" ry="14" fill="none" stroke="var(--accent)" strokeWidth="3" />
      <ellipse cx="32" cy="36" rx="17" ry="9.5" fill="none" stroke="var(--accent)" strokeWidth="2.4" opacity="0.8" />
      <ellipse cx="32" cy="38" rx="10" ry="5.5" fill="none" stroke="var(--accent)" strokeWidth="2" opacity="0.6" />
      <circle cx="50" cy="13" r="3" fill="var(--cyan)" />
    </svg>
  );
}

export function App() {
  const { t } = useTranslation();
  const theme = useUI((s) => s.theme);
  const lang = useUI((s) => s.lang);
  const toggleTheme = useUI((s) => s.toggleTheme);
  const setLang = useUI((s) => s.setLang);
  const [archOpen, setArchOpen] = useState(false);

  return (
    <div className="app">
      {archOpen && <ArchitectureModal onClose={() => setArchOpen(false)} />}
      <header className="hdr">
        <NavLink to="/" className="brand">
          <Mark />
          <span>{t('brand')}</span>
          <span className="tag">{t('tagline')}</span>
        </NavLink>
        <nav aria-label="Primary">
          {ROUTES.map((r) => (
            <NavLink key={r.path} to={r.path} end={r.path === '/'} className={({ isActive }) => (isActive ? 'on' : '')}>
              {t(`nav.${r.key}`)}
            </NavLink>
          ))}
        </nav>
        <div className="spacer" />
        <div className="actions">
          <a className="iconbtn" href={GITHUB} target="_blank" rel="noreferrer" title={t('header.github')} aria-label={t('header.github')}>
            <Code size={17} />
          </a>
          <span className="sep" />
          <button className="iconbtn" type="button" title={t('header.architecture')} aria-label={t('header.architecture')} data-testid="arch-btn" onClick={() => setArchOpen(true)} aria-haspopup="dialog" aria-expanded={archOpen}>
            <Info size={17} />
          </button>
          <button
            className="iconbtn"
            type="button"
            title={t('header.lang')}
            aria-label={t('header.lang')}
            data-testid="lang-btn"
            onClick={() => setLang(lang === 'en' ? 'es' : 'en')}
          >
            <Languages size={17} />
            <span className="lbl">{lang.toUpperCase()}</span>
          </button>
          <button className="iconbtn" type="button" title={t('header.theme')} aria-label={t('header.theme')} data-testid="theme-btn" onClick={toggleTheme}>
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
      </header>

      <main className="main">
        <Outlet />
      </main>

      <footer className="ftr">
        <span>
          <strong>{t('brand')}</strong> <span className="dot">&middot;</span> {t('footer.project')}
        </span>
        <span className="dot">&middot;</span>
        <span>
          {t('footer.version')} <span className="mono">{APP_VERSION}</span>
        </span>
        <span className="dot">&middot;</span>
        <span>{t('footer.developed')}</span>
        <span className="dot">&middot;</span>
        <span>{t('footer.license')}</span>
        <span className="dot">&middot;</span>
        <span className="honest">{t('footer.honest')}</span>
      </footer>
    </div>
  );
}
