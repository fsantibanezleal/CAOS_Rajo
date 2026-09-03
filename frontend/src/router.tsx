import { createBrowserRouter } from 'react-router-dom';

import { App } from './App';
import { AboutPage } from './pages/AboutPage';
import { AtlasPage } from './pages/AtlasPage';
import { DataPage } from './pages/DataPage';
import { MethodsPage } from './pages/MethodsPage';
import { Observatory } from './pages/Observatory';

export const ROUTES = [
  { path: '/', key: 'observatory' },
  { path: '/atlas', key: 'atlas' },
  { path: '/methods', key: 'methods' },
  { path: '/data', key: 'data' },
  { path: '/about', key: 'about' },
] as const;

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Observatory /> },
      { path: 'atlas', element: <AtlasPage /> },
      { path: 'methods', element: <MethodsPage /> },
      { path: 'data', element: <DataPage /> },
      { path: 'about', element: <AboutPage /> },
      { path: '*', element: <Observatory /> },
    ],
  },
]);
