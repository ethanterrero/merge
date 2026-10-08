import React from 'react';
import { Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from '../theme';
import { useAuth } from '../state/auth';
import { Button } from './Button';

/** Who's signed in, and the way out. */
export function AccountSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { email, profile, signOut } = useAuth();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close account" />
      <View style={styles.sheet}>
        <SafeAreaView>
          <View style={{ padding: space.xl, gap: space.md }}>
            <Text style={type.heading} accessibilityRole="header">
              {profile?.display_name ?? 'Account'}
            </Text>
            <Text style={[type.small, { color: colors.textMuted }]}>Signed in as {email}</Text>
            <Button
              label="Sign out"
              variant="destructive"
              onPress={() => {
                onClose();
                void signOut();
              }}
            />
            <Button label="Close" variant="secondary" onPress={onClose} />
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.maroonZone },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl },
});
