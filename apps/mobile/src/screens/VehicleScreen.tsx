import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { colors, space, type } from '../theme';
import { useNav } from '../navigation';
import { useCommute } from '../state/commute';
import {
  COLOR_MAX,
  NAME_MAX,
  PASSENGER_SEATS_MAX,
  PASSENGER_SEATS_MIN,
  VehicleErrors,
  VehicleField,
  VehicleForm,
  clampSeatsOffered,
  validateVehicle,
  vehicleToForm,
} from '../lib/vehicleRules';
import { Screen, TopBar } from '../components/Screen';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { Card, Eyebrow, InfoNote, SettingRow, Stepper, Toggle } from '../components/primitives';

/**
 * The driver's car (M-21). Saves to the local commute draft only; saving to
 * Supabase comes with the onboarding wiring (M-34).
 */
export function VehicleScreen() {
  const nav = useNav();
  const { commute, update } = useCommute();
  const [form, setForm] = useState<VehicleForm>(() => vehicleToForm(commute.vehicle));
  const [errors, setErrors] = useState<VehicleErrors>({});

  const set = <K extends keyof VehicleForm>(key: K, value: VehicleForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (key in errors) setErrors((e) => ({ ...e, [key as VehicleField]: undefined }));
  };

  const save = () => {
    const result = validateVehicle(form, { currentYear: new Date().getFullYear() });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    const { vehicle } = result;
    update({
      vehicle,
      // The offer can't exceed the car's seats (commutes_check_seats).
      seatsOffered: clampSeatsOffered(commute.seatsOffered, vehicle),
      // Keeps the older draft flag in step with the vehicle's cargo answer.
      trunkSpace: vehicle.acceptsFoldableScooters,
    });
    nav.back();
  };

  const hasErrors = Object.values(errors).some(Boolean);

  return (
    <Screen
      header={<TopBar title="Your vehicle" />}
      footer={<Button label="Save vehicle" onPress={save} />}
      contentStyle={{ gap: space.lg }}
    >
      <View style={{ gap: 4 }}>
        <Text style={type.title} accessibilityRole="header">
          What do you drive?
        </Text>
        <Text style={[type.body, { color: colors.textMuted }]}>Riders use this to find your car at pickup.</Text>
      </View>

      <InfoNote tone="tinted" icon="lock-closed" text="Riders see your plate and car only after a ride is confirmed." />

      <View style={{ gap: space.md }}>
        <TextField
          label="Make"
          value={form.make}
          onChangeText={(text) => set('make', text)}
          error={errors.make}
          placeholder="Toyota"
          autoCapitalize="words"
          autoCorrect={false}
          maxLength={NAME_MAX}
          returnKeyType="next"
        />
        <TextField
          label="Model"
          value={form.model}
          onChangeText={(text) => set('model', text)}
          error={errors.model}
          placeholder="Prius"
          autoCapitalize="words"
          autoCorrect={false}
          maxLength={NAME_MAX}
          returnKeyType="next"
        />
        <TextField
          label="Year (optional)"
          value={form.year}
          onChangeText={(text) => set('year', text)}
          error={errors.year}
          placeholder="2019"
          keyboardType="number-pad"
          maxLength={4}
          returnKeyType="next"
        />
        <TextField
          label="Color (optional)"
          value={form.color}
          onChangeText={(text) => set('color', text)}
          error={errors.color}
          placeholder="Silver"
          autoCapitalize="words"
          maxLength={COLOR_MAX}
          returnKeyType="next"
        />
        <TextField
          label="License plate (optional)"
          value={form.plate}
          onChangeText={(text) => set('plate', text)}
          error={errors.plate}
          hint="Letters and numbers. We save it in capitals, without spaces or dashes."
          placeholder="8ABC123"
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          maxLength={12}
          returnKeyType="done"
        />
      </View>

      <View style={{ gap: space.sm }}>
        <Eyebrow>Seats and cargo</Eyebrow>
        <Card>
          <SettingRow
            title="Passenger seats"
            description="Seats for riders, not counting yours. You can't offer more than this."
            trailing={
              <Stepper
                label="passenger seats"
                value={form.passengerSeats}
                onChange={(n) => set('passengerSeats', n)}
                min={PASSENGER_SEATS_MIN}
                max={PASSENGER_SEATS_MAX}
              />
            }
          />
          <SettingRow
            divider
            title="Trunk fits a folded scooter"
            description="One scooter per rider, folded within 120 × 50 × 60 cm and 20 kg (44 lb). You approve each one when you confirm a ride."
            trailing={
              <Toggle
                label="Trunk fits a folded scooter"
                value={form.acceptsFoldableScooters}
                onValueChange={(v) => set('acceptsFoldableScooters', v)}
              />
            }
          />
        </Card>
      </View>

      {hasErrors ? (
        <Text accessibilityLiveRegion="polite" style={[type.small, { color: colors.danger }]}>
          Check the highlighted fields.
        </Text>
      ) : null}
    </Screen>
  );
}
