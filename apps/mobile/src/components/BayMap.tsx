import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import { areaRadius, isValidLatLng, type Bounds, type LatLng } from './map/areas';
import { fitProjection, segmentBox, type Frame, type Projection } from './map/projection';
import { AreaTag, boundsFor, cameraPadding, resolveInsets, toneColor } from './map/shared';
import type { AreaMapItem, AreaMapProps } from './map/types';

/**
 * The stylized East Bay → SF map, drawn from plain views with no tiles and no
 * network. It's the fallback for AreaMap when there's no Stadia key (prototype
 * mode with an empty .env), in Expo Go, or when the real map can't load.
 *
 * Land is a few rounded boxes placed by real coordinates, so areas land in
 * roughly the right place, but it isn't a map to navigate by.
 */
export function BayMap({ areas, style, insets, fitPadding, minSpanM, accessibilityLabel }: AreaMapProps) {
  const [frame, setFrame] = useState<Frame | null>(null);
  const resolved = resolveInsets(insets);
  const proj = frame ? fitProjection(boundsFor(areas, minSpanM), frame, cameraPadding(resolved, fitPadding)) : null;

  return (
    <View
      style={[styles.map, style]}
      onLayout={(e) => setFrame({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      accessibilityLabel={accessibilityLabel ?? 'Map of approximate areas'}
    >
      {proj && frame ? (
        <>
          {LAND.map((box) => (
            <View key={box.join()} style={[styles.land, boxStyle(proj, box)]} />
          ))}
          {BRIDGE.slice(1).map((to, i) => {
            const b = segmentBox(proj.project(BRIDGE[i]), proj.project(to), 4);
            return (
              <View
                key={`bridge-${i}`}
                style={[styles.bridge, { left: b.left, top: b.top, width: b.width, height: b.height, transform: [{ rotate: `${b.angleDeg}deg` }] }]}
              />
            );
          })}
          {PLACES.map((p) => {
            const at = proj.project(p.at);
            // Skip names that would be cut off at an edge.
            if (at.x < 40 || at.y < 12 || at.x > frame.width - 40 || at.y > frame.height - 12) return null;
            return (
              <View key={p.name} style={[styles.centered, { left: at.x - 80, top: at.y - 8 }]} pointerEvents="none">
                <Text style={styles.place}>{p.name}</Text>
              </View>
            );
          })}
          {areas.filter((a) => isValidLatLng(a.center)).map((a) => (
            <FallbackArea key={a.id} area={a} proj={proj} />
          ))}
        </>
      ) : null}
    </View>
  );
}

function FallbackArea({ area, proj }: { area: AreaMapItem; proj: Projection }) {
  const r = areaRadius(area.radiusM) * proj.pxPerMeter;
  const c = proj.project(area.center);
  const stroke = toneColor(area.tone);
  const slop = Math.max(0, 22 - r);
  return (
    <>
      <Pressable
        disabled={!area.onPress}
        onPress={area.onPress}
        hitSlop={slop}
        accessibilityRole={area.onPress ? 'button' : undefined}
        accessibilityLabel={area.accessibilityLabel}
        style={[
          styles.circle,
          {
            left: c.x - r,
            top: c.y - r,
            width: 2 * r,
            height: 2 * r,
            borderRadius: r,
            backgroundColor: area.tone === 'deep' ? colors.maroonZone : colors.chiliZone,
            borderWidth: area.emphasis ? 3 : 2,
            borderStyle: area.dashed ? 'dashed' : 'solid',
            borderColor: area.emphasis ? stroke : `${stroke}88`,
          },
        ]}
      >
        {area.badge ?? null}
      </Pressable>
      {area.label ? (
        <View style={[styles.centered, { left: c.x - 80, top: c.y + r + 3 }]} pointerEvents="none">
          <AreaTag label={area.label} />
        </View>
      ) : null}
    </>
  );
}

function boxStyle(proj: Projection, [west, south, east, north]: Bounds) {
  const nw = proj.project({ lat: north, lng: west });
  const se = proj.project({ lat: south, lng: east });
  const width = se.x - nw.x;
  const height = se.y - nw.y;
  return { left: nw.x, top: nw.y, width, height, borderRadius: Math.min(width, height) * 0.3 };
}

// Rough land boxes, [west, south, east, north]. Stylized on purpose.
const LAND: Bounds[] = [
  [-122.52, 37.705, -122.388, 37.81], // San Francisco
  [-122.372, 37.807, -122.36, 37.83], // Yerba Buena and Treasure Island
  [-122.33, 37.795, -122.1, 37.95], // Oakland, north of the estuary
  [-122.226, 37.715, -122.1, 37.8], // Oakland, east of the estuary
  [-122.335, 37.757, -122.228, 37.789], // Alameda
  [-122.275, 37.723, -122.235, 37.745], // Bay Farm Island
];

// The Bay Bridge, west span then east span, via Yerba Buena Island.
const BRIDGE: LatLng[] = [
  { lat: 37.7885, lng: -122.3885 },
  { lat: 37.8105, lng: -122.364 },
  { lat: 37.8235, lng: -122.305 },
];

const PLACES: { name: string; at: LatLng }[] = [
  { name: 'San Francisco', at: { lat: 37.772, lng: -122.44 } },
  { name: 'Oakland', at: { lat: 37.812, lng: -122.262 } },
  { name: 'Alameda', at: { lat: 37.761, lng: -122.29 } },
];

const styles = StyleSheet.create({
  map: { backgroundColor: colors.water, overflow: 'hidden', position: 'relative' },
  land: { position: 'absolute', backgroundColor: colors.land },
  bridge: { position: 'absolute', backgroundColor: colors.road },
  circle: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  centered: { position: 'absolute', width: 160, alignItems: 'center' },
  place: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
});
