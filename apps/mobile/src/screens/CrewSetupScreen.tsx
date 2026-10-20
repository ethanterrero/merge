import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, shadow, space, type } from '../theme';
import { useNav } from '../navigation';
import { findMatch, type Weekday } from '../data/mock';
import { canProposeCrew, isValidCrewDays } from '../lib/crew';
import { formatDays } from '../lib/dates';
import { toggleIn } from '../state/commute';
import { useFirstRide } from '../state/firstRide';
import { Screen, TopBar } from '../components/Screen';
import { Button } from '../components/Button';
import { Badge, Card, Chip, InfoNote } from '../components/primitives';
import { TimeField } from '../components/TimeField';

/**
 * Crew setup (First Ride spec, New screen 4). Days are limited to the match's
 * shared days. After sending, the proposal waits on the other person, whose
 * answer the prototype simulates. A decline shows the neutral "Not started" and
 * never says who declined; Ride Again stays. The "just declined" view is local,
 * so reopening Crew setup shows the form again.
 */
export function CrewSetupScreen({ matchId }: { matchId: string }) {
  const nav = useNav();
  const { connection, crew: crewFor, proposeCrew, simulateCrewAnswer } = useFirstRide();
  const m = findMatch(matchId);
  const first = m.name.split(' ')[0];
  const crew = crewFor(m.id);
  const [days, setDays] = useState<Weekday[]>(m.sharedDays);
  const [departureTime, setDepartureTime] = useState(`${m.departs} AM`);
  const [declined, setDeclined] = useState(false);

  const header = <TopBar title="Commute Crew" />;

  if (declined) {
    return (
      <Screen header={header} contentStyle={{ gap: space.lg }} footer={<Button label="Back to Ride Again" onPress={nav.back} />}>
        <View accessibilityLiveRegion="polite" style={{ gap: space.md }}>
          <Badge label="Not started" tone="neutral" />
          <Text style={type.title} accessibilityRole="header">
            Commute Crew
          </Text>
          <Text style={[type.body, { color: colors.textSecondary }]}>
            Ride Again stays on. You can still invite {first} for single rides.
          </Text>
        </View>
      </Screen>
    );
  }

  if (crew !== null && crew.status === 'proposed') {
    return (
      <Screen header={header} contentStyle={{ gap: space.lg }}>
        <View accessibilityLiveRegion="polite" style={{ gap: space.md }}>
          <Badge label="Proposed" tone="brand" />
          <Text style={type.title} accessibilityRole="header">
            Commute Crew
          </Text>
          <Card style={{ padding: space.lg, gap: space.xs }}>
            <Text style={[type.caption, { color: colors.textMuted }]}>Days and time</Text>
            <Text style={type.heading}>
              {formatDays(crew.days)} · {crew.departureTime}
            </Text>
          </Card>
          <InfoNote text="Each ride is still confirmed individually. You can pause, skip, or end anytime, with no penalty." />
        </View>

        <View style={styles.prototype}>
          <Text style={[type.eyebrow, { color: colors.textMuted }]}>Prototype</Text>
          <Text style={type.subheading}>{`Prototype: simulate ${first}'s answer`}</Text>
          <Text style={[type.small, { color: colors.textMuted }]}>
            {`Stands in for ${first}'s answer to the proposal. The real app never shows it.`}
          </Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button
              label="Accept"
              variant="secondary"
              size="md"
              style={{ flex: 1 }}
              onPress={() => {
                simulateCrewAnswer(m.id, true);
                nav.back();
                nav.push({ name: 'crew', matchId: m.id });
              }}
            />
            <Button
              label="Decline"
              variant="secondary"
              size="md"
              style={{ flex: 1 }}
              onPress={() => {
                simulateCrewAnswer(m.id, false);
                setDeclined(true);
              }}
            />
          </View>
        </View>
      </Screen>
    );
  }

  if (crew !== null && (crew.status === 'active' || crew.status === 'paused')) {
    return (
      <Screen header={header} contentStyle={{ gap: space.lg }}>
        <Text style={[type.body, { color: colors.textSecondary }]}>
          You and {first} already have a Commute Crew.
        </Text>
        <Button
          label="Open Commute Crew"
          variant="tinted"
          size="md"
          onPress={() => {
            nav.back();
            nav.push({ name: 'crew', matchId: m.id });
          }}
        />
      </Screen>
    );
  }

  if (!canProposeCrew(connection(m.id), crew)) {
    return (
      <Screen header={header}>
        <Text style={[type.body, { color: colors.textMuted }]}>Nothing to show here yet.</Text>
      </Screen>
    );
  }

  const valid = isValidCrewDays(days, m.sharedDays);
  return (
    <Screen
      header={header}
      contentStyle={{ gap: space.lg }}
      footer={<Button label="Send proposal" disabled={!valid} onPress={() => proposeCrew(m.id, days, m.sharedDays, departureTime)} />}
    >
      <Text style={type.title} accessibilityRole="header">
        Start a Commute Crew
      </Text>

      <View style={{ gap: space.sm }}>
        <Text style={type.subheading}>Days</Text>
        <Text style={[type.small, { color: colors.textMuted }]}>Only days you and {first} both commute.</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {m.sharedDays.map((day) => (
            <Chip key={day} label={day} selected={days.includes(day)} onPress={() => setDays((d) => toggleIn(d, day))} />
          ))}
        </View>
      </View>

      <TimeField label="Leave around" value={departureTime} onChange={setDepartureTime} style={shadow.sm} />

      <InfoNote text="Each ride is still confirmed individually. You can pause, skip, or end anytime, with no penalty." />
    </Screen>
  );
}

const styles = StyleSheet.create({
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
