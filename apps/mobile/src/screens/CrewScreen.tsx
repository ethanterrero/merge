import React from 'react';
import { Text, View } from 'react-native';
import { colors, space, type } from '../theme';
import { useNav } from '../navigation';
import { findMatch, PROTOTYPE_RIDE_DATE } from '../data/mock';
import { confirmedCrewRides, isOpenCrew, nextCrewRide } from '../lib/crew';
import { addDays, formatDays, formatRideDate } from '../lib/dates';
import { useFirstRide } from '../state/firstRide';
import { Screen, TopBar } from '../components/Screen';
import { Button } from '../components/Button';
import { Badge, Card, InfoNote, Row } from '../components/primitives';

/** Prototype "today" for Crew rides: the day after the prototype's First Ride. */
const CREW_TODAY = addDays(PROTOTYPE_RIDE_DATE, 1);

/**
 * Crew view (First Ride spec, New screen 5). A Crew never creates rides on its
 * own: the next proposed ride is one dated invitation, confirmed or skipped on
 * its own, and skipping declines that day only. Either member can pause, resume
 * or end at any time with no penalty, so there are no confirmations or warnings.
 * Ending returns to Ride Again.
 */
export function CrewScreen({ matchId }: { matchId: string }) {
  const nav = useNav();
  const { crew: crewFor, setCrewStatus, answerCrewRide } = useFirstRide();
  const m = findMatch(matchId);
  const crew = crewFor(m.id);
  const header = <TopBar title="Commute Crew" />;

  if (crew === null || !isOpenCrew(crew) || crew.status === 'proposed') {
    return (
      <Screen header={header} contentStyle={{ gap: space.lg }}>
        <Text style={[type.body, { color: colors.textMuted }]}>Nothing to show here yet.</Text>
        <Button label="Back" variant="secondary" size="md" onPress={nav.back} />
      </Screen>
    );
  }

  const active = crew.status === 'active';
  const next = nextCrewRide(crew, CREW_TODAY);
  const confirmed = confirmedCrewRides(crew, CREW_TODAY);

  return (
    <Screen header={header} contentStyle={{ gap: space.lg }}>
      <View accessibilityLiveRegion="polite" style={{ gap: space.sm }}>
        <Badge label={active ? 'Active' : 'Paused'} tone={active ? 'success' : 'neutral'} />
        <Text style={type.title} accessibilityRole="header">
          {formatDays(crew.days)} · {crew.departureTime}
        </Text>
      </View>

      <View accessibilityLiveRegion="polite" style={{ gap: space.md }}>
        {active ? (
          <>
            {next !== null ? (
              <Card raised style={{ padding: space.lg, gap: space.md }}>
                <View style={{ gap: space.xs }}>
                  <Text style={[type.caption, { color: colors.textMuted }]}>Next proposed ride</Text>
                  <Text style={type.heading} accessibilityRole="header">
                    {formatRideDate(next)} · {crew.departureTime}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Button label="Confirm" size="md" style={{ flex: 1 }} onPress={() => answerCrewRide(m.id, next, 'confirmed')} />
                  <Button label="Skip" variant="secondary" size="md" style={{ flex: 1 }} onPress={() => answerCrewRide(m.id, next, 'skipped')} />
                </View>
              </Card>
            ) : null}
            {confirmed.length > 0 ? (
              <Card>
                {confirmed.map((date, i) => (
                  <Row key={date} divider={i > 0}>
                    <Text style={type.body}>
                      Confirmed: {formatRideDate(date)} · {crew.departureTime}
                    </Text>
                  </Row>
                ))}
              </Card>
            ) : null}
          </>
        ) : (
          <Text style={[type.body, { color: colors.textSecondary }]}>Paused. No rides are proposed until you resume.</Text>
        )}
      </View>

      <View style={{ gap: space.sm }}>
        <Button
          label={active ? 'Pause' : 'Resume'}
          variant="secondary"
          size="md"
          onPress={() => setCrewStatus(m.id, active ? 'paused' : 'active')}
        />
        <Button
          label="End Crew"
          variant="destructive"
          size="md"
          onPress={() => {
            setCrewStatus(m.id, 'ended');
            nav.back();
          }}
        />
      </View>

      <InfoNote text="Either of you can pause, skip, or end anytime, with no penalty." />
    </Screen>
  );
}
