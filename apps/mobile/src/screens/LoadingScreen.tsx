import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { colors, space } from '../theme';
import { Icon } from '../components/Icon';

/** Shown at launch while the stored session and profile load. */
export function LoadingScreen() {
  return (
    <View style={styles.wrap} accessible accessibilityLabel="Loading Merge">
      <StatusBar style="light" />
      <View style={styles.logo}>
        <Icon name="git-merge" size={28} color={colors.maroon} />
      </View>
      <ActivityIndicator color={colors.onDark} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.maroon, alignItems: 'center', justifyContent: 'center', gap: space.xl },
  logo: { width: 56, height: 56, borderRadius: 16, backgroundColor: colors.peach, alignItems: 'center', justifyContent: 'center' },
});
