import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors, radius, shadow, space, type } from '../theme';
import { useNav } from '../navigation';
import { useCommute } from '../state/commute';
import { REQUESTS, RideRequest } from '../data/mock';
import { TabBar } from '../components/TabBar';
import { Icon } from '../components/Icon';
import { Button } from '../components/Button';
import { Avatar, Badge, Card, Eyebrow, Segmented, Stat } from '../components/primitives';

type Tab = 'new' | 'upcoming';

/** Driver home: incoming requests and upcoming trips (designs D1 and D4). */
export function DriverRequestsScreen({ initialTab = 'new' }: { initialTab?: Tab }) {
  const nav = useNav();
  const { commute } = useCommute();
  const [tab, setTab] = useState<Tab>(initialTab);
  const pending = REQUESTS.filter((r) => !commute.acceptedRequests.includes(r.id));
  const accepted = REQUESTS.filter((r) => commute.acceptedRequests.includes(r.id));
  const insets = useSafeAreaInsets();
  const seatsOpen = Math.max(0, commute.seatsOffered - 1 - accepted.reduce((n, r) => n + r.seats, 0));

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View style={{ paddingTop: insets.top + space.lg, paddingHorizontal: space.xl, gap: 14, paddingBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
            <Text style={type.title} accessibilityRole="header">
              Trips
            </Text>
            <View style={styles.drivingPill}>
              <Icon name="car" size={14} color={colors.ember} />
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.maroon }}>
                Driving · {seatsOpen} of {commute.seatsOffered} seats open
              </Text>
            </View>
          </View>
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'new', label: `New · ${pending.length}` },
              { value: 'upcoming', label: 'Upcoming' },
            ]}
          />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
        {tab === 'new' ? (
          <>
            {pending.map((r, i) => (
              <RequestCard key={r.id} request={r} highlighted={i === 0} onPress={() => nav.push({ name: 'driverRequest', requestId: r.id })} />
            ))}
            {pending.length === 0 ? <Text style={[type.body, { color: colors.textMuted }]}>No new requests. You'll get a notification when someone asks to ride.</Text> : null}
            <Text style={[type.small, { color: colors.textMuted, paddingHorizontal: 4 }]}>
              Requests expire if you don't reply. Riders only see your approximate area until you accept.
            </Text>
          </>
        ) : (
          <Upcoming accepted={accepted} />
        )}
      </ScrollView>
      <TabBar active="trips" />
    </View>
  );
}

function RequestCard({ request: r, highlighted, onPress }: { request: RideRequest; highlighted: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Review this request"
      onPress={onPress}
      style={({ pressed }) => [styles.card, highlighted ? styles.cardOn : styles.cardOff, pressed && { opacity: 0.85 }]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Avatar initials={r.initials} variant={highlighted ? 'solid' : 'soft'} />
        <View style={{ flex: 1 }}>
          <Text style={type.subheading}>
            {r.name}
            {r.verified ? <Text style={{ fontSize: 12, fontWeight: '600', color: colors.successText }}> · Verified</Text> : null}
          </Text>
          <Text style={[type.small, { color: colors.textMuted }]}>Wants to ride {r.days}</Text>
        </View>
        <Badge label={`Reply by ${r.replyBy}`} tone={highlighted ? 'brand' : 'neutral'} />
      </View>
      <View style={styles.stats}>
        <Stat value={r.addedDetour} label="Added detour" />
        <Stat value={r.pickupTime} label="Pickup" />
        <Stat value={r.cargo ? `${r.seats} + cargo` : `${r.seats}`} label={r.cargo ? 'Seat, scooter' : 'Seat'} />
      </View>
    </Pressable>
  );
}

function Upcoming({ accepted }: { accepted: RideRequest[] }) {
  return (
    <>
      {accepted.length ? (
        <View style={styles.success}>
          <Icon name="checkmark-circle" size={20} color={colors.successText} />
          <Text style={[type.small, { fontWeight: '600', color: colors.maroon, flex: 1 }]}>
            {accepted.map((a) => a.name.split(' ')[0]).join(' and ')} booked. Pickup details were shared.
          </Text>
        </View>
      ) : null}
      <Eyebrow>Mon, Oct 12</Eyebrow>
      <Card raised style={{ padding: space.lg, gap: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <Text style={type.heading}>Leave 7:35 AM</Text>
          <Text style={[type.small, { color: colors.textMuted }]}>Arrive ~[time]</Text>
        </View>
        <Rider initials="SR" name="Sam R. · 7:38 AM" spot="[Pickup spot]" />
        {accepted.map((a) => (
          <Rider key={a.id} initials={a.initials} name={`${a.name} · ${a.pickupTime} AM`} spot={a.cargo ? `${a.pickupSpot} · scooter in trunk` : a.pickupSpot} highlight />
        ))}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button label="Message riders" variant="secondary" size="sm" style={{ flex: 1, height: 44 }} />
          <Button label="Can't drive" variant="destructive" size="sm" style={{ flex: 1, height: 44 }} accessibilityHint="Tells riders right away" />
        </View>
      </Card>
      <Eyebrow>Tue, Oct 13</Eyebrow>
      <Card style={{ padding: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Text style={type.subheading}>Leave 7:35 AM</Text>
          <Text style={[type.small, { color: colors.textMuted }]}>{1 + accepted.length} riders</Text>
        </View>
        <Icon name="chevron-forward" size={20} color={colors.textFaint} />
      </Card>
      <Text style={[type.small, { color: colors.textMuted, paddingHorizontal: 4 }]}>
        If you mark a day as "can't drive," riders are notified right away and see other drivers for that day.
      </Text>
    </>
  );
}

function Rider({ initials, name, spot, highlight }: { initials: string; name: string; spot: string; highlight?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Avatar initials={initials} size={32} variant={highlight ? 'solid' : 'soft'} />
      <View style={{ flex: 1 }}>
        <Text style={[type.small, { fontWeight: '700', color: colors.textPrimary }]}>{name}</Text>
        <Text style={[type.caption, { color: colors.textMuted }]}>{spot}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  drivingPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.blush },
  card: { padding: space.lg, borderRadius: radius.lg, gap: space.md, backgroundColor: colors.surface, ...shadow.sm },
  cardOn: { borderWidth: 2, borderColor: colors.chili },
  cardOff: { borderWidth: 1, borderColor: colors.border },
  stats: { flexDirection: 'row', gap: space.sm, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.border },
  success: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.successBg },
});
