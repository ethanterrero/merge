import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors, radius, shadow, space, type } from '../theme';
import { useNav } from '../navigation';
import { useCommute } from '../state/commute';
import { useFirstRide } from '../state/firstRide';
import { MATCHES, PROTOTYPE_RIDE_DATE } from '../data/mock';
import { MOCK_TRIPS_TODAY, PAST_RIDES, RIDING_RIDES, mockTripsSession } from '../data/mockTrips';
import { useBlockedIds, useBlockedPeople } from '../lib/data/blocks';
import type { QueryState } from '../lib/data/types';
import { formatRideDate } from '../lib/dates';
import { rideDateLine } from '../lib/rideKind';
import {
  bookedRides,
  canWithdraw,
  declineQuestion,
  defaultSegment,
  emptyState,
  firstName,
  fromItems,
  fromToday,
  gateOnBlocks,
  inviteLabel,
  isSegmentEmpty,
  keepUnblockedPerson,
  needsReplyCount,
  onSides,
  pastRoleLine,
  replyByLabel,
  rideLabel,
  rideSide,
  rideStatusCopy,
  segmentLabel,
  sentItemLabel,
  sentSide,
  sentStatusCopy,
  sentTitle,
  showSection,
  sidesFor,
  splitRides,
  withdrawLabel,
  withdrawQuestion,
  type BookingEntry,
  type ReceivedInvite,
  type SentItem,
  type TripRide,
  type TripsSegment,
} from '../lib/trips';
import { TabBar } from '../components/TabBar';
import { Icon } from '../components/Icon';
import { Button } from '../components/Button';
import { Avatar, Card, Segmented } from '../components/primitives';
import {
  DriverRequestsSection,
  DriverUpcomingSection,
  DrivingSeatsPill,
  TripsSectionStatus,
  TripsSectionTitle,
  useDrivingDays,
  useDrivingRequests,
} from './DriverRequestsScreen';

// The role-aware Trips tab (M-23 spec, docs/superpowers/specs/2026-10-10-trips-tab-design.md).
// Every role gets Requests / Upcoming / Past; sections show when they have something.
// M-35 wires "Invites for you" and "Waiting for a reply" (lib/data/invitations.ts);
// M-47 wires Riding and Past (lib/data/rides.ts). The driving sections live in
// DriverRequestsScreen.tsx (M-36, M-47).

const TODAY = MOCK_TRIPS_TODAY;

/** Pending driver invites to me, minus anyone I blocked. */
function useInvitesForMe(): QueryState<ReceivedInvite[]> {
  const { commute } = useCommute();
  const blocked = useBlockedIds();
  const session = useSyncExternalStore(mockTripsSession.subscribe, mockTripsSession.getSnapshot, mockTripsSession.getSnapshot);
  return useMemo(() => {
    const items = sidesFor(commute.role).riding ? fromToday(session.invites, TODAY) : [];
    return gateOnBlocks(fromItems(items), blocked, keepUnblockedPerson);
  }, [commute.role, session, blocked]);
}

/** My requests and invites waiting on others, and invites I accepted. */
function useWaiting(): QueryState<SentItem[]> {
  const { commute } = useCommute();
  const blocked = useBlockedIds();
  const session = useSyncExternalStore(mockTripsSession.subscribe, mockTripsSession.getSnapshot, mockTripsSession.getSnapshot);
  return useMemo(
    () => gateOnBlocks(fromItems(fromToday(onSides(session.sent, commute.role, sentSide), TODAY)), blocked, keepUnblockedPerson),
    [commute.role, session, blocked],
  );
}

/** Riding (upcoming) and Past, including rides booked in this session (M-20 state). */
function useRides(): { riding: QueryState<TripRide[]>; past: QueryState<TripRide[]> } {
  const { commute } = useCommute();
  const blocked = useBlockedIds();
  const { latestRide } = useFirstRide();
  const entries: BookingEntry[] = MATCHES.flatMap((match) => {
    const ride = latestRide(match.id);
    return ride ? [{ match, ride: { id: ride.id, status: ride.status } }] : [];
  });
  const key = entries.map((e) => `${e.ride.id}:${e.ride.status}`).join(',');
  return useMemo(() => {
    const booked = sidesFor(commute.role).riding ? bookedRides(entries, PROTOTYPE_RIDE_DATE) : [];
    const { upcoming, past } = splitRides([...onSides([...RIDING_RIDES, ...PAST_RIDES], commute.role, rideSide), ...booked], TODAY);
    return {
      riding: gateOnBlocks(fromItems(upcoming.filter((r) => r.myRole === 'passenger')), blocked, keepUnblockedPerson),
      past: gateOnBlocks(fromItems(past), blocked, keepUnblockedPerson),
    };
    // `entries` is rebuilt each render; `key` captures what matters in it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commute.role, key, blocked]);
}

export function TripsScreen({ initialTab }: { initialTab?: TripsSegment }) {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const { commute } = useCommute();
  const role = commute.role;
  const blocked = useBlockedIds();
  const { refetch: retryBlocks } = useBlockedPeople();

  const incoming = useDrivingRequests();
  const days = useDrivingDays();
  const invites = useInvitesForMe();
  const waiting = useWaiting();
  const { riding, past } = useRides();
  const count = needsReplyCount(incoming, invites);

  // Pick the default segment once the block list has settled, then keep it, so the
  // view doesn't jump when the last request is answered.
  const [chosen, setChosen] = useState<TripsSegment | undefined>(initialTab);
  const settled = blocked.status === 'ready' || blocked.status === 'error';
  useEffect(() => {
    if (chosen === undefined && settled) setChosen(defaultSegment(count));
  }, [chosen, settled, count]);
  const segment = chosen ?? defaultSegment(count);

  const [confirming, setConfirming] = useState<string | null>(null);
  const openDiscover = () => nav.reset({ name: 'discover' });

  const sections: Record<TripsSegment, QueryState<unknown[]>[]> = {
    requests: [incoming, invites, waiting],
    upcoming: [days, riding],
    past: [past],
  };
  const empty = isSegmentEmpty(sections[segment]) ? emptyState(segment, role) : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View style={{ paddingTop: insets.top + space.lg, paddingHorizontal: space.xl, gap: 14, paddingBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
            <Text style={type.title} accessibilityRole="header">
              Trips
            </Text>
            {sidesFor(role).driving ? <DrivingSeatsPill days={days} /> : null}
          </View>
          <Segmented<TripsSegment>
            value={segment}
            onChange={(next) => {
              setConfirming(null);
              setChosen(next);
            }}
            options={[
              { value: 'requests', label: segmentLabel(count) },
              { value: 'upcoming', label: 'Upcoming' },
              { value: 'past', label: 'Past' },
            ]}
          />
        </View>
      </View>

      <ScrollView key={segment} contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        {segment === 'requests' ? (
          <>
            <DriverRequestsSection state={incoming} onRetry={retryBlocks} />
            <InvitesSection state={invites} onRetry={retryBlocks} confirming={confirming} setConfirming={setConfirming} />
            <WaitingSection state={waiting} onRetry={retryBlocks} confirming={confirming} setConfirming={setConfirming} onDiscover={openDiscover} />
          </>
        ) : null}
        {segment === 'upcoming' ? (
          <>
            <DriverUpcomingSection state={days} onRetry={retryBlocks} />
            <RidingSection state={riding} onRetry={retryBlocks} onDiscover={openDiscover} />
          </>
        ) : null}
        {segment === 'past' ? <PastSection state={past} onRetry={retryBlocks} /> : null}
        {empty ? <EmptyState text={empty.text} action={empty.action} onAction={openDiscover} /> : null}
      </ScrollView>
      <TabBar active="trips" />
    </View>
  );
}

type ConfirmProps = { confirming: string | null; setConfirming: (key: string | null) => void };

function InvitesSection({ state, onRetry, confirming, setConfirming }: { state: QueryState<ReceivedInvite[]>; onRetry: () => void } & ConfirmProps) {
  if (!showSection(state)) return null;
  return (
    <View style={{ gap: space.md }}>
      <TripsSectionTitle>Invites for you</TripsSectionTitle>
      <TripsSectionStatus state={state} onRetry={onRetry} />
      {state.status === 'success'
        ? state.data.map((invite) => {
            const key = `decline:${invite.id}`;
            const first = firstName(invite.person.name);
            return (
              <Card key={invite.id} style={{ padding: space.lg, gap: space.md }}>
                <View accessible accessibilityLabel={inviteLabel(invite)} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <Avatar initials={invite.person.initials} variant="soft" />
                  <View style={{ flex: 1 }}>
                    <Text style={type.subheading}>{invite.person.name} invited you to ride</Text>
                    <Text style={[type.small, { color: colors.textMuted }]}>{rideDateLine(invite.rideDate, invite.kind)}</Text>
                    <Text style={[type.small, { color: colors.textMuted }]}>
                      Pickup {invite.pickupTime} · {invite.pickupArea}
                    </Text>
                    <Text style={[type.small, { color: colors.textSecondary, fontWeight: '600' }]}>
                      Reply by {replyByLabel(invite.rideDate, 'short')}
                    </Text>
                  </View>
                </View>
                {confirming === key ? (
                  <InlineConfirm
                    question={declineQuestion(invite)}
                    keepLabel="Keep invite"
                    confirmLabel="Decline"
                    onKeep={() => setConfirming(null)}
                    onConfirm={() => {
                      setConfirming(null);
                      mockTripsSession.declineInvite(invite.id);
                      AccessibilityInfo.announceForAccessibility('Invite declined');
                    }}
                  />
                ) : (
                  <View style={{ flexDirection: 'row', gap: space.sm }}>
                    <Button
                      label="Accept"
                      size="sm"
                      style={{ flex: 1, height: 44 }}
                      accessibilityHint={`Accepts ${first}'s invite for ${formatRideDate(invite.rideDate)}. ${first} then confirms your seat.`}
                      onPress={() => {
                        setConfirming(null);
                        mockTripsSession.acceptInvite(invite.id);
                        AccessibilityInfo.announceForAccessibility('Invite accepted');
                      }}
                    />
                    <Button
                      label="Decline"
                      variant="secondary"
                      size="sm"
                      style={{ flex: 1, height: 44 }}
                      accessibilityHint={`Asks before declining ${first}'s invite`}
                      onPress={() => setConfirming(key)}
                    />
                  </View>
                )}
              </Card>
            );
          })
        : null}
    </View>
  );
}

function WaitingSection({
  state,
  onRetry,
  confirming,
  setConfirming,
  onDiscover,
}: { state: QueryState<SentItem[]>; onRetry: () => void; onDiscover: () => void } & ConfirmProps) {
  if (!showSection(state)) return null;
  return (
    <View style={{ gap: space.md }}>
      <TripsSectionTitle>Waiting for a reply</TripsSectionTitle>
      <TripsSectionStatus state={state} onRetry={onRetry} />
      {state.status === 'success'
        ? state.data.map((item) => {
            const key = `withdraw:${item.id}`;
            return (
              <Card key={item.id} style={{ padding: space.lg, gap: space.md }}>
                <View accessible accessibilityLabel={sentItemLabel(item)} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <Avatar initials={item.person.initials} variant={item.status === 'unavailable' ? 'outline' : 'soft'} />
                  <View style={{ flex: 1 }}>
                    <Text style={type.subheading}>{sentTitle(item)}</Text>
                    <Text style={[type.small, { color: colors.textMuted }]}>{rideDateLine(item.rideDate, item.kind)}</Text>
                    <Text style={[type.small, { color: item.status === 'unavailable' ? colors.textPrimary : colors.textSecondary, fontWeight: '600' }]}>
                      {sentStatusCopy(item)}
                    </Text>
                  </View>
                </View>
                {confirming === key ? (
                  <InlineConfirm
                    question={withdrawQuestion(item)}
                    keepLabel={item.type === 'request' ? 'Keep request' : 'Keep invite'}
                    confirmLabel="Withdraw"
                    onKeep={() => setConfirming(null)}
                    onConfirm={() => {
                      setConfirming(null);
                      mockTripsSession.withdraw(item.id);
                      AccessibilityInfo.announceForAccessibility(item.type === 'request' ? 'Request withdrawn' : 'Invite withdrawn');
                    }}
                  />
                ) : canWithdraw(item) ? (
                  <Button
                    label={withdrawLabel(item)}
                    variant="destructive"
                    size="sm"
                    style={{ height: 44 }}
                    accessibilityHint={`Asks before withdrawing your ${item.type} to ${item.person.name} for ${formatRideDate(item.rideDate)}`}
                    onPress={() => setConfirming(key)}
                  />
                ) : item.status === 'unavailable' ? (
                  <Button label="Find another ride" variant="tinted" size="sm" style={{ height: 44 }} onPress={onDiscover} accessibilityHint="Opens Discover" />
                ) : null}
              </Card>
            );
          })
        : null}
    </View>
  );
}

function RidingSection({ state, onRetry, onDiscover }: { state: QueryState<TripRide[]>; onRetry: () => void; onDiscover: () => void }) {
  const nav = useNav();
  if (!showSection(state)) return null;
  return (
    <View style={{ gap: space.md }}>
      <TripsSectionTitle>Riding</TripsSectionTitle>
      <TripsSectionStatus state={state} onRetry={onRetry} />
      {state.status === 'success'
        ? state.data.map((ride) => {
            const matchId = ride.matchId;
            if (ride.status === 'confirmed' && matchId) {
              return (
                <Pressable
                  key={ride.id}
                  accessibilityRole="button"
                  accessibilityLabel={rideLabel(ride, 'upcoming')}
                  accessibilityHint="Opens pickup details"
                  onPress={() => nav.push({ name: 'booked', matchId })}
                  style={({ pressed }) => [styles.rowCard, pressed && { opacity: 0.85 }]}
                >
                  <RideRow ride={ride} trailing={<Icon name="chevron-forward" size={20} color={colors.textFaint} />} />
                </Pressable>
              );
            }
            return (
              <Card key={ride.id} style={{ padding: space.lg, gap: space.md }}>
                <View accessible accessibilityLabel={rideLabel(ride, 'upcoming')}>
                  <RideRow ride={ride} />
                </View>
                {ride.status === 'cancelled' ? (
                  <Button label="Find another ride" variant="tinted" size="sm" style={{ height: 44 }} onPress={onDiscover} accessibilityHint="Opens Discover" />
                ) : null}
              </Card>
            );
          })
        : null}
    </View>
  );
}

function PastSection({ state, onRetry }: { state: QueryState<TripRide[]>; onRetry: () => void }) {
  if (!showSection(state)) return null;
  return (
    <View style={{ gap: space.md }}>
      <TripsSectionTitle>Past rides</TripsSectionTitle>
      <TripsSectionStatus state={state} onRetry={onRetry} />
      {state.status === 'success'
        ? state.data.map((ride) => (
            <Card key={ride.id} style={{ padding: space.lg }}>
              <View accessible accessibilityLabel={rideLabel(ride, 'past')}>
                <RideRow ride={ride} lead={pastRoleLine(ride)} />
              </View>
            </Card>
          ))
        : null}
    </View>
  );
}

function RideRow({ ride, lead, trailing }: { ride: TripRide; lead?: string; trailing?: React.ReactNode }) {
  const cancelled = ride.status === 'cancelled';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <Avatar initials={ride.person.initials} variant={cancelled ? 'outline' : 'soft'} />
      <View style={{ flex: 1 }}>
        <Text style={type.subheading}>{lead ? `${lead} with ${ride.person.name}` : ride.person.name}</Text>
        <Text style={[type.small, { color: colors.textMuted }]}>{rideDateLine(ride.rideDate, ride.kind)}</Text>
        <Text style={[type.small, { color: cancelled ? colors.textPrimary : colors.textSecondary, fontWeight: '600' }]}>{rideStatusCopy(ride)}</Text>
      </View>
      {trailing}
    </View>
  );
}

function InlineConfirm({
  question,
  keepLabel,
  confirmLabel,
  onKeep,
  onConfirm,
}: {
  question: string;
  keepLabel: string;
  confirmLabel: string;
  onKeep: () => void;
  onConfirm: () => void;
}) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.confirm}>
      <Text style={[type.small, { color: colors.textPrimary, fontWeight: '600' }]}>{question}</Text>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button label={keepLabel} variant="secondary" size="sm" style={{ flex: 1, height: 44 }} onPress={onKeep} />
        <Button label={confirmLabel} variant="destructive" size="sm" style={{ flex: 1, height: 44 }} onPress={onConfirm} />
      </View>
    </View>
  );
}

function EmptyState({ text, action, onAction }: { text: string; action: string | null; onAction: () => void }) {
  return (
    <View style={{ gap: space.md, paddingHorizontal: 4, paddingTop: space.sm }}>
      <Text style={[type.body, { color: colors.textMuted }]}>{text}</Text>
      {action ? <Button label={action} variant="tinted" size="sm" style={{ alignSelf: 'flex-start', height: 44 }} onPress={onAction} accessibilityHint="Opens Discover" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowCard: { padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadow.sm },
  confirm: { gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.background },
});
