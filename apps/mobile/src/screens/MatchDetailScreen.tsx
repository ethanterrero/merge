import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, space, type } from '../theme';
import { useNav } from '../navigation';
import { findMatch } from '../data/mock';
import { useCommute } from '../state/commute';
import { IconButton, Screen, TopBar } from '../components/Screen';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Avatar, Card, InfoNote, Stat, VerifiedRow } from '../components/primitives';
import { BlockReportMenu, UnblockSheet, useCanBlockOrReport } from '../components/BlockReportMenu';
import { useBlockedIds } from '../lib/data/blocks';

export function MatchDetailScreen({ matchId }: { matchId: string }) {
  const nav = useNav();
  const { commute } = useCommute();
  const m = findMatch(matchId);
  const first = m.name.split(' ')[0];
  const isDriver = m.role === 'driver';
  const cargoOk = !commute.bringsCargo || !!m.vehicle?.cargoFits;
  const insets = useSafeAreaInsets();
  const blocked = useBlockedIds();
  const [menuOpen, setMenuOpen] = useState(false);
  // Hidden in connected mode until M-42 gives Match detail real profile ids.
  const canBlockOrReport = useCanBlockOrReport(m.id);

  if (blocked.isBlocked(m.id)) return <BlockedMatch personId={m.id} />;

  return (
    <Screen
      statusBar="light"
      header={
        <View style={styles.header}>
          <View style={{ paddingTop: insets.top }}>
            <View style={styles.headerBar}>
              <IconButton icon="chevron-back" label="Back to discover" color={colors.onDark} onPress={nav.back} />
              {canBlockOrReport ? (
                <IconButton icon="ellipsis-vertical" label="Block or report" color={colors.onDark} onPress={() => setMenuOpen(true)} />
              ) : null}
            </View>
            <View style={styles.identity}>
              <View style={styles.avatarRing}>
                <Avatar initials={m.initials} size={58} />
              </View>
              <View style={{ gap: 2, flex: 1 }}>
                <Text style={[type.title, { color: colors.onDark, fontSize: 24 }]} accessibilityRole="header">
                  {m.name}
                </Text>
                <Text style={[type.small, { color: colors.onDarkMuted }]}>
                  {isDriver ? 'Driver' : 'Passenger'} · Alameda → Financial District
                </Text>
              </View>
            </View>
          </View>
        </View>
      }
      footer={
        <>
          <InfoNote text={isDriver ? `Requesting doesn't book a seat yet. Your ride is confirmed once ${first} accepts.` : `${first} is looking for a ride. Invite them once you're driving this route.`} />
          <Button label={isDriver ? 'Request a ride' : `Invite ${first}`} onPress={() => nav.push({ name: 'request', matchId: m.id })} disabled={!isDriver} />
        </>
      }
    >
      <Card raised style={{ padding: space.lg, gap: space.md }}>
        <View style={styles.statRow}>
          <Stat value={m.stats.rides} label={isDriver ? 'Rides given' : 'Rides taken'} />
          <Stat value={m.stats.onTime} label="On time" />
          <Stat value={m.stats.memberSince} label="Member since" />
        </View>
        <View style={{ gap: space.sm }}>
          <VerifiedRow label="Government ID verified" />
          <VerifiedRow label="Work email verified · [employer domain]" />
          {isDriver ? <VerifiedRow label="Vehicle and license verified" /> : null}
        </View>
      </Card>

      {m.vehicle ? (
        <Card style={{ padding: space.lg, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={styles.iconCircle}>
              <Icon name="car" size={20} color={colors.ember} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={type.subheading}>{m.vehicle.description}</Text>
              <Text style={[type.small, { color: colors.textMuted }]}>
                {m.seatsOpen} of {m.vehicle.seats} seats open · {m.ridePrefs.join(' · ').toLowerCase()}
              </Text>
            </View>
          </View>
          {commute.bringsCargo ? (
            <View style={[styles.cargo, { backgroundColor: cargoOk ? colors.successBg : colors.blush }]}>
              <Icon name={cargoOk ? 'checkmark-circle' : 'alert-circle'} size={18} color={cargoOk ? colors.successText : colors.ember} />
              <Text style={[type.small, { fontWeight: '600', color: colors.textPrimary, flex: 1 }]}>
                {cargoOk ? 'Trunk fits your medium foldable scooter' : "This car doesn't list room for your scooter"}
              </Text>
            </View>
          ) : null}
        </Card>
      ) : null}

      <Card style={{ padding: space.lg }}>
        <View style={styles.statRow}>
          {m.detourMinutes ? <Stat value={`${m.detourMinutes} min`} label={`Detour for ${first}`} /> : null}
          <Stat value={m.departs} label={m.departsNote} />
          <Stat value={m.sharedDays.length === 4 ? 'Mon–Thu' : `${m.sharedDays.length} days`} label="Shared days" />
        </View>
      </Card>

      <BlockReportMenu visible={menuOpen && canBlockOrReport} onClose={() => setMenuOpen(false)} personId={m.id} firstName={first} />
    </Screen>
  );
}

/** Neutral state for someone the member blocked: no name, profile or actions, only Unblock. */
function BlockedMatch({ personId }: { personId: string }) {
  const nav = useNav();
  const [unblockOpen, setUnblockOpen] = useState(false);
  return (
    <Screen header={<TopBar />}>
      <Card style={{ padding: space.lg, gap: space.md }}>
        <View style={styles.iconCircle}>
          <Icon name="ban" size={20} color={colors.accent} />
        </View>
        <Text style={type.heading} accessibilityRole="header">
          You blocked this person
        </Text>
        <Text style={[type.body, { color: colors.textSecondary }]}>{"They weren't told. You won't see each other in Merge."}</Text>
        <Button label="Unblock" variant="secondary" onPress={() => setUnblockOpen(true)} />
        <Button label="Blocked people" variant="tinted" size="md" onPress={() => nav.push({ name: 'blockedPeople' })} />
      </Card>
      <UnblockSheet visible={unblockOpen} onClose={() => setUnblockOpen(false)} personId={personId} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.maroon, paddingBottom: 18 },
  headerBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.sm },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: space.xl },
  avatarRing: { borderWidth: 3, borderColor: colors.onDark, borderRadius: 34, padding: 0 },
  statRow: { flexDirection: 'row', gap: space.sm },
  iconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.blush, alignItems: 'center', justifyContent: 'center' },
  cargo: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md },
});
