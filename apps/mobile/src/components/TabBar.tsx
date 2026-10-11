import React, { useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { Route, useNav } from '../navigation';
import { Icon, IconName } from './Icon';
import { useCommute } from '../state/commute';
import { REQUESTS } from '../data/mock';
import { MOCK_TRIPS_TODAY, mockTripsSession } from '../data/mockTrips';
import { useBlockedIds } from '../lib/data/blocks';
import {
  fromItems,
  fromToday,
  gateOnBlocks,
  keepUnblockedPerson,
  needsReplyCount,
  sidesFor,
  toIncomingRequest,
  tripsTabLabel,
} from '../lib/trips';

type Tab = { key: 'discover' | 'trips' | 'profile'; label: string; icon: IconName; route: Route };

const TABS: Tab[] = [
  { key: 'discover', label: 'Discover', icon: 'location', route: { name: 'discover' } },
  { key: 'trips', label: 'Trips', icon: 'calendar', route: { name: 'trips' } },
  { key: 'profile', label: 'Profile', icon: 'person', route: { name: 'preferences' } },
];

/**
 * Items that need my reply (requests and invites to me), from the same sources as
 * TripsScreen, minus blocked people. 0 until the block list is ready. M-36 swaps the
 * sources for the live inbox count plus M-35's invites-for-me count.
 */
function useTripsBadgeCount(): number {
  const { commute } = useCommute();
  const blocked = useBlockedIds();
  const session = useSyncExternalStore(mockTripsSession.subscribe, mockTripsSession.getSnapshot, mockTripsSession.getSnapshot);
  const sides = sidesFor(commute.role);
  const incoming = sides.driving ? REQUESTS.filter((r) => !commute.acceptedRequests.includes(r.id)).map(toIncomingRequest) : [];
  const invites = sides.riding ? fromToday(session.invites, MOCK_TRIPS_TODAY) : [];
  return needsReplyCount(
    gateOnBlocks(fromItems(incoming), blocked, keepUnblockedPerson),
    gateOnBlocks(fromItems(invites), blocked, keepUnblockedPerson),
  );
}

export function TabBar({ active }: { active: Tab['key'] }) {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const tripsBadge = useTripsBadgeCount();
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom }]}>
      <View style={styles.row} accessibilityRole="tablist">
        {TABS.map((t) => {
          const on = t.key === active;
          const badge = t.key === 'trips' ? tripsBadge : 0;
          const color = on ? colors.ember : colors.textMuted;
          return (
            <Pressable
              key={t.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t.key === 'trips' ? tripsTabLabel(badge) : t.label}
              onPress={() => (on ? undefined : nav.reset(t.route))}
              style={styles.tab}
            >
              <View>
                <Icon name={t.icon} size={24} color={color} />
                {badge > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{badge}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.label, { color }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  row: { flexDirection: 'row', height: 60 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: { fontSize: 12, fontWeight: '700' },
  badge: {
    position: 'absolute',
    top: -4,
    right: -12,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: colors.chili,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.onDark, fontSize: 11, fontWeight: '700' },
});
