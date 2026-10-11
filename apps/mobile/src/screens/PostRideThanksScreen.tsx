import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from '../theme';
import { useNav } from '../navigation';
import { findMatch } from '../data/mock';
import { isConnected } from '../lib/firstRide';
import type { RideAgainAnswer } from '../state/connection';
import { useFirstRide } from '../state/firstRide';
import { IconButton, Screen, TopBar } from '../components/Screen';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Badge, Card, InfoNote, Segmented } from '../components/primitives';

const SIMULATED_ANSWERS: { value: RideAgainAnswer; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'individual', label: 'Individual' },
  { value: 'no', label: 'No' },
];

/**
 * After submitting (First Ride spec, New screen 2). Never reveals the other
 * person's answer: the only thing it can change is the Ride Again card, and
 * resolveConnection gives the same outcome whether they said no or haven't
 * answered. The "you'll see it here" line depends only on my own answer: it shows
 * only when I said Yes or Individual, since otherwise no connection can appear.
 */
export function PostRideThanksScreen({ matchId }: { matchId: string }) {
  const nav = useNav();
  const { myRideAgain, connection, simulatedPartnerAnswer, simulatePartnerAnswer } = useFirstRide();
  const m = findMatch(matchId);
  const first = m.name.split(' ')[0];
  const connected = isConnected(connection(m.id));
  const simulated = simulatedPartnerAnswer(m.id);
  // Depends only on my own answer: a connection can appear only if I'm open to riding again.
  const mine = myRideAgain(m.id);
  const openToRideAgain = mine === 'yes' || mine === 'individual';
  const done = () => nav.reset({ name: 'discover' });

  return (
    <Screen
      header={<TopBar right={<IconButton icon="close" label="Close" onPress={done} />} />}
      contentStyle={{ gap: space.lg }}
      footer={<Button label="Done" onPress={done} />}
    >
      <View style={{ gap: space.md }}>
        <View style={styles.check}>
          <Icon name="checkmark" size={28} color={colors.deep} />
        </View>
        <Text style={type.title} accessibilityRole="header">
          {openToRideAgain ? `Thanks. If ${first} also wants to ride again, you'll see it here.` : 'Thanks.'}
        </Text>
        <InfoNote icon="lock-closed" text={`Your answers stay private. ${first} never sees them, and you never see ${first}'s.`} />
      </View>

      {connected ? (
        <Card raised style={{ padding: space.lg, gap: space.sm }}>
          <View accessibilityLiveRegion="polite" style={{ gap: space.sm }}>
            <Badge label="Ride Again" tone="success" />
            <Text style={type.heading}>You and {first} are open to riding again.</Text>
          </View>
        </Card>
      ) : null}

      <View style={styles.prototype}>
        <Text style={[type.eyebrow, { color: colors.textMuted }]}>Prototype</Text>
        <Text style={type.subheading}>{`Prototype: simulate ${first}'s answer`}</Text>
        <Text style={[type.small, { color: colors.textMuted }]}>
          {`Stands in for ${first}'s answer to "Would you ride together again?" The real app never shows it.`}
        </Text>
        <Segmented<RideAgainAnswer | 'unset'>
          options={SIMULATED_ANSWERS}
          value={simulated ?? 'unset'}
          onChange={(answer) => {
            if (answer !== 'unset') simulatePartnerAnswer(m.id, answer);
          }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  check: { width: 52, height: 52, borderRadius: radius.pill, backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  prototype: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
  },
});
