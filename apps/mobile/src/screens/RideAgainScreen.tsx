import React from 'react';
import { Text, View } from 'react-native';
import { colors, space, type } from '../theme';
import { useNav } from '../navigation';
import { findMatch } from '../data/mock';
import { canProposeCrew, isOpenCrew } from '../lib/crew';
import { formatDays } from '../lib/dates';
import { isConnected } from '../lib/firstRide';
import { useFirstRide } from '../state/firstRide';
import { Screen, TopBar } from '../components/Screen';
import { Button } from '../components/Button';
import { Badge, Card } from '../components/primitives';

/**
 * Ride Again on the match connection (First Ride spec, New screen 3). Shows
 * only when the pair is connected, which never reveals whether the other person
 * said no. Each invitation is for one date. The Crew card follows the pair's
 * Crew: an open Crew links to it or its proposal; otherwise "Start a Commute
 * Crew" appears only when both answered Yes.
 */
export function RideAgainScreen({ matchId }: { matchId: string }) {
  const nav = useNav();
  const { connection, crew: crewFor } = useFirstRide();
  const m = findMatch(matchId);
  const first = m.name.split(' ')[0];
  const outcome = connection(m.id);
  const connected = isConnected(outcome);
  const crew = crewFor(m.id);
  const open = isOpenCrew(crew);

  return (
    <Screen header={<TopBar title={m.name} />} contentStyle={{ gap: space.lg }}>
      {connected ? (
        <View style={{ gap: space.md }}>
          <Badge label="Ride Again" tone="success" />
          <Text style={type.title} accessibilityRole="header">
            You and {first} are open to riding again.
          </Text>
          <Text style={[type.body, { color: colors.textSecondary }]}>
            Each ride is its own invitation for one date.
          </Text>
          <Button label="Invite for another ride" onPress={() => nav.push({ name: 'request', matchId: m.id, kind: 'ride_again' })} />
        </View>
      ) : null}

      <View accessibilityLiveRegion="polite" style={{ gap: space.md }}>
        {crew !== null && (crew.status === 'active' || crew.status === 'paused') ? (
          <Card raised style={{ padding: space.lg, gap: space.sm }}>
            <Badge label={crew.status === 'active' ? 'Active' : 'Paused'} tone={crew.status === 'active' ? 'success' : 'neutral'} />
            <Text style={type.heading} accessibilityRole="header">
              Commute Crew
            </Text>
            <Text style={[type.body, { color: colors.textSecondary }]}>
              {formatDays(crew.days)} · {crew.departureTime}
            </Text>
            <Button label="Open Commute Crew" variant="tinted" size="md" onPress={() => nav.push({ name: 'crew', matchId: m.id })} />
          </Card>
        ) : crew !== null && crew.status === 'proposed' ? (
          <Card raised style={{ padding: space.lg, gap: space.sm }}>
            <Badge label="Proposed" tone="brand" />
            <Text style={type.heading} accessibilityRole="header">
              Commute Crew
            </Text>
            <Text style={[type.body, { color: colors.textSecondary }]}>
              {formatDays(crew.days)} · {crew.departureTime}
            </Text>
            <Button label="View proposal" variant="tinted" size="md" onPress={() => nav.push({ name: 'crewSetup', matchId: m.id })} />
          </Card>
        ) : canProposeCrew(outcome, crew) ? (
          <Card raised style={{ padding: space.lg, gap: space.sm }}>
            {crew?.status === 'not_started' ? <Badge label="Not started" tone="neutral" /> : null}
            <Text style={type.heading} accessibilityRole="header">
              Start a Commute Crew
            </Text>
            <Text style={[type.body, { color: colors.textSecondary }]}>
              Choose days you both commute. Each ride is still confirmed individually.
            </Text>
            <Button label="Start a Commute Crew" variant="tinted" size="md" onPress={() => nav.push({ name: 'crewSetup', matchId: m.id })} />
          </Card>
        ) : null}

        {!connected && !open ? (
          <Text style={[type.body, { color: colors.textMuted }]}>Nothing to show here yet.</Text>
        ) : null}
      </View>
    </Screen>
  );
}
