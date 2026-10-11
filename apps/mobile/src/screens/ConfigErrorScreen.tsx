import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from '../theme';
import { Screen } from '../components/Screen';
import { Icon } from '../components/Icon';

/**
 * Blocking screen for a preview or production build that is missing its Supabase
 * config. It has no actions and no mock data: there's nothing a tester can fix here,
 * and the build must not fall back to the prototype.
 */
export function ConfigErrorScreen() {
  return (
    <Screen scroll={false} contentStyle={styles.wrap}>
      <View style={styles.badge}>
        <Icon name="alert-circle" size={28} color={colors.danger} />
      </View>
      <Text style={[type.title, styles.center]} accessibilityRole="header">
        {"This build isn't set up correctly."}
      </Text>
      <Text style={[type.body, styles.body]}>Please contact the pilot team.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.lg },
  badge: {
    width: 56,
    height: 56,
    borderRadius: radius.xl,
    backgroundColor: colors.dangerBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { textAlign: 'center', color: colors.textPrimary },
  body: { textAlign: 'center', color: colors.textSecondary },
});
