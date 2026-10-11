import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, space, type } from '../theme';
import { useNav } from '../navigation';
import { PROTOTYPE_RIDE_DATE, findMatch } from '../data/mock';
import { formatRideDate } from '../lib/dates';
import { rideKindBadge } from '../lib/rideKind';
import { useCommute } from '../state/commute';
import { Screen, TopBar } from '../components/Screen';
import { Button } from '../components/Button';
import { Badge, Card, Row, SettingRow } from '../components/primitives';

export function RequestRideScreen({ matchId }: { matchId: string }) {
  const nav = useNav();
  const { commute, update } = useCommute();
  const m = findMatch(matchId);
  const first = m.name.split(' ')[0];
  // Every new match starts with one ride on one date (First Ride spec).
  const rideDate = PROTOTYPE_RIDE_DATE;
  const badge = rideKindBadge('first_ride');

  const send = () => {
    // Prototype: treat the request as accepted so the booked state can be reviewed.
    update({ bookedMatchId: m.id });
    nav.reset({ name: 'booked', matchId: m.id });
  };

  return (
    <Screen header={<TopBar title={`Request a First Ride with ${first}`} />} footer={<Button label="Send request" onPress={send} />}>
      <Card>
        <View style={styles.miniMap} accessibilityLabel="Proposed pickup spot within your pickup area">
          <View style={[styles.water]} />
          <View style={styles.streetH} />
          <View style={styles.streetV} />
          <View style={styles.zone} />
          <View style={styles.pin} />
        </View>
        <Row>
          <View style={{ flex: 1 }}>
            <Text style={[type.caption, { color: colors.textMuted }]}>Your proposed pickup spot</Text>
            <Text style={type.subheading}>Park St & Central Ave</Text>
            <Text style={[type.caption, { color: colors.textMuted }]}>
              Inside your pickup area · adds {m.detourMinutes ?? 0} min for {first}
            </Text>
          </View>
          <Button label="Move" variant="tinted" size="sm" accessibilityHint="Choose a different pickup spot" />
        </Row>
      </Card>

      <Card>
        <Row>
          <View style={{ flex: 1 }}>
            <Text style={[type.caption, { color: colors.textMuted }]}>Pickup time</Text>
            <Text style={type.subheading}>
              {formatRideDate(rideDate)} · {m.departs} AM
            </Text>
            <Text style={[type.caption, { color: colors.textMuted }]}>{first}'s window {m.window}</Text>
          </View>
          {badge ? <Badge label={badge} tone="brand" /> : null}
        </Row>
        <SettingRow
          divider
          title={commute.bringsCargo ? '1 seat + foldable scooter' : '1 seat'}
          description={commute.bringsCargo ? `${first} approves the scooter separately` : undefined}
          trailing={<Button label="Edit" variant="tinted" size="sm" />}
        />
      </Card>

      <Card style={{ padding: space.lg, gap: 10 }}>
        <Text style={type.subheading} accessibilityRole="header">
          What happens next
        </Text>
        <NextStep n={1} active title={`${first} reviews`} body="your spot, time, and cargo before [cutoff]." />
        <NextStep n={2} title="They accept, suggest a change, or decline." body="If they suggest a different spot, you decide." />
        <NextStep n={3} title="Your seat is booked." body="Exact pickup instructions unlock for both of you." />
        <Text style={[type.small, { color: colors.textSecondary }]}>This is one ride. No recurring commitment.</Text>
      </Card>
    </Screen>
  );
}

function NextStep({ n, title, body, active }: { n: number; title: string; body: string; active?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <View style={[styles.stepDot, { backgroundColor: active ? colors.chili : colors.blush }]}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: active ? colors.onDark : colors.maroon }}>{n}</Text>
      </View>
      <Text style={[type.small, { color: colors.textSecondary, flex: 1 }]}>
        <Text style={{ fontWeight: '700', color: colors.textPrimary }}>{title} </Text>
        {body}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  miniMap: { height: 120, backgroundColor: colors.land, overflow: 'hidden' },
  water: { position: 'absolute', left: -40, top: 80, width: 240, height: 100, borderRadius: 80, backgroundColor: colors.water },
  streetH: { position: 'absolute', left: 0, right: 0, top: 46, height: 8, backgroundColor: colors.surface },
  streetV: { position: 'absolute', left: '58%', top: 0, bottom: 0, width: 8, backgroundColor: colors.surface },
  zone: {
    position: 'absolute',
    left: '45%',
    top: 4,
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: colors.chiliZone,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.chili,
  },
  pin: {
    position: 'absolute',
    left: '57%',
    top: 40,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.chili,
    borderWidth: 3,
    borderColor: colors.surface,
  },
  stepDot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
