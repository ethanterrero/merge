import React, { useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { colors, radius, shadow, space, type } from '../theme';
import { useNav } from '../navigation';
import { useCommute } from '../state/commute';
import { Match, MATCHES } from '../data/mock';
import { BayMap, Zone } from '../components/BayMap';
import { TabBar } from '../components/TabBar';
import { Icon } from '../components/Icon';
import { IconButton } from '../components/Screen';
import { Avatar, CheckRow, Segmented } from '../components/primitives';

type Filter = 'all' | 'driver' | 'passenger';
const topInset = Platform.OS === 'android' ? RNStatusBar.currentHeight ?? 0 : 0;

export function DiscoverScreen() {
  const nav = useNav();
  const { commute } = useCommute();
  const [filter, setFilter] = useState<Filter>('all');
  const [area, setArea] = useState({ width: 390, height: 700 });

  const matches = MATCHES.filter((m) => filter === 'all' || m.role === filter);

  // Bottom sheet: collapsed leaves ~60% of the screen to the map.
  const collapsedTop = Math.round(area.height * 0.6);
  const expandedTop = 140;
  const top = useRef(new Animated.Value(collapsedTop)).current;
  const [expanded, setExpanded] = useState(false);
  const lastTop = useRef(collapsedTop);

  const snap = (open: boolean) => {
    const to = open ? expandedTop : collapsedTop;
    lastTop.current = to;
    setExpanded(open);
    Animated.timing(top, { toValue: to, duration: 250, useNativeDriver: false }).start();
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6,
        onPanResponderMove: (_, g) => {
          top.setValue(Math.min(collapsedTop, Math.max(expandedTop, lastTop.current + g.dy)));
        },
        onPanResponderRelease: (_, g) => {
          if (g.dy < -40) snap(true);
          else if (g.dy > 40) snap(false);
          else snap(lastTop.current === expandedTop);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collapsedTop],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style="dark" />
      <View
        style={{ flex: 1 }}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setArea({ width, height });
          const next = Math.round(height * 0.6);
          lastTop.current = expanded ? expandedTop : next;
          top.setValue(lastTop.current);
        }}
      >
        <BayMap height={area.height} style={StyleSheet.absoluteFillObject}>
          {matches.map((m) => (
            <MapMarker key={m.id} match={m} width={area.width} height={collapsedTop} onPress={() => nav.push({ name: 'match', matchId: m.id })} />
          ))}
          <View style={[styles.privacyTag, { top: collapsedTop - 44 }, shadow.sm]}>
            <Icon name="lock-closed" size={13} color={colors.textSecondary} />
            <Text style={[type.caption, { color: colors.textSecondary, fontWeight: '600' }]}>Circles show approximate areas</Text>
          </View>
        </BayMap>

        <SafeAreaView style={styles.overlay} pointerEvents="box-none">
          <View style={{ paddingTop: topInset + space.sm, paddingHorizontal: space.lg, gap: 10 }} pointerEvents="box-none">
            <View style={[styles.searchCard, shadow.md]}>
              <Icon name="time" size={20} color={colors.chili} />
              <View style={{ flex: 1 }}>
                <Text style={type.subheading}>Tue, Oct 13 · {commute.departure}</Text>
                <Text style={[type.caption, { color: colors.textMuted }]}>
                  Alameda → Financial District · ±{commute.flexMinutes} min
                </Text>
              </View>
              <IconButton icon="pencil" label="Edit commute" background={colors.background} onPress={() => nav.push({ name: 'commute' })} />
            </View>
            <View style={[styles.filterWrap, shadow.sm]}>
              <Segmented<Filter>
                tone="dark"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'driver', label: 'Drivers' },
                  { value: 'passenger', label: 'Passengers' },
                ]}
              />
            </View>
          </View>
        </SafeAreaView>

        <Animated.View style={[styles.sheet, { top }]}>
          <View {...pan.panHandlers}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={expanded ? 'Collapse matches' : 'Expand matches'}
              onPress={() => snap(!expanded)}
              style={styles.handleHit}
            >
              <View style={styles.handle} />
            </Pressable>
            <View style={styles.sheetHeader}>
              <Text style={type.heading} accessibilityRole="header">
                {matches.length} matches for Tuesday
              </Text>
              <Text style={[type.small, { color: colors.textMuted }]}>Best fit first</Text>
            </View>
          </View>
          <ScrollView contentContainerStyle={{ gap: space.md, paddingBottom: space.xxl }} showsVerticalScrollIndicator={false}>
            {matches.map((m, i) => (
              <MatchCard key={m.id} match={m} highlighted={i === 0} onPress={() => nav.push({ name: 'match', matchId: m.id })} />
            ))}
          </ScrollView>
        </Animated.View>
      </View>
      <TabBar active="discover" />
    </View>
  );
}

function MapMarker({ match, width, height, onPress }: { match: Match; width: number; height: number; onPress: () => void }) {
  const driver = match.role === 'driver';
  const top = match.id === 'priya';
  return (
    <Zone x={width * match.marker.x} y={height * match.marker.y} size={match.marker.size} tone={driver ? 'chili' : 'maroon'} emphasis={top}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${match.name}, ${match.role}`} onPress={onPress} hitSlop={8}>
        <Avatar initials={match.initials} size={34} variant={top ? 'solid' : driver ? 'outline' : 'dark'} />
      </Pressable>
    </Zone>
  );
}

function MatchCard({ match, highlighted, onPress }: { match: Match; highlighted: boolean; onPress: () => void }) {
  const subtitle = match.role === 'driver' ? `Driver · ${match.seatsOpen} seat${match.seatsOpen === 1 ? '' : 's'} open` : `Passenger · leaves ${match.departs}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Opens match details"
      onPress={onPress}
      style={({ pressed }) => [styles.card, highlighted ? styles.cardOn : styles.cardOff, pressed && { opacity: 0.85 }]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Avatar initials={match.initials} variant={match.role === 'driver' ? (highlighted ? 'solid' : 'outline') : 'dark'} />
        <View style={{ flex: 1 }}>
          <Text style={type.subheading}>
            {match.name}
            {match.verified ? <Text style={{ fontSize: 12, fontWeight: '600', color: colors.successText }}> · Verified</Text> : null}
          </Text>
          <Text style={[type.small, { color: colors.textMuted }]}>{subtitle}</Text>
        </View>
        <Icon name="chevron-forward" size={20} color={colors.textFaint} />
      </View>
      <View style={styles.reasons}>
        {match.reasons.map((r) => (
          <View key={r.label} style={{ width: '50%', paddingVertical: 3 }}>
            <CheckRow label={r.label} ok={r.ok} />
          </View>
        ))}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', left: 0, right: 0, top: 0 },
  searchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: space.sm,
    paddingLeft: space.md,
    paddingRight: space.sm,
  },
  filterWrap: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderRadius: radius.pill },
  privacyTag: {
    position: 'absolute',
    left: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: space.lg,
    ...shadow.md,
  },
  handleHit: { height: 28, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong },
  sheetHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingBottom: space.md },
  card: { padding: 14, borderRadius: radius.lg, gap: 10, backgroundColor: colors.surface },
  cardOn: { borderWidth: 2, borderColor: colors.chili },
  cardOff: { borderWidth: 1, borderColor: colors.border },
  reasons: { flexDirection: 'row', flexWrap: 'wrap' },
});
