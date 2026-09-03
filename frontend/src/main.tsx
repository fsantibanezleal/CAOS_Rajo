import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/tokens.css';
import './styles/app.css';
import './styles/instrument.css';
import './i18n';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import { router } from './router';
import { useUI } from './state/ui';

// The pre-paint script in index.html already set data-theme; keep the store and the DOM in step.
document.documentElement.setAttribute('data-theme', useUI.getState().theme);
document.documentElement.setAttribute('lang', useUI.getState().lang);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
