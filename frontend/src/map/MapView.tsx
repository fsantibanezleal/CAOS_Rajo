// The map: MapLibre GL JS with the Rajo style (imagery + hillshade + labels), a globe at low zoom, 3D
// terrain from the terrarium DEM, and a cursor readout (lon, lat, elevation). The map instance is exposed
// through a callback so the observatory can drive it (fly to a site, add deck.gl overlays).
import { Map as MLMap } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { buildStyle, TERRAIN_SOURCE } from '../lib/basemap';
import { useUI } from '../state/ui';

export interface MapViewProps {
  onMap?: (map: MLMap | null) => void;
  onCursor?: (info: { lon: number; lat: number; elev: number | null } | null) => void;
  onStatus?: (loading: boolean) => void;
  terrain: boolean;
  labels: boolean;
}

export const TERRAIN_EXAGGERATION = 1.15;

export function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function MapView({ onMap, onCursor, onStatus, terrain, labels }: MapViewProps) {
  const { t } = useTranslation();
  const theme = useUI((s) => s.theme);
  const el = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [webgl] = useState(hasWebGL);
  const propsRef = useRef({ onMap, onCursor, onStatus, terrain, labels });
  propsRef.current = { onMap, onCursor, onStatus, terrain, labels };

  // create once
  useEffect(() => {
    if (!webgl || !el.current) return;
    let cancelled = false;
    let created: MLMap | null = null;
    void buildStyle(useUI.getState().theme).then(({ style }) => {
      if (cancelled || !el.current) return;
      const m = new MLMap({
        container: el.current,
        style,
        center: [-69.5, -23.0],
        zoom: 2.2,
        pitch: 0,
        bearing: 0,
        maxPitch: 80,
        minZoom: 1.2,
        attributionControl: false,
        hash: false,
        cooperativeGestures: false,
        canvasContextAttributes: { antialias: true, preserveDrawingBuffer: true },
      });
      created = m;
      mapRef.current = m;
      m.on('style.load', () => {
        m.setProjection({ type: 'globe' });
        if (propsRef.current.terrain) m.setTerrain({ source: 'terrain', exaggeration: TERRAIN_EXAGGERATION });
        setLabelVisibility(m, propsRef.current.labels);
      });
      m.on('load', () => propsRef.current.onMap?.(m));
      m.on('dataloading', () => propsRef.current.onStatus?.(true));
      m.on('idle', () => propsRef.current.onStatus?.(false));
      m.on('mousemove', (e) => {
        const elev = m.queryTerrainElevation(e.lngLat);
        propsRef.current.onCursor?.({
          lon: e.lngLat.lng,
          lat: e.lngLat.lat,
          elev: elev === null || elev === undefined ? null : Math.round(elev),
        });
      });
      m.on('mouseout', () => propsRef.current.onCursor?.(null));
    });
    return () => {
      cancelled = true;
      propsRef.current.onMap?.(null);
      created?.remove();
      mapRef.current = null;
    };
  }, [webgl]);

  // theme: rebuild the style (labels swap between dark and positron), keep the camera
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    let cancelled = false;
    void buildStyle(theme).then(({ style }) => {
      if (cancelled || mapRef.current !== m) return;
      m.setStyle(style, { diff: false });
    });
    return () => {
      cancelled = true;
    };
  }, [theme]);

  // terrain toggle
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !m.isStyleLoaded()) return;
    if (terrain) {
      if (!m.getSource('terrain')) m.addSource('terrain', TERRAIN_SOURCE);
      m.setTerrain({ source: 'terrain', exaggeration: TERRAIN_EXAGGERATION });
    } else {
      m.setTerrain(null);
    }
  }, [terrain]);

  // labels toggle
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !m.isStyleLoaded()) return;
    setLabelVisibility(m, labels);
  }, [labels]);

  if (!webgl) {
    return (
      <div className="nowebgl">
        <div className="panel">{t('map.webglMissing')}</div>
      </div>
    );
  }
  return <div ref={el} className="map" data-testid="map" />;
}

export function setLabelVisibility(map: MLMap, visible: boolean): void {
  const style = map.getStyle();
  if (!style) return;
  for (const l of style.layers) {
    if (l.type === 'symbol' || (l.type === 'line' && l.id !== 'imagery')) {
      map.setLayoutProperty(l.id, 'visibility', visible ? 'visible' : 'none');
    }
  }
}
