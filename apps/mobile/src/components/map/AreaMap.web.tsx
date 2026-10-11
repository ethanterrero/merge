// AreaMap on the web build: maplibre-gl with Stadia Maps tiles (D-08) when
// EXPO_PUBLIC_STADIA_KEY is set, and the stylized BayMap otherwise. maplibre-gl
// is loaded on demand, so prototype mode never downloads it. If the style
// can't load (bad key, no WebGL), it falls back to BayMap too.

import 'maplibre-gl/dist/maplibre-gl.css';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pressable, StyleSheet, View } from 'react-native';
import type * as MaplibreGl from 'maplibre-gl';
import { colors } from '../../theme';
import { BayMap } from '../BayMap';
import { areaRadius, areaSignature, areasFeatureCollection, isValidLatLng, southEdge } from './areas';
import { AREA_FILL_LAYER_ID, AREA_SOURCE_ID, areaLayers } from './layers';
import { MapErrorBoundary } from './MapErrorBoundary';
import { chooseRenderer, stadiaStyleUrl, withStadiaKey } from './provider';
import { AreaTag, MapAttribution, MAP_KEY, boundsFor, cameraPadding, resolveInsets } from './shared';
import type { AreaMapProps } from './types';

type Lib = typeof MaplibreGl;
type Host = { key: string; areaId: string; kind: 'badge' | 'label'; el: HTMLElement };

const LAYERS = areaLayers(colors);

export function AreaMap(props: AreaMapProps) {
  const [failed, setFailed] = useState(false);
  const choice = chooseRenderer({ key: MAP_KEY, platform: 'web', nativeMapAvailable: false });
  if (choice.kind !== 'web' || !MAP_KEY || failed) return <BayMap {...props} />;
  return (
    <MapErrorBoundary fallback={<BayMap {...props} />}>
      <WebAreaMap {...props} mapKey={MAP_KEY} onFail={() => setFailed(true)} />
    </MapErrorBoundary>
  );
}

function WebAreaMap({
  areas,
  style,
  insets,
  fitPadding,
  minSpanM,
  interactive = true,
  accessibilityLabel,
  mapKey,
  onFail,
}: AreaMapProps & { mapKey: string; onFail: () => void }) {
  const container = useRef<View>(null);
  const mapRef = useRef<MaplibreGl.Map | null>(null);
  const libRef = useRef<Lib | null>(null);
  const [ready, setReady] = useState(false);
  const [hosts, setHosts] = useState<Host[]>([]);

  const resolved = resolveInsets(insets);
  const padding = cameraPadding(resolved, fitPadding);
  const bounds = boundsFor(areas, minSpanM);
  const boundsKey = bounds.join();
  const paddingKey = [padding.top, padding.right, padding.bottom, padding.left].join();
  const signature = areaSignature(areas);
  const markerKey = `${signature}#${areas.map((a) => (a.badge ? 1 : 0)).join('')}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => areasFeatureCollection(areas), [signature]);

  // The map's event handlers read the latest props through this ref.
  const latest = useRef({ areas, bounds, padding, data, onFail });
  latest.current = { areas, bounds, padding, data, onFail };

  // Create the map once per key.
  useEffect(() => {
    const el = container.current as unknown as HTMLElement | null;
    if (!el) return;
    let cancelled = false;
    let styleLoaded = false;
    let map: MaplibreGl.Map | null = null;
    let observer: ResizeObserver | null = null;

    import('maplibre-gl')
      .then((mod) => {
        if (cancelled) return;
        const ml = ((mod as unknown as { default?: Lib }).default ?? mod) as Lib;
        libRef.current = ml;
        const created = new ml.Map({
          container: el,
          style: stadiaStyleUrl(mapKey),
          bounds: latest.current.bounds,
          fitBoundsOptions: { padding: latest.current.padding },
          attributionControl: false,
          interactive,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          transformRequest: (url) => ({ url: withStadiaKey(url, mapKey) }),
        });
        map = created;
        mapRef.current = created;
        created.touchZoomRotate.disableRotation();
        created.on('style.load', () => {
          styleLoaded = true;
        });
        created.on('error', (e) => {
          // A missing tile later on is fine; a style that never loads is not.
          if (!styleLoaded) {
            console.warn('Map style failed to load; showing the stylized map instead.', e.error);
            latest.current.onFail();
          }
        });
        created.on('load', () => {
          created.addSource(AREA_SOURCE_ID, { type: 'geojson', data: latest.current.data as unknown as GeoJSON.FeatureCollection });
          for (const layer of LAYERS) created.addLayer({ ...layer, source: AREA_SOURCE_ID } as MaplibreGl.LayerSpecification);
          created.on('click', AREA_FILL_LAYER_ID, (e) => {
            const id = e.features?.[0]?.properties?.id;
            latest.current.areas.find((a) => a.id === id)?.onPress?.();
          });
          created.on('mouseenter', AREA_FILL_LAYER_ID, () => {
            created.getCanvas().style.cursor = latest.current.areas.some((a) => a.onPress) ? 'pointer' : '';
          });
          created.on('mouseleave', AREA_FILL_LAYER_ID, () => {
            created.getCanvas().style.cursor = '';
          });
          setReady(true);
        });
        observer = new ResizeObserver(() => created.resize());
        observer.observe(el);
      })
      .catch((err: unknown) => {
        console.warn('maplibre-gl failed to load; showing the stylized map instead.', err);
        if (!cancelled) latest.current.onFail();
      });

    return () => {
      cancelled = true;
      observer?.disconnect();
      map?.remove();
      mapRef.current = null;
    };
  }, [mapKey, interactive]);

  // Keep the circles current.
  useEffect(() => {
    const source = ready ? mapRef.current?.getSource(AREA_SOURCE_ID) : undefined;
    (source as MaplibreGl.GeoJSONSource | undefined)?.setData(data as unknown as GeoJSON.FeatureCollection);
  }, [ready, data]);

  // Refit when the areas or the covered edges change.
  useEffect(() => {
    if (ready) mapRef.current?.fitBounds(latest.current.bounds, { padding: latest.current.padding, duration: 300 });
  }, [ready, boundsKey, paddingKey]);

  // Badges and labels are DOM markers; React fills them through portals below.
  useEffect(() => {
    const map = mapRef.current;
    const ml = libRef.current;
    if (!ready || !map || !ml) return;
    const markers: MaplibreGl.Marker[] = [];
    const next: Host[] = [];
    for (const a of latest.current.areas) {
      if (!isValidLatLng(a.center)) continue;
      if (a.badge) {
        const el = document.createElement('div');
        markers.push(new ml.Marker({ element: el, anchor: 'center' }).setLngLat([a.center.lng, a.center.lat]).addTo(map));
        next.push({ key: `badge-${a.id}`, areaId: a.id, kind: 'badge', el });
      }
      if (a.label) {
        const el = document.createElement('div');
        const edge = southEdge(a.center, areaRadius(a.radiusM));
        markers.push(new ml.Marker({ element: el, anchor: 'top', offset: [0, 3] }).setLngLat([edge.lng, edge.lat]).addTo(map));
        next.push({ key: `label-${a.id}`, areaId: a.id, kind: 'label', el });
      }
    }
    setHosts(next);
    return () => markers.forEach((m) => m.remove());
  }, [ready, markerKey]);

  return (
    <View style={[styles.container, style]} accessibilityLabel={accessibilityLabel ?? 'Map of approximate areas'}>
      <View ref={container} style={styles.canvas} />
      <MapAttribution bottom={resolved.bottom} right={resolved.right} />
      {hosts.map((h) => {
        const a = areas.find((x) => x.id === h.areaId);
        if (!a) return null;
        if (h.kind === 'label') return a.label ? createPortal(<AreaTag label={a.label} />, h.el, h.key) : null;
        return createPortal(
          <Pressable
            disabled={!a.onPress}
            onPress={a.onPress}
            accessibilityRole={a.onPress ? 'button' : undefined}
            accessibilityLabel={a.accessibilityLabel}
          >
            {a.badge}
          </Pressable>,
          h.el,
          h.key,
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden', backgroundColor: colors.water },
  canvas: { flex: 1 },
});
