import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, space, TOUCH, type } from '../theme';
import { Button } from './Button';
import { Icon, IconName } from './Icon';

export type SheetAction = {
  label: string;
  onPress: () => void;
  icon?: IconName;
  /** 'destructive' for actions that end or hide something (Block). */
  tone?: 'default' | 'destructive';
  accessibilityHint?: string;
};

/**
 * A bottom sheet with a list of actions and a Cancel button, or custom content
 * (a confirmation) passed as children. `dismissible={false}` keeps it open while a
 * request is in flight.
 */
export function ActionSheet({
  visible,
  onClose,
  title,
  message,
  actions,
  children,
  dismissible = true,
  cancelLabel = 'Cancel',
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
  actions?: SheetAction[];
  children?: React.ReactNode;
  dismissible?: boolean;
  cancelLabel?: string;
}) {
  const { height } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={dismissible ? onClose : undefined}>
      <Pressable
        style={styles.scrim}
        onPress={onClose}
        disabled={!dismissible}
        accessibilityRole="button"
        accessibilityLabel={cancelLabel}
        accessibilityState={{ disabled: !dismissible }}
      />
      <View style={styles.sheet}>
        <SafeAreaView edges={['bottom']}>
          <ScrollView style={{ maxHeight: height * 0.85 }} contentContainerStyle={styles.content}>
            {title ? (
              <Text style={type.heading} accessibilityRole="header">
                {title}
              </Text>
            ) : null}
            {message ? <Text style={[type.body, { color: colors.textSecondary }]}>{message}</Text> : null}
            {children}
            {actions && actions.length > 0 ? (
              <View style={styles.actions}>
                {actions.map((action, i) => {
                  const fg = action.tone === 'destructive' ? colors.accent : colors.textPrimary;
                  return (
                    <Pressable
                      key={action.label}
                      accessibilityRole="button"
                      accessibilityHint={action.accessibilityHint}
                      onPress={action.onPress}
                      style={({ pressed }) => [styles.action, i > 0 && styles.divider, pressed && { backgroundColor: colors.background }]}
                    >
                      {action.icon ? <Icon name={action.icon} size={20} color={fg} /> : null}
                      <Text style={[type.subheading, { color: fg, flex: 1 }]}>{action.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            {actions ? <Button label={cancelLabel} variant="secondary" onPress={onClose} disabled={!dismissible} /> : null}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.maroonZone },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl },
  content: { padding: space.xl, gap: space.md },
  actions: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden' },
  action: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + space.sm, paddingHorizontal: space.lg },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
});
