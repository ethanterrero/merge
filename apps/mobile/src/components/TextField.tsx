import React from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { colors, radius, space, type } from '../theme';

/** Labeled single-line input. An error replaces the hint and is announced. */
export function TextField({
  label,
  hint,
  error,
  style,
  ...input
}: TextInputProps & { label: string; hint?: string | null; error?: string | null }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={type.subheading}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textFaint}
        style={[styles.input, error ? styles.inputError : null, style]}
        {...input}
      />
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[type.small, { color: colors.ember }]}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={[type.small, { color: colors.textMuted }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    paddingHorizontal: space.lg,
    fontSize: 17,
    color: colors.textPrimary,
  },
  inputError: { borderColor: colors.ember },
});
