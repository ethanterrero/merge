import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from '../theme';
import { useNav } from '../navigation';
import { findRequest } from '../data/mock';
import { rideDateLine } from '../lib/rideKind';
import { useCommute } from '../state/commute';
import { Screen, TopBar } from '../components/Screen';
import { Button } from '../components/Button';
import { Avatar, Badge, Card, SettingRow } from '../components/primitives';

/** D2: review an incoming request, then accept, suggest a change or decline. */
export function DriverRequestScreen({ requestId }: { requestId: string }) {
  const nav = useNav();
  const { commute } = useCommute();
  const r = findRequest(requestId);
  const first = r.name.split(' ')[0];
  const seatsLeftAfter = Math.max(0, commute.seatsOffered - 1 - r.seats);

  return (
    <Screen
      header={<TopBar title={`${first}'s request`} right={<Text style={[type.caption, { fontWeight: '700', color: colors.textMuted, paddingRight: space.sm }]}>Reply by {r.replyBy}</Text>} />}
      footer={
        <>
          <Button label="Accept" onPress={() => nav.push({ name: 'driverConfirm', requestId: r.id })} />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="Suggest a change" variant="secondary" size="md" style={{ flex: 1 }} />
            <Button label="Decline" variant="destructive" size="md" style={{ flex: 1 }} onPress={nav.back} />
          </View>
        </>
      }
    >
      <Card style={{ padding: space.lg, gap: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Avatar initials={r.initials} size={48} />
          <View style={{ flex: 1 }}>
            <Text style={[type.subheading, { fontSize: 17 }]}>{r.name}</Text>
            <Text style={[type.small, { color: colors.textMuted }]}>
              Passenger · {r.stats.rides} rides · {r.stats.onTime} on time
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {r.verified ? <Badge label="ID verified" tone="success" /> : <Badge label="ID not verified yet" />}
          {r.verified ? <Badge label="Work email verified" tone="success" /> : null}
          {r.ridePrefs.map((p) => (
            <Badge key={p} label={p} />
          ))}
        </View>
      </Card>

      <Card>
        <View style={styles.route} accessibilityLabel={`Your route with the added pickup, ${r.addedDetour}`}>
          <View style={styles.water} />
          <View style={styles.road} />
          <View style={styles.detour} />
          <View style={styles.pin} />
          <View style={styles.detourTag}>
            <Text style={{ color: colors.onDark, fontSize: 11, fontWeight: '700' }}>{r.addedDetour}</Text>
          </View>
        </View>
        <View style={{ padding: space.lg, gap: 2 }}>
          <Text style={type.subheading}>
            {r.pickupSpot} · {r.pickupTime} AM
          </Text>
          <Text style={[type.small, { color: colors.textMuted }]}>{rideDateLine(r.rideDate, r.kind)} · inside your 7:25–7:55 window</Text>
        </View>
      </Card>

      <Card>
        <SettingRow
          title={`${r.seats} seat`}
          trailing={<Text style={[type.small, { color: colors.textMuted }]}>Leaves {seatsLeftAfter} of {commute.seatsOffered} seats open</Text>}
        />
        {r.cargo ? <SettingRow divider title={r.cargo.label} description={r.cargo.detail} trailing={<Badge label="Needs your OK" tone="brand" />} /> : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  route: { height: 112, backgroundColor: colors.land, overflow: 'hidden' },
  water: { position: 'absolute', left: -30, top: 70, width: 200, height: 90, borderRadius: 70, backgroundColor: colors.water },
  road: { position: 'absolute', left: 20, right: 20, top: 30, height: 4, backgroundColor: colors.road },
  detour: {
    position: 'absolute',
    left: '52%',
    top: 30,
    width: 60,
    height: 34,
    borderWidth: 4,
    borderTopWidth: 0,
    borderColor: colors.chili,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  pin: { position: 'absolute', left: '57%', top: 54, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.chili, borderWidth: 3, borderColor: colors.surface },
  detourTag: { position: 'absolute', left: '70%', top: 70, backgroundColor: colors.chili, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
});
