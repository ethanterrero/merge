import React from 'react';
import { Platform, Pressable, SafeAreaView, StatusBar as RNStatusBar, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from '../theme';
import { useNav } from '../navigation';
import { Role, useCommute } from '../state/commute';
import { useAuth } from '../state/auth';
import { welcomeNext } from '../lib/authRules';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { Icon, IconName } from '../components/Icon';
import { Eyebrow } from '../components/primitives';

const ROLES: { id: Role; label: string; desc: string; icon: IconName }[] = [
  { id: 'driver', label: 'Drive', desc: 'Offer open seats', icon: 'car' },
  { id: 'passenger', label: 'Ride', desc: 'Find a seat', icon: 'person' },
  { id: 'both', label: 'Both', desc: 'Switch by day', icon: 'swap-horizontal' },
];

const WHY: { icon: IconName; title: string; body: string }[] = [
  { icon: 'people', title: 'Neighbors, not drivers for hire', body: "Ride with people already driving your route. No one makes a special trip." },
  { icon: 'calendar', title: 'The same ride, every week', body: 'Set your schedule once. Merge finds recurring matches, not one-off trips.' },
  { icon: 'shield', title: 'Private by default', body: 'Others see an approximate area. Never your address or live location.' },
];

export function WelcomeScreen() {
  const nav = useNav();
  const { commute, update } = useCommute();
  const { status } = useAuth();

  return (
    <Screen
      statusBar="light"
      background={colors.surface}
      contentStyle={{ padding: 0, gap: 0 }}
      footer={<Button label="Continue" onPress={() => nav.push({ name: welcomeNext(status) })} />}
    >
      <View style={styles.hero}>
        <SafeAreaView>
          <View style={{ paddingTop: (Platform.OS === 'android' ? RNStatusBar.currentHeight ?? 0 : 0) + space.lg, gap: 18 }}>
            <View style={styles.brandRow}>
              <View style={styles.logo}>
                <Icon name="git-merge" size={20} color={colors.maroon} />
              </View>
              <Text style={styles.wordmark}>merge</Text>
            </View>
            <Text style={[type.display, { color: colors.onDark }]} accessibilityRole="header">
              Share the commute you're already making.
            </Text>
            <View style={styles.route} accessibilityLabel="Alameda to San Francisco over the Bay Bridge">
              <View style={[styles.dot, { backgroundColor: colors.onDark }]} />
              <View style={styles.dash} />
              <View style={styles.bridgePill}>
                <Text style={styles.bridgeText}>Bay Bridge</Text>
              </View>
              <View style={styles.dash} />
              <View style={[styles.dot, { backgroundColor: colors.peach }]} />
            </View>
          </View>
        </SafeAreaView>
      </View>

      <View style={{ padding: space.xxl, paddingBottom: space.sm, gap: 14 }}>
        <Eyebrow>Not ride-hailing</Eyebrow>
        {WHY.map((w) => (
          <View key={w.title} style={styles.why}>
            <View style={styles.whyIcon}>
              <Icon name={w.icon} size={18} color={colors.ember} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={type.subheading}>{w.title}</Text>
              <Text style={[type.small, { color: colors.textMuted }]}>{w.body}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={{ paddingHorizontal: space.xxl, paddingTop: space.md, gap: 10 }}>
        <Text style={[type.heading, { fontSize: 17 }]}>How will you commute?</Text>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {ROLES.map((r) => {
            const on = commute.role === r.id;
            return (
              <Pressable
                key={r.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`${r.label}, ${r.desc}`}
                onPress={() => update({ role: r.id })}
                style={[styles.role, on ? styles.roleOn : styles.roleOff]}
              >
                <Icon name={r.icon} size={24} color={on ? colors.chili : colors.textPrimary} />
                <Text style={[type.subheading, { color: on ? colors.ember : colors.textPrimary }]}>{r.label}</Text>
                <Text style={[type.caption, { color: colors.textMuted }]}>{r.desc}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.maroon, paddingHorizontal: space.xxl, paddingBottom: space.xxl },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.peach, alignItems: 'center', justifyContent: 'center' },
  wordmark: { color: colors.onDark, fontSize: 22, fontWeight: '700', letterSpacing: -0.4 },
  route: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dash: { flex: 1, borderTopWidth: 3, borderStyle: 'dashed', borderColor: colors.water },
  bridgePill: { backgroundColor: colors.chili, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill },
  bridgeText: { color: colors.onDark, fontSize: 12, fontWeight: '600' },
  why: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  whyIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.blush, alignItems: 'center', justifyContent: 'center' },
  role: { flex: 1, minHeight: 104, padding: space.md, borderRadius: radius.lg, gap: 6 },
  roleOn: { backgroundColor: colors.blush, borderWidth: 2, borderColor: colors.chili },
  roleOff: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.border },
});
