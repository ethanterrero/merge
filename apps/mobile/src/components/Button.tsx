import React from 'react';
import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { colors, radius } from '../theme';

type Variant = 'primary' | 'secondary' | 'dark' | 'destructive' | 'tinted';

const variants: Record<Variant, { bg: string; fg: string; border?: string; pressed: string }> = {
  primary: { bg: colors.primary, fg: colors.onDark, pressed: colors.accent },
  dark: { bg: colors.deep, fg: colors.onDark, pressed: colors.deepPressed },
  secondary: { bg: colors.surface, fg: colors.textPrimary, border: colors.borderStrong, pressed: colors.background },
  destructive: { bg: colors.surface, fg: colors.accent, border: colors.accent, pressed: colors.tint },
  tinted: { bg: colors.tint, fg: colors.deep, pressed: colors.tintPressed },
};

type Props = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: 'lg' | 'md' | 'sm';
  disabled?: boolean;
  style?: ViewStyle;
  accessibilityHint?: string;
};

export function Button({ label, onPress, variant = 'primary', size = 'lg', disabled, style, accessibilityHint }: Props) {
  const v = variants[variant];
  const height = size === 'lg' ? 56 : size === 'md' ? 48 : 40;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityHint={accessibilityHint}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          height,
          paddingHorizontal: size === 'sm' ? 12 : 16,
          backgroundColor: disabled ? colors.border : pressed ? v.pressed : v.bg,
          borderColor: v.border ?? 'transparent',
          borderWidth: v.border ? 1 : 0,
        },
        style,
      ]}
    >
      <Text
        style={[
          styles.label,
          { color: disabled ? colors.textMuted : v.fg, fontSize: size === 'lg' ? 18 : size === 'md' ? 15 : 13 },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  label: { fontWeight: '700' },
});
