import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { Route, useNav } from '../navigation';
import { Icon, IconName } from './Icon';

type Tab = { key: 'discover' | 'trips' | 'profile'; label: string; icon: IconName; route: Route; badge?: number };

const TABS: Tab[] = [
  { key: 'discover', label: 'Discover', icon: 'location', route: { name: 'discover' } },
  { key: 'trips', label: 'Trips', icon: 'calendar', route: { name: 'driverRequests' }, badge: 2 },
  { key: 'profile', label: 'Profile', icon: 'person', route: { name: 'preferences' } },
];

export function TabBar({ active }: { active: Tab['key'] }) {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom }]}>
      <View style={styles.row} accessibilityRole="tablist">
        {TABS.map((t) => {
          const on = t.key === active;
          const color = on ? colors.ember : colors.textMuted;
          return (
            <Pressable
              key={t.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t.badge ? `${t.label}, ${t.badge} new` : t.label}
              onPress={() => (on ? undefined : nav.reset(t.route))}
              style={styles.tab}
            >
              <View>
                <Icon name={t.icon} size={24} color={color} />
                {t.badge ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{t.badge}</Text>
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
