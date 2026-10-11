import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, shadow, space, type } from '../theme';
import { useNav } from '../navigation';
import { useCommute } from '../state/commute';
import { REQUESTS } from '../data/mock';
import { DRIVING_DAYS, MOCK_LEAVE_TIME, MOCK_TRIPS_TODAY } from '../data/mockTrips';
import { useBlockedIds } from '../lib/data/blocks';
import type { QueryState } from '../lib/data/types';
import { formatRideDate } from '../lib/dates';
import { rideDateLine } from '../lib/rideKind';
import {
  drivingDays,
  firstName,
  fromItems,
  gateOnBlocks,
  keepUnblockedPerson,
  keepUnblockedRiders,
  nextDrivingDay,
  replyByLabel,
  riderFromRequest,
  seatsPillLabel,
  showSection,
  sidesFor,
  toIncomingRequest,
  type DrivingDay,
  type DrivingRider,
  type IncomingRequest,
} from '../lib/trips';
import { Icon } from '../components/Icon';
import { Button } from '../components/Button';
import { Avatar, Badge, Card, Stat } from '../components/primitives';

// The driving side of the Trips tab (M-23 spec). TripsScreen renders these; the file
// keeps its name because the screen lock table keys on it. M-36 wires the requests
// and the seats pill (lib/data/inbox.ts), M-47 the driving days (lib/data/rides.ts).
// Keep the hook return types: TripsScreen counts and empty states depend on them.

/** Passengers' requests to me, minus the ones I accepted and anyone I blocked. */
export function useDrivingRequests(): QueryState<IncomingRequest[]> {
  const { commute } = useCommute();
  const blocked = useBlockedIds();
  return useMemo(() => {
    const items = sidesFor(commute.role).driving
      ? REQUESTS.filter((r) => !commute.acceptedRequests.includes(r.id)).map(toIncomingRequest)
      : [];
    return gateOnBlocks(fromItems(items), blocked, keepUnblockedPerson);
  }, [commute.role, commute.acceptedRequests, blocked]);
}

/** My driving days with their confirmed riders, minus anyone I blocked. */
export function useDrivingDays(): QueryState<DrivingDay[]> {
  const { commute } = useCommute();
  const blocked = useBlockedIds();
  return useMemo(() => {
    const accepted = REQUESTS.filter((r) => commute.acceptedRequests.includes(r.id)).map(riderFromRequest);
    const items = sidesFor(commute.role).driving
      ? drivingDays(DRIVING_DAYS, accepted, MOCK_LEAVE_TIME).filter((day) => day.date >= MOCK_TRIPS_TODAY)
      : [];
    return gateOnBlocks(fromItems(items), blocked, keepUnblockedRiders);
  }, [commute.role, commute.acceptedRequests, blocked]);
}

/** Header pill: seats open on my next driving day. */
export function DrivingSeatsPill({ days }: { days: QueryState<DrivingDay[]> }) {
  const { commute } = useCommute();
  const next = days.status === 'success' ? nextDrivingDay(days.data, MOCK_TRIPS_TODAY) : null;
  return (
    <View style={styles.drivingPill}>
      <Icon name="car" size={14} color={colors.accent} />
      <Text style={{ fontSize: 12, fontWeight: '700', color: colors.deep }}>{seatsPillLabel(next, commute.seatsOffered)}</Text>
    </View>
  );
}

/** A section heading in the Trips tab, read as a header. */
export function TripsSectionTitle({ children }: { children: string }) {
  return (
    <Text accessibilityRole="header" style={[type.eyebrow, { color: colors.textMuted, paddingHorizontal: 4, paddingTop: space.sm }]}>
      {children}
    </Text>
  );
}

/** Loading and error rows for a section. Renders nothing for other states. */
export function TripsSectionStatus({ state, onRetry }: { state: QueryState<unknown[]>; onRetry?: () => void }) {
  if (state.status === 'loading' || state.status === 'idle') {
    return <Text style={[type.small, { color: colors.textFaint, paddingHorizontal: 4 }]}>Loading…</Text>;
  }
  if (state.status === 'error') {
    return (
      <View style={{ gap: space.sm, paddingHorizontal: 4 }}>
        <Text accessibilityLiveRegion="polite" style={[type.small, { color: colors.danger }]}>
          {state.error.message}
        </Text>
        {onRetry ? <Button label="Retry" variant="secondary" size="sm" onPress={onRetry} style={{ alignSelf: 'flex-start', height: 44 }} /> : null}
      </View>
    );
  }
  return null;
}

/** Requests section: "Asking you for a ride". */
export function DriverRequestsSection({ state, onRetry }: { state: QueryState<IncomingRequest[]>; onRetry?: () => void }) {
  const nav = useNav();
  if (!showSection(state)) return null;
  return (
    <View style={{ gap: space.md }}>
      <TripsSectionTitle>Asking you for a ride</TripsSectionTitle>
      <TripsSectionStatus state={state} onRetry={onRetry} />
      {state.status === 'success' ? (
        <>
          {state.data.map((r, i) => (
            <RequestCard key={r.id} request={r} highlighted={i === 0} onPress={() => nav.push({ name: 'driverRequest', requestId: r.id })} />
          ))}
          <Text style={[type.small, { color: colors.textMuted, paddingHorizontal: 4 }]}>
            Requests expire if you don't reply. Riders only see your approximate area until you accept.
          </Text>
        </>
      ) : null}
    </View>
  );
}

function RequestCard({ request: r, highlighted, onPress }: { request: IncomingRequest; highlighted: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Review this request"
      onPress={onPress}
      style={({ pressed }) => [styles.card, highlighted ? styles.cardOn : styles.cardOff, pressed && { opacity: 0.85 }]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Avatar initials={r.person.initials} variant={highlighted ? 'solid' : 'soft'} />
        <View style={{ flex: 1 }}>
          <Text style={type.subheading}>
            {r.person.name}
            {r.person.verified ? <Text style={{ fontSize: 12, fontWeight: '600', color: colors.successText }}> · Verified</Text> : null}
          </Text>
          <Text style={[type.small, { color: colors.textMuted }]}>Wants to ride {rideDateLine(r.rideDate, r.kind)}</Text>
        </View>
        <Badge label={`Reply by ${replyByLabel(r.rideDate, 'short')}`} tone={highlighted ? 'brand' : 'neutral'} />
      </View>
      <View style={styles.stats}>
        <Stat value={r.addedDetour} label="Added detour" />
        <Stat value={r.pickupTime} label="Pickup" />
        <Stat value={r.cargo ? `${r.seats} + cargo` : `${r.seats}`} label={r.cargo ? 'Seat, scooter' : 'Seat'} />
      </View>
    </Pressable>
  );
}

/** Upcoming section: "Driving", one card per driving day. */
export function DriverUpcomingSection({ state, onRetry }: { state: QueryState<DrivingDay[]>; onRetry?: () => void }) {
  if (!showSection(state)) return null;
  const justBooked = state.status === 'success' ? state.data.flatMap((day) => day.riders.filter((r) => r.justBooked)) : [];
  return (
    <View style={{ gap: space.md }}>
      <TripsSectionTitle>Driving</TripsSectionTitle>
      <TripsSectionStatus state={state} onRetry={onRetry} />
      {justBooked.length ? (
        <View style={styles.success}>
          <Icon name="checkmark-circle" size={20} color={colors.successText} />
          <Text style={[type.small, { fontWeight: '600', color: colors.deep, flex: 1 }]}>
            {justBooked.map((r) => firstName(r.person.name)).join(' and ')} booked. Pickup details were shared.
          </Text>
        </View>
      ) : null}
      {state.status === 'success'
        ? state.data.map((day, i) => <DayCard key={day.date} day={day} raised={i === 0} />)
        : null}
      {state.status === 'success' ? (
        <Text style={[type.small, { color: colors.textMuted, paddingHorizontal: 4 }]}>
          If you mark a day as "can't drive," riders are notified right away and see other drivers for that day.
        </Text>
      ) : null}
    </View>
  );
}

function DayCard({ day, raised }: { day: DrivingDay; raised: boolean }) {
  return (
    <Card raised={raised} style={{ padding: space.lg, gap: space.md }}>
      <Text style={[type.eyebrow, { color: colors.textMuted }]}>{formatRideDate(day.date)}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: space.sm }}>
        <Text style={type.heading}>Leave {day.leaveTime}</Text>
        <Text style={[type.small, { color: colors.textMuted }]}>Arrive ~[time]</Text>
      </View>
      {day.riders.map((rider) => (
        <Rider key={rider.id} rider={rider} />
      ))}
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button label="Message riders" variant="secondary" size="sm" style={{ flex: 1, height: 44 }} />
        <Button label="Can't drive" variant="destructive" size="sm" style={{ flex: 1, height: 44 }} accessibilityHint="Tells riders right away" />
      </View>
    </Card>
  );
}

function Rider({ rider }: { rider: DrivingRider }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessible accessibilityLabel={`${rider.person.name}, pickup ${rider.pickupTime}, ${rider.spot}`}>
      <Avatar initials={rider.person.initials} size={32} variant={rider.justBooked ? 'solid' : 'soft'} />
      <View style={{ flex: 1 }}>
        <Text style={[type.small, { fontWeight: '700', color: colors.textPrimary }]}>
          {rider.person.name} · {rider.pickupTime}
        </Text>
        <Text style={[type.caption, { color: colors.textMuted }]}>{rider.spot}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  drivingPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.tint, flexShrink: 1 },
  card: { padding: space.lg, borderRadius: radius.lg, gap: space.md, backgroundColor: colors.surface, ...shadow.sm },
  cardOn: { borderWidth: 2, borderColor: colors.primary },
  cardOff: { borderWidth: 1, borderColor: colors.border },
  stats: { flexDirection: 'row', gap: space.sm, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.border },
  success: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.successBg },
});
