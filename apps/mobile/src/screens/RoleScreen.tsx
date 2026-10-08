import React from 'react';
import { Platform, Pressable, SafeAreaView, ScrollView, StatusBar as RNStatusBar, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { colors, radius, space } from '../theme';
import { useNav } from '../navigation';
import { Role, useCommute } from '../state/commute';
import { useAuth } from '../state/auth';
import { welcomeNext } from '../lib/authRules';
import { Button } from '../components/Button';
import { IconButton } from '../components/Screen';
import { Icon, IconName } from '../components/Icon';

const ROLES: { id: Role; label: string; desc: string; icon: IconName }[] = [
  { id: 'driver', label: 'Drive', desc: 'Offer the open seats in your car', icon: 'car' },
  { id: 'passenger', label: 'Ride', desc: 'Find a seat with a neighbor', icon: 'person' },
  { id: 'both', label: 'Both', desc: 'Drive some days, ride others', icon: 'swap-horizontal' },
];

const androidTop = Platform.OS === 'android' ? RNStatusBar.currentHeight ?? 0 : 0;

/** Sign-up's first step: pick how you'll usually commute. */
export function RoleScreen() {
  const nav = useNav();
  const { status } = useAuth();
  const { commute, update } = useCommute();

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.root}>
        <View style={[styles.top, { paddingTop: androidTop + space.sm }]}>
          <IconButton icon="chevron-back" label="Back" onPress={nav.back} />
        </View>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={styles.intro}>
            <Text style={styles.title} accessibilityRole="header">
              How will you commute?
            </Text>
            <Text style={styles.subtitle}>Pick what fits most weeks.</Text>
          </View>
          <View style={styles.cards} accessibilityRole="radiogroup">
            {ROLES.map((r) => {
              const on = commute.role === r.id;
              return (
                <Pressable
                  key={r.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${r.label}. ${r.desc}`}
                  onPress={() => update({ role: r.id })}
                  style={({ pressed }) => [styles.card, on ? styles.cardOn : styles.cardOff, pressed && !on ? styles.cardPressed : null]}
                >
                  <View style={[styles.cardIcon, { backgroundColor: on ? colors.accent : colors.tint }]}>
                    <Icon name={r.icon} size={24} color={on ? colors.onDark : colors.accent} />
                  </View>
                  <View style={styles.cardText}>
                    <Text style={styles.cardLabel}>{r.label}</Text>
                    <Text style={styles.cardDesc}>{r.desc}</Text>
                  </View>
                  <View style={[styles.radio, on ? styles.radioOn : styles.radioOff]} />
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
        <View style={styles.footer}>
          <Button label="Continue" onPress={() => nav.push({ name: welcomeNext(status) })} style={styles.continue} />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  top: { paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center' },
  body: { paddingHorizontal: space.xxl, paddingTop: space.md, paddingBottom: space.lg, gap: space.xxl },
  intro: { gap: space.sm },
  title: { fontSize: 28, lineHeight: 32, fontWeight: '800', letterSpacing: -0.6, color: colors.textPrimary },
  subtitle: { fontSize: 15, lineHeight: 22, color: colors.textMuted },
  cards: { gap: space.md },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 80,
    paddingVertical: 14,
    paddingHorizontal: space.lg,
    borderRadius: radius.xl,
    borderWidth: 2,
  },
  cardOn: { backgroundColor: colors.tint, borderColor: colors.accent },
  cardOff: { backgroundColor: colors.surface, borderColor: colors.border },
  cardPressed: { backgroundColor: colors.background },
  cardIcon: { width: 48, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  cardText: { flex: 1, gap: 2 },
  cardLabel: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
  cardDesc: { fontSize: 14, color: colors.textMuted },
  radio: { width: 22, height: 22, borderRadius: radius.pill, backgroundColor: colors.surface },
  radioOn: { borderWidth: 7, borderColor: colors.accent },
  radioOff: { borderWidth: 2, borderColor: colors.borderStrong },
  footer: { paddingHorizontal: space.xxl, paddingTop: space.md, paddingBottom: space.lg },
  continue: { borderRadius: radius.lg },
});
