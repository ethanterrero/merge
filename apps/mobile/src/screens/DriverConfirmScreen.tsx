import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from '../theme';
import { useNav } from '../navigation';
import { findRequest } from '../data/mock';
import { rideDateLine } from '../lib/rideKind';
import { useCommute } from '../state/commute';
import { Screen, TopBar } from '../components/Screen';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Card, InfoNote } from '../components/primitives';

/** D3: the driver confirms seat and cargo; booking happens as one step. */
export function DriverConfirmScreen({ requestId }: { requestId: string }) {
  const nav = useNav();
  const { commute, update } = useCommute();
  const r = findRequest(requestId);
  const first = r.name.split(' ')[0];
  const [cargoChecked, setCargoChecked] = useState(false);
  const canConfirm = !r.cargo || cargoChecked;

  const confirm = () => {
    update({ acceptedRequests: [...commute.acceptedRequests, r.id] });
    nav.reset({ name: 'driverRequests', tab: 'upcoming' });
  };

  return (
    <Screen
      header={<TopBar title="Confirm seat and cargo" />}
      footer={<Button label="Confirm booking" disabled={!canConfirm} onPress={confirm} accessibilityHint={`Books ${first}'s seat${r.cargo ? ' and scooter' : ''}`} />}
    >
      <Card style={{ padding: space.lg, gap: space.md }}>
        <View style={styles.titleRow}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={type.subheading}>Seats</Text>
            <Text style={[type.small, { color: colors.textMuted }]}>{rideDateLine(r.rideDate, r.kind)}</Text>
          </View>
          <Text style={[type.small, { color: colors.textMuted }]}>{commute.seatsOffered} offered</Text>
        </View>
        <View style={styles.car} accessibilityLabel={`Seat map: you are driving, Sam R. is booked, ${first} takes the last offered seat`}>
          <Seat label="You" tone="dark" />
          <Seat label="Not offered" tone="empty" />
          <Seat label="Sam R." sub="Booked" tone="booked" />
          <Seat label={r.name} sub="This request" tone="new" />
        </View>
      </Card>

      {r.cargo ? (
        <Card style={{ padding: space.lg, gap: space.md }}>
          <View style={styles.titleRow}>
            <Text style={type.subheading}>Trunk</Text>
            <Text style={[type.small, { color: colors.textMuted }]}>{r.cargo.label}</Text>
          </View>
          <View style={{ gap: 6 }}>
            <View style={styles.meter} accessibilityLabel="Uses about half of your trunk space">
              <View style={{ width: '55%', backgroundColor: colors.chili }} />
            </View>
            <Text style={[type.caption, { color: colors.textMuted }]}>Uses about half of the trunk space you listed</Text>
          </View>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: cargoChecked }}
            onPress={() => setCargoChecked((c) => !c)}
            style={styles.checkbox}
          >
            <View style={[styles.box, cargoChecked && styles.boxOn]}>{cargoChecked ? <Icon name="checkmark" size={16} color={colors.onDark} /> : null}</View>
            <Text style={[type.small, { color: colors.textPrimary, flex: 1 }]}>
              I have room for a scooter up to [dimensions] and [weight], and it can be stowed securely.
            </Text>
          </Pressable>
        </Card>
      ) : null}

      <InfoNote text={`Confirming books the seat${r.cargo ? ' and scooter' : ''} together. ${first} gets your exact pickup instructions right away.`} />
    </Screen>
  );
}

function Seat({ label, sub, tone }: { label: string; sub?: string; tone: 'dark' | 'empty' | 'booked' | 'new' }) {
  const bg = tone === 'dark' ? colors.maroon : tone === 'empty' ? colors.background : colors.blush;
  const border = tone === 'booked' || tone === 'new' ? colors.chili : 'transparent';
  return (
    <View style={[styles.seat, { backgroundColor: bg, borderColor: border, borderWidth: tone === 'new' ? 2 : tone === 'booked' ? 1 : 0 }]}>
      <Text style={{ fontSize: 13, fontWeight: tone === 'empty' ? '600' : '700', color: tone === 'dark' ? colors.onDark : tone === 'empty' ? colors.textMuted : colors.maroon }}>
        {label}
      </Text>
      {sub ? <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textSecondary }}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  car: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, padding: space.md, borderRadius: radius.xl, borderWidth: 2, borderColor: colors.border },
  seat: { width: '48%', flexGrow: 1, height: 56, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  meter: { height: 12, borderRadius: radius.pill, backgroundColor: colors.border, overflow: 'hidden', flexDirection: 'row' },
  checkbox: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', padding: space.md, borderRadius: radius.md, backgroundColor: colors.background },
  box: { width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  boxOn: { backgroundColor: colors.chili, borderColor: colors.chili },
});
