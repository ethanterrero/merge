import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, shadow, space, type } from '../theme';
import { useNav } from '../navigation';
import { toggleIn, useCommute } from '../state/commute';
import { WEEKDAYS } from '../data/mock';
import { Screen, StepProgress } from '../components/Screen';
import { Button } from '../components/Button';
import { BayMap, Zone } from '../components/BayMap';
import { Card, InfoNote, Row } from '../components/primitives';

const FLEX_OPTIONS = [5, 10, 15] as const;

export function CommuteScreen() {
  const nav = useNav();
  const { commute, update } = useCommute();

  const cycleFlex = () => {
    const i = FLEX_OPTIONS.indexOf(commute.flexMinutes);
    update({ flexMinutes: FLEX_OPTIONS[(i + 1) % FLEX_OPTIONS.length] });
  };

  return (
    <Screen
      header={<StepProgress step={1} total={2} label="Essentials" />}
      footer={<Button label="Next" disabled={commute.days.length === 0} onPress={() => nav.push({ name: 'preferences' })} />}
    >
      <Text style={type.title} accessibilityRole="header">
        Where and when
      </Text>

      <Card>
        <BayMap height={150}>
          <Zone x={300} y={74} size={76} dashed />
          <Zone x={62} y={62} size={64} tone="maroon" dashed />
          <Text style={[styles.mapTag, { left: 272, top: 116 }]}>Pickup</Text>
          <Text style={[styles.mapTag, { left: 30, top: 98 }]}>Drop-off</Text>
        </BayMap>
        <AreaRow color={colors.chili} round label="Pickup area · about 0.5 mi wide" value={commute.pickupArea} />
        <AreaRow color={colors.maroon} label="Drop-off area" value={commute.dropoffArea} divider />
        <Row style={{ backgroundColor: colors.background }}>
          <InfoNote icon="lock-closed" text="Others only see these areas. Your address stays private." />
        </Row>
      </Card>

      <View style={{ gap: space.sm }}>
        <Text style={type.subheading}>Days</Text>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {WEEKDAYS.map((d) => {
            const on = commute.days.includes(d);
            return (
              <Pressable
                key={d}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => update({ days: toggleIn(commute.days, d) })}
                style={[styles.day, on ? styles.dayOn : styles.dayOff]}
              >
                <Text style={[styles.dayText, { color: on ? colors.onDark : colors.textSecondary }]}>{d}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable accessibilityRole="button" accessibilityHint="Opens a time picker" style={[styles.tile, shadow.sm]}>
          <Text style={[type.caption, { color: colors.textMuted }]}>Leave around</Text>
          <Text style={type.stat}>{commute.departure}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityHint="Changes how flexible your departure is" onPress={cycleFlex} style={[styles.tile, shadow.sm]}>
          <Text style={[type.caption, { color: colors.textMuted }]}>Flexible by</Text>
          <Text style={type.stat}>±{commute.flexMinutes} min</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

function AreaRow({ color, label, value, round, divider }: { color: string; label: string; value: string; round?: boolean; divider?: boolean }) {
  return (
    <Row divider={divider}>
      <View style={{ width: 12, height: 12, borderRadius: round ? 6 : 3, borderWidth: round ? 3 : 0, borderColor: color, backgroundColor: round ? 'transparent' : color }} />
      <View style={{ flex: 1 }}>
        <Text style={[type.caption, { color: colors.textMuted }]}>{label}</Text>
        <Text style={type.subheading}>{value}</Text>
      </View>
      <Button label="Adjust" variant="tinted" size="sm" accessibilityHint={`Adjust ${label.toLowerCase()}`} />
    </Row>
  );
}

const styles = StyleSheet.create({
  mapTag: {
    position: 'absolute',
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
    fontSize: 11,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  day: { flex: 1, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  dayOn: { backgroundColor: colors.chili },
  dayOff: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
  dayText: { fontSize: 14, fontWeight: '700' },
  tile: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: space.md, paddingHorizontal: 14, gap: 2 },
});
