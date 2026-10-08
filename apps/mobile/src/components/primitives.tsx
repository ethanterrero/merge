import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View, ViewStyle } from 'react-native';
import { colors, radius, shadow, space, TOUCH, type } from '../theme';
import { Icon, IconName } from './Icon';

export function Card({ children, style, raised }: { children: React.ReactNode; style?: ViewStyle; raised?: boolean }) {
  return <View style={[styles.card, raised ? shadow.md : shadow.sm, style]}>{children}</View>;
}

/** A row inside a Card, with an optional divider above it. */
export function Row({ children, divider, style }: { children: React.ReactNode; divider?: boolean; style?: ViewStyle }) {
  return <View style={[styles.row, divider && styles.divider, style]}>{children}</View>;
}

export function Eyebrow({ children }: { children: string }) {
  return <Text style={styles.eyebrow}>{children}</Text>;
}

export function Avatar({
  initials,
  size = 44,
  variant = 'solid',
}: {
  initials: string;
  size?: number;
  variant?: 'solid' | 'outline' | 'soft' | 'dark';
}) {
  const bg = variant === 'solid' ? colors.chili : variant === 'dark' ? colors.maroon : variant === 'soft' ? colors.blush : colors.surface;
  const fg = variant === 'solid' || variant === 'dark' ? colors.onDark : variant === 'soft' ? colors.maroon : colors.ember;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        borderWidth: variant === 'outline' ? 2 : 0,
        borderColor: colors.chili,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: fg, fontWeight: '700', fontSize: size * 0.34 }}>{initials}</Text>
    </View>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'brand' }) {
  const bg = tone === 'success' ? colors.successBg : tone === 'brand' ? colors.blush : colors.background;
  const fg = tone === 'neutral' ? colors.textSecondary : colors.maroon;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

/** Selectable pill (ride preferences, filters). */
export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected ? styles.chipOn : styles.chipOff]}
    >
      <Text style={[styles.chipText, { color: selected ? colors.maroon : colors.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

export function Toggle({ value, onValueChange, label }: { value: boolean; onValueChange: (v: boolean) => void; label: string }) {
  return (
    <Switch
      accessibilityLabel={label}
      value={value}
      onValueChange={onValueChange}
      trackColor={{ false: colors.borderStrong, true: colors.chili }}
      thumbColor={colors.surface}
      ios_backgroundColor={colors.borderStrong}
    />
  );
}

/** Label + optional description + trailing control, the standard settings row. */
export function SettingRow({
  title,
  description,
  trailing,
  divider,
}: {
  title: string;
  description?: string;
  trailing: React.ReactNode;
  divider?: boolean;
}) {
  return (
    <Row divider={divider}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={type.subheading}>{title}</Text>
        {description ? <Text style={[type.small, { color: colors.textMuted }]}>{description}</Text> : null}
      </View>
      {trailing}
    </Row>
  );
}

export function CheckRow({ label, ok = true, size = 16 }: { label: string; ok?: boolean; size?: number }) {
  return (
    <View style={styles.checkRow}>
      <Icon name={ok ? 'checkmark-circle' : 'alert-circle'} size={size} color={ok ? colors.success : colors.textFaint} />
      <Text style={[type.small, { color: colors.textSecondary, flexShrink: 1 }]}>{label}</Text>
    </View>
  );
}

export function VerifiedRow({ label }: { label: string }) {
  return (
    <View style={styles.checkRow}>
      <Icon name="shield-checkmark" size={18} color={colors.success} />
      <Text style={[type.small, { color: colors.textPrimary, fontWeight: '600', flexShrink: 1 }]}>{label}</Text>
    </View>
  );
}

export function InfoNote({ text, icon = 'information-circle', tone = 'plain' }: { text: string; icon?: IconName; tone?: 'plain' | 'tinted' }) {
  return (
    <View style={[styles.note, tone === 'tinted' && styles.noteTinted]}>
      <Icon name={icon} size={16} color={tone === 'tinted' ? colors.maroon : colors.ember} />
      <Text style={[type.small, { color: tone === 'tinted' ? colors.maroon : colors.textSecondary, flex: 1 }]}>{text}</Text>
    </View>
  );
}

export function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={type.stat}>{value}</Text>
      <Text style={[type.caption, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

/** Pill-shaped segmented control. `dark` selection reads well over the map. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  tone = 'light',
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  tone?: 'light' | 'dark';
}) {
  return (
    <View style={[styles.segmented, tone === 'light' && { backgroundColor: colors.background, borderRadius: 10 }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[
              styles.segment,
              tone === 'dark' && { borderRadius: radius.pill, paddingHorizontal: 14, flex: 0 },
              on && (tone === 'dark' ? { backgroundColor: colors.maroon } : [{ backgroundColor: colors.surface }, shadow.sm]),
            ]}
          >
            <Text style={[styles.segmentText, { color: on && tone === 'dark' ? colors.onDark : on ? colors.textPrimary : colors.textSecondary }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Stepper({ value, onChange, min = 1, max = 6, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label: string }) {
  return (
    <View style={styles.stepper} accessibilityLabel={`${label}: ${value}`}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Fewer ${label}`} disabled={value <= min} onPress={() => onChange(value - 1)} style={styles.stepBtn}>
        <Icon name="remove" size={20} color={value <= min ? colors.textFaint : colors.textPrimary} />
      </Pressable>
      <Text style={[type.heading, { width: 24, textAlign: 'center' }]}>{value}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`More ${label}`} disabled={value >= max} onPress={() => onChange(value + 1)} style={styles.stepBtn}>
        <Icon name="add" size={20} color={value >= max ? colors.textFaint : colors.textPrimary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  eyebrow: { ...type.eyebrow, color: colors.textMuted },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  chip: { height: 40, paddingHorizontal: 14, borderRadius: radius.pill, justifyContent: 'center' },
  chipOn: { borderWidth: 2, borderColor: colors.chili, backgroundColor: colors.blush },
  chipOff: { borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  chipText: { fontSize: 14, fontWeight: '700' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  note: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  noteTinted: { backgroundColor: colors.blush, padding: space.md, borderRadius: radius.md },
  segmented: { flexDirection: 'row', gap: 4, padding: 4 },
  segment: { flex: 1, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontSize: 14, fontWeight: '700' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stepBtn: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
