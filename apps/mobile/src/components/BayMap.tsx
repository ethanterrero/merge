import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '../theme';

/**
 * Stylized East Bay → SF map drawn with plain views. A stand-in until a real
 * map (react-native-maps or Mapbox) is wired up. Children are positioned
 * absolutely on top of it; use `Zone` for generalized areas.
 */
export function BayMap({ height, children, style }: { height: number; children?: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[styles.map, { height }, style]} accessibilityLabel="Map of approximate commuter areas">
      <View style={[styles.land, { left: -70, top: -40, width: 180, height: height * 0.66, borderTopRightRadius: 60, borderBottomRightRadius: 90 }]} />
      <View style={[styles.land, { right: -60, top: -30, width: 200, height: height + 60, borderTopLeftRadius: 90, borderBottomLeftRadius: 40 }]} />
      <View style={[styles.land, { left: '50%', top: height * 0.61, width: 130, height: 80, borderRadius: 40 }]} />
      <View style={[styles.bridge, { left: 106, top: height * 0.36, width: 150 }]} />
      <Text style={[styles.label, { left: 12, top: height * 0.28 }]}>San Francisco</Text>
      <Text style={[styles.label, { right: 24, top: height * 0.31 }]}>Oakland</Text>
      <Text style={[styles.label, { left: '55%', top: height * 0.77 }]}>Alameda</Text>
      {children}
    </View>
  );
}

/** A generalized area — never an exact point. */
export function Zone({
  x,
  y,
  size,
  tone = 'chili',
  emphasis,
  dashed,
  children,
}: {
  x: number;
  y: number;
  size: number;
  tone?: 'chili' | 'maroon';
  emphasis?: boolean;
  dashed?: boolean;
  children?: React.ReactNode;
}) {
  const stroke = tone === 'chili' ? colors.chili : colors.maroon;
  return (
    <View
      style={{
        position: 'absolute',
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: tone === 'chili' ? colors.chiliZone : colors.maroonZone,
        borderWidth: emphasis ? 3 : 2,
        borderStyle: dashed ? 'dashed' : 'solid',
        borderColor: emphasis ? stroke : `${stroke}88`,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  map: { backgroundColor: colors.water, overflow: 'hidden', position: 'relative' },
  land: { position: 'absolute', backgroundColor: colors.land },
  bridge: { position: 'absolute', height: 4, backgroundColor: colors.road, transform: [{ rotate: '-8deg' }] },
  label: { position: 'absolute', fontSize: 12, fontWeight: '700', color: colors.textSecondary },
});
