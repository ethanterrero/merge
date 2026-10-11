import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../../theme';
import { areasBounds, type AreaTone, type Bounds } from './areas';
import { MAP_ATTRIBUTION } from './attribution';
import type { Insets } from './projection';
import type { AreaMapItem } from './types';
import { readMapKey } from './provider';

/**
 * The Stadia Maps display key (O-08), from EXPO_PUBLIC_STADIA_KEY. Expo inlines
 * it at build time, so it must be read with this exact static expression.
 * Null in prototype mode with an empty .env.
 */
export const MAP_KEY = readMapKey(process.env.EXPO_PUBLIC_STADIA_KEY);

/** Alameda and downtown San Francisco, shown when there are no areas yet. */
export const DEFAULT_BOUNDS: Bounds = [-122.42, 37.755, -122.225, 37.81];

export const DEFAULT_MIN_SPAN_M = 2500;

export function resolveInsets(insets: Partial<Insets> | undefined): Insets {
  return { top: 0, right: 0, bottom: 0, left: 0, ...insets };
}

/** Breathing room between the outermost circles and the visible edge. */
export const FIT_PADDING = 16;

/** Where the areas must fit: inside the covered edges, plus any extra room and a margin. */
export function cameraPadding(insets: Insets, extra?: Partial<Insets>): Insets {
  const more = resolveInsets(extra);
  return {
    top: insets.top + more.top + FIT_PADDING,
    right: insets.right + more.right + FIT_PADDING,
    bottom: insets.bottom + more.bottom + FIT_PADDING,
    left: insets.left + more.left + FIT_PADDING,
  };
}

export function boundsFor(areas: AreaMapItem[], minSpanM: number | undefined): Bounds {
  return areasBounds(areas, minSpanM ?? DEFAULT_MIN_SPAN_M) ?? DEFAULT_BOUNDS;
}

export function toneColor(tone: AreaTone | undefined): string {
  return tone === 'deep' ? colors.deep : colors.primary;
}

/** The D-08 credit, with each name linking to its source. Shown on every real map. */
export function MapAttribution({ bottom, right }: { bottom: number; right: number }) {
  return (
    <View style={[styles.attribution, { bottom: bottom + 4, right: right + 4 }]} pointerEvents="box-none">
      <Text style={styles.attributionText} accessibilityLabel="Map data credits">
        {MAP_ATTRIBUTION.map((c, i) => (
          <Text key={c.url} accessibilityRole="link" onPress={() => void Linking.openURL(c.url)}>
            {i > 0 ? ' ' : ''}
            {c.label}
          </Text>
        ))}
      </Text>
    </View>
  );
}

/** The small tag hung under an area, for example "Pickup". */
export function AreaTag({ label }: { label: string }) {
  return (
    <View style={styles.tag} pointerEvents="none">
      <Text style={styles.tagText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  attribution: {
    position: 'absolute',
    maxWidth: '92%',
    backgroundColor: colors.mapLabel,
    borderRadius: radius.sm,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  attributionText: { fontSize: 10, lineHeight: 13, color: colors.textSecondary },
  tag: {
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  tagText: { fontSize: 11, fontWeight: '700', color: colors.textPrimary },
});
