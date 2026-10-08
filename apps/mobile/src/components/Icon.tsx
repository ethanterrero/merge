import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** Filled icon set throughout; decorative by default (hidden from screen readers). */
export function Icon({ name, size = 20, color = colors.textPrimary }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} accessibilityElementsHidden importantForAccessibility="no" />;
}
