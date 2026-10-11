// AreaMap on iOS and Android. The web build uses AreaMap.web.tsx instead.
//
// Draws generalized areas (circles) on a real MapLibre map with Stadia tiles
// when it can, and on the stylized BayMap otherwise:
// - no EXPO_PUBLIC_STADIA_KEY (prototype mode with an empty .env),
// - Expo Go, or a dev build made before MapLibre was added (no native module),
// - the real map throwing while it renders.

import React from 'react';
import { Platform, TurboModuleRegistry } from 'react-native';
import { BayMap } from '../BayMap';
import { chooseRenderer } from './provider';
import { MAP_KEY } from './shared';
import { MapErrorBoundary } from './MapErrorBoundary';
import type { AreaMapProps } from './types';

type NativeMapModule = typeof import('./MapLibreAreaMap');

let nativeMap: NativeMapModule | null | undefined;

/** Loads the MapLibre map once, or null when its native module isn't in this binary. */
function loadNativeMap(): NativeMapModule | null {
  if (nativeMap !== undefined) return nativeMap;
  nativeMap = null;
  if (TurboModuleRegistry.get('MLRNMapViewModule') == null) return nativeMap;
  try {
    // Required lazily: importing the library without its native module throws.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nativeMap = require('./MapLibreAreaMap') as NativeMapModule;
  } catch {
    nativeMap = null;
  }
  return nativeMap;
}

export function AreaMap(props: AreaMapProps) {
  const native = MAP_KEY && (Platform.OS === 'ios' || Platform.OS === 'android') ? loadNativeMap() : null;
  const choice = chooseRenderer({ key: MAP_KEY, platform: Platform.OS, nativeMapAvailable: native !== null });
  if (choice.kind === 'native' && native && MAP_KEY) {
    return (
      <MapErrorBoundary fallback={<BayMap {...props} />}>
        <native.MapLibreAreaMap {...props} mapKey={MAP_KEY} />
      </MapErrorBoundary>
    );
  }
  return <BayMap {...props} />;
}
