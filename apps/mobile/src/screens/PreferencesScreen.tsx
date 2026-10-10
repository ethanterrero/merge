import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { colors, space, type } from '../theme';
import { useNav } from '../navigation';
import { RidePref, toggleIn, useCommute } from '../state/commute';
import { Screen, StepProgress } from '../components/Screen';
import { Button } from '../components/Button';
import { Card, Chip, Eyebrow, SettingRow, Stepper, Toggle } from '../components/primitives';
import { Icon } from '../components/Icon';
import { maxSeatsOffered, vehicleSummary } from '../lib/vehicleRules';

const PREFS: RidePref[] = ['Quiet ride', 'Smoke-free', 'Women-only'];

export function PreferencesScreen() {
  const nav = useNav();
  const { commute, update } = useCommute();
  const drives = commute.role !== 'passenger';
  const rides = commute.role !== 'driver';
  const finish = () => nav.reset({ name: 'discover' });
  const vehicle = commute.vehicle;
  const seatsMax = maxSeatsOffered(vehicle);
  const vehicleDescription = vehicle
    ? `${vehicleSummary(vehicle)}${vehicle.acceptsFoldableScooters ? ' · Fits a folded scooter' : ''}`
    : 'Add make, model, seats and plate';

  return (
    <Screen
      header={
        <StepProgress
          step={2}
          total={2}
          label="Optional"
          right={
            <Pressable accessibilityRole="button" onPress={finish} hitSlop={8} style={{ height: 44, justifyContent: 'center', paddingHorizontal: 8 }}>
              <Text style={{ color: colors.ember, fontWeight: '700', fontSize: 15 }}>Skip</Text>
            </Pressable>
          }
        />
      }
      footer={<Button label="Find matches" onPress={finish} />}
      contentStyle={{ gap: space.lg }}
    >
      <View style={{ gap: 4 }}>
        <Text style={type.title} accessibilityRole="header">
          A few preferences
        </Text>
        <Text style={[type.body, { color: colors.textMuted }]}>Change these anytime in your profile.</Text>
      </View>

      {drives ? (
        <View style={{ gap: space.sm }}>
          <Eyebrow>When you drive</Eyebrow>
          <Card>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={vehicle ? `Vehicle, ${vehicleDescription}` : 'Vehicle, not added yet'}
              accessibilityHint="Opens the vehicle form"
              onPress={() => nav.push({ name: 'vehicle' })}
              style={({ pressed }) => (pressed ? { backgroundColor: colors.background } : null)}
            >
              <SettingRow title="Vehicle" description={vehicleDescription} trailing={<Icon name="chevron-forward" size={20} color={colors.textFaint} />} />
            </Pressable>
            <SettingRow
              divider
              title="Seats to offer"
              description={vehicle ? `Up to ${seatsMax}, the passenger seats in your car` : undefined}
              trailing={<Stepper label="seats" value={Math.min(commute.seatsOffered, seatsMax)} onChange={(seatsOffered) => update({ seatsOffered })} max={seatsMax} />}
            />
          </Card>
        </View>
      ) : null}

      {rides ? (
        <View style={{ gap: space.sm }}>
          <Eyebrow>When you ride</Eyebrow>
          <Card>
            <SettingRow
              title="I bring cargo"
              description="Foldable scooter · medium · [weight]"
              trailing={<Toggle label="I bring cargo" value={commute.bringsCargo} onValueChange={(bringsCargo) => update({ bringsCargo })} />}
            />
          </Card>
        </View>
      ) : null}

      <View style={{ gap: space.sm }}>
        <Eyebrow>Ride preferences</Eyebrow>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {PREFS.map((p) => (
            <Chip key={p} label={p} selected={commute.ridePrefs.includes(p)} onPress={() => update({ ridePrefs: toggleIn(commute.ridePrefs, p) })} />
          ))}
        </View>
      </View>

      <Card>
        <SettingRow
          title="Show me in discovery"
          description="Matching commuters see your first name and approximate areas."
          trailing={<Toggle label="Show me in discovery" value={commute.discoverable} onValueChange={(discoverable) => update({ discoverable })} />}
        />
      </Card>
    </Screen>
  );
}
