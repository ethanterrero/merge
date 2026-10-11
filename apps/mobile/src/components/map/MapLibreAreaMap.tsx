// The real map on iOS and Android: MapLibre Native with Stadia Maps tiles
// (D-08). Only AreaMap.tsx loads this file, and only after checking that the
// native module exists, because importing the library in Expo Go throws.

import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Camera, GeoJSONSource, Layer, Map, ViewAnnotation, type CameraRef } from '@maplibre/maplibre-react-native';
import { colors } from '../../theme';
import { areaRadius, areaSignature, areasFeatureCollection, isValidLatLng, southEdge } from './areas';
import { areaLayers, AREA_SOURCE_ID } from './layers';
import { stadiaStyleUrl } from './provider';
import { AreaTag, MapAttribution, boundsFor, cameraPadding, resolveInsets } from './shared';
import type { AreaMapProps } from './types';

const LAYERS = areaLayers(colors);

export function MapLibreAreaMap({
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
  const resolved = resolveInsets(insets);
  const padding = cameraPadding(resolved, fitPadding);
  const bounds = boundsFor(areas, minSpanM);
  const boundsKey = bounds.join();
  const paddingKey = [padding.top, padding.right, padding.bottom, padding.left].join();
  const signature = areaSignature(areas);
  // Rebuilt only when something drawn changes, not on every parent render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => areasFeatureCollection(areas), [signature]);
  const camera = useRef<CameraRef>(null);
  const initial = useRef({ bounds, padding });

  // Refit when the set of areas or the covered edges change (a filter, a sheet).
  useEffect(() => {
    camera.current?.fitBounds(bounds, { padding, duration: 300 });
    // bounds and padding are new arrays every render; their keys say when they changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundsKey, paddingKey]);

  return (
    <View style={[styles.container, style]} accessibilityLabel={accessibilityLabel ?? 'Map of approximate areas'}>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={stadiaStyleUrl(mapKey)}
        attribution={false}
        logo={false}
        compass={false}
        scaleBar={false}
        dragPan={interactive}
        touchZoom={interactive}
        doubleTapZoom={interactive}
        doubleTapHoldZoom={interactive}
        touchRotate={false}
        touchPitch={false}
        // A bad or revoked key, a 429 or no network: the style never loads and
        // the map would stay blank with no tappable circles, so hand back to BayMap.
        // The event carries no details, so nothing (and never the key) is logged with it.
        onDidFailLoadingMap={() => {
          console.warn('Map style failed to load; showing the stylized map instead.');
          onFail();
        }}
      >
        <Camera ref={camera} initialViewState={initial.current} />
        <GeoJSONSource
          id={AREA_SOURCE_ID}
          data={data as unknown as GeoJSON.FeatureCollection}
          onPress={(e) => {
            const id = e.nativeEvent.features[0]?.properties?.id;
            areas.find((a) => a.id === id)?.onPress?.();
          }}
        >
          {LAYERS.map((layer) => (
            <Layer key={layer.id} {...layer} />
          ))}
        </GeoJSONSource>
        {areas
          .filter((a) => isValidLatLng(a.center) && a.badge)
          .map((a) => (
            <ViewAnnotation key={`badge-${a.id}`} id={`badge-${a.id}`} lngLat={[a.center.lng, a.center.lat]} onPress={a.onPress}>
              <View accessible accessibilityRole={a.onPress ? 'button' : undefined} accessibilityLabel={a.accessibilityLabel}>
                {a.badge}
              </View>
            </ViewAnnotation>
          ))}
        {areas
          .filter((a) => isValidLatLng(a.center) && a.label)
          .map((a) => {
            const edge = southEdge(a.center, areaRadius(a.radiusM));
            return (
              <ViewAnnotation key={`label-${a.id}`} id={`label-${a.id}`} lngLat={[edge.lng, edge.lat]} anchor="top" offset={[0, 3]}>
                <AreaTag label={a.label!} />
              </ViewAnnotation>
            );
          })}
      </Map>
      <MapAttribution bottom={resolved.bottom} right={resolved.right} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden', backgroundColor: colors.water },
});
