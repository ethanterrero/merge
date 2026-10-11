import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, space, type } from '../theme';
import { useNav } from '../navigation';
import { PROTOTYPE_RIDE_DATE, findMatch } from '../data/mock';
import { formatRideDate } from '../lib/dates';
import { useCommute } from '../state/commute';
import { useFirstRide } from '../state/firstRide';
import { postRideRoute } from '../lib/firstRide';
import { IconButton, Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { Icon, IconName } from '../components/Icon';
import { Badge, Card } from '../components/primitives';

export function BookedScreen({ matchId }: { matchId: string }) {
  const nav = useNav();
  const { commute } = useCommute();
  const { relationship, completeRide } = useFirstRide();
  const m = findMatch(matchId);
  const first = m.name.split(' ')[0];
  const insets = useSafeAreaInsets();
  const rideDay = formatRideDate(PROTOTYPE_RIDE_DATE);

  // Prototype: stands in for the ride ending (D-01's arrival or fallback timer).
  const simulateCompleted = () => {
    const next = postRideRoute(relationship(m.id));
    completeRide(m.id);
    nav.push({ name: next, matchId: m.id });
  };

  return (
    <Screen
      statusBar="light"
      header={
        <View style={styles.header}>
          <View style={{ paddingTop: insets.top, gap: space.md }}>
            <View style={{ paddingHorizontal: space.sm }}>
              <IconButton icon="close" label="Close" color={colors.onDark} onPress={() => nav.reset({ name: 'discover' })} />
            </View>
            <View style={styles.identity}>
              <View style={styles.check}>
                <Icon name="checkmark" size={28} color={colors.maroon} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[type.heading, { color: colors.onDark, fontSize: 22 }]} accessibilityRole="header">
                  First Ride booked with {first}
                </Text>
                <Text style={[type.small, { color: colors.onDarkMuted }]}>{rideDay}</Text>
              </View>
            </View>
          </View>
        </View>
      }
      footer={
        <View style={{ gap: space.sm }}>
          <Button
            label="Prototype: simulate ride completed"
            variant="tinted"
            size="md"
            onPress={simulateCompleted}
            accessibilityHint={`Opens the post-ride questions for your ride with ${first}`}
          />
          <Button label="Cancel ride" variant="destructive" size="md" accessibilityHint={`Cancels only this ride with ${first}, on ${rideDay}`} />
        </View>
      }
    >
      <Card raised style={{ padding: space.lg, gap: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text style={[type.subheading, { flex: 1 }]} accessibilityRole="header">
            Pickup instructions
          </Text>
          <Badge label="Unlocked" tone="success" />
        </View>
        <Detail icon="location" iconColor={colors.chili} title={`[Exact pickup spot] · ${m.departs} AM`} body={`[${first}'s note, e.g. which side of the street to wait on]`} />
        <Detail
          icon="car"
          iconColor={colors.ember}
          title="[Make, color] · [plate]"
          body={commute.bringsCargo ? '1 seat booked · scooter approved for the trunk' : '1 seat booked'}
        />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button label={`Message ${first}`} variant="secondary" size="sm" style={{ flex: 1, height: 44 }} />
          <Button label="Add to calendar" variant="secondary" size="sm" style={{ flex: 1, height: 44 }} />
        </View>
      </Card>

      <Card style={{ padding: space.lg, gap: 10 }}>
        <Text style={type.subheading} accessibilityRole="header">
          If plans change
        </Text>
        <Plan icon="notifications" lead={`If ${first} can't drive,`} body="you're notified right away and Merge shows other drivers for that day." />
        <Plan icon="time" lead="If you can't make it," body={`cancel before [cutoff] so ${first} can plan.`} />
        <Text style={[type.caption, { color: colors.textMuted }]}>Your location stays on your phone. {first} never sees it. Use messages to coordinate.</Text>
      </Card>
    </Screen>
  );
}

function Detail({ icon, iconColor, title, body }: { icon: IconName; iconColor: string; title: string; body: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
      <Icon name={icon} size={20} color={iconColor} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={type.subheading}>{title}</Text>
        <Text style={[type.small, { color: colors.textMuted }]}>{body}</Text>
      </View>
    </View>
  );
}

function Plan({ icon, lead, body }: { icon: IconName; lead: string; body: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <Icon name={icon} size={18} color={colors.ember} />
      <Text style={[type.small, { color: colors.textSecondary, flex: 1 }]}>
        <Text style={{ fontWeight: '700', color: colors.textPrimary }}>{lead} </Text>
        {body}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.maroon, paddingBottom: space.xl },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: space.xl },
  check: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.peach, alignItems: 'center', justifyContent: 'center' },
});
