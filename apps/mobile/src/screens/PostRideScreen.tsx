import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, TOUCH, type } from '../theme';
import { useNav } from '../navigation';
import { findMatch } from '../data/mock';
import { canSubmitFeedback, type Experience, type Feedback } from '../lib/firstRide';
import type { RideAgainAnswer } from '../state/connection';
import { useFirstRide } from '../state/firstRide';
import { Screen, TopBar } from '../components/Screen';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Avatar, Card } from '../components/primitives';

const EXPERIENCES: { value: Experience; label: string }[] = [
  { value: 'great', label: 'Great experience' },
  { value: 'good', label: 'Good experience' },
  { value: 'not_a_fit', label: 'Not a good fit' },
];

function rideAgainOptions(first: string): { value: RideAgainAnswer; label: string }[] {
  return [
    { value: 'yes', label: `Yes, I'd ride with ${first} again` },
    { value: 'individual', label: 'Maybe, but only for individual rides' },
    { value: 'no', label: 'No, thanks' },
  ];
}

/** Private post-ride feedback (First Ride spec, New screen 1). */
export function PostRideScreen({ matchId }: { matchId: string }) {
  const nav = useNav();
  const { latestRide, submitFeedback } = useFirstRide();
  const m = findMatch(matchId);
  const first = m.name.split(' ')[0];
  // The ride this form answers for, fixed when it opens.
  const [rideId] = useState(() => latestRide(m.id)?.id ?? null);
  const [draft, setDraft] = useState<Feedback>({ experience: null, rideAgain: null });
  const [showSafety, setShowSafety] = useState(false);

  const submit = () => {
    if (rideId === null) return;
    submitFeedback(rideId, draft);
    // Reset, not push: the submitted form isn't reachable again (no editing in the prototype).
    nav.reset({ name: 'postRideThanks', matchId: m.id });
  };

  // "Decide later" records nothing.
  const decideLater = () => (nav.canGoBack ? nav.back() : nav.reset({ name: 'discover' }));

  return (
    <Screen
      header={<TopBar />}
      contentStyle={{ gap: space.lg }}
      footer={
        <>
          <Button label="Submit" disabled={rideId === null || !canSubmitFeedback(draft)} onPress={submit} />
          <Button label="Decide later" variant="secondary" size="md" onPress={decideLater} accessibilityHint="Closes this without saving an answer" />
        </>
      }
    >
      <View style={{ gap: space.md }}>
        <Avatar initials={m.initials} size={52} variant="soft" />
        <Text style={type.title} accessibilityRole="header">
          How was your ride with {first}?
        </Text>
        <View style={styles.privacy}>
          <Icon name="lock-closed" size={16} color={colors.accent} />
          <Text style={[type.body, { color: colors.textSecondary, flex: 1 }]}>Your feedback is private and helps make future rides better.</Text>
        </View>
      </View>

      <Card>
        <View accessibilityRole="radiogroup" accessibilityLabel={`How was your ride with ${first}?`}>
          {EXPERIENCES.map((o, i) => (
            <Choice
              key={o.value}
              label={o.label}
              selected={draft.experience === o.value}
              divider={i > 0}
              onPress={() => setDraft((d) => ({ ...d, experience: o.value }))}
            />
          ))}
        </View>
      </Card>

      <View style={{ gap: space.sm }}>
        <Text style={type.subheading} accessibilityRole="header">
          Would you ride together again?
        </Text>
        <Card>
          <View accessibilityRole="radiogroup" accessibilityLabel="Would you ride together again?">
            {rideAgainOptions(first).map((o, i) => (
              <Choice
                key={o.value}
                label={o.label}
                selected={draft.rideAgain === o.value}
                divider={i > 0}
                onPress={() => setDraft((d) => ({ ...d, rideAgain: o.value }))}
              />
            ))}
          </View>
        </Card>
      </View>

      <View style={{ gap: space.sm }}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showSafety }}
          onPress={() => setShowSafety((v) => !v)}
          hitSlop={4}
          style={({ pressed }) => [styles.safetyLink, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Icon name="shield" size={18} color={colors.accent} />
          <Text style={[type.subheading, { color: colors.accent, textDecorationLine: 'underline' }]}>Report a safety concern</Text>
        </Pressable>
        {showSafety ? (
          // Placeholder until the report flow lands (M-24 builds it, M-44 links it here).
          <View style={styles.safetyNotice} accessibilityLiveRegion="polite">
            <Text style={[type.subheading, { color: colors.deep }]}>In immediate danger? Call 911.</Text>
            <Text style={[type.small, { color: colors.textSecondary }]}>
              {"Safety reports aren't in this prototype yet. They'll go to the Merge team, separately from your ride feedback."}
            </Text>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

function Choice({ label, selected, divider, onPress }: { label: string; selected: boolean; divider: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        divider && styles.divider,
        { backgroundColor: selected ? colors.tint : pressed ? colors.background : colors.surface },
      ]}
    >
      <Icon name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? colors.primary : colors.textFaint} />
      <Text style={[type.body, { flex: 1, color: colors.textPrimary, fontWeight: selected ? '700' : '400' }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  choice: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  safetyLink: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TOUCH, alignSelf: 'flex-start' },
  safetyNotice: { backgroundColor: colors.tint, borderRadius: radius.md, padding: space.md, gap: space.xs },
});
