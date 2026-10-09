import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from '../theme';
import { useAuth } from '../state/auth';
import { Button } from './Button';

/** Who's signed in, and the way out. */
export function AccountSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { email, profile, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = useRef(visible);

  // Closing or reopening the sheet starts it without a stale message.
  useEffect(() => {
    open.current = visible;
    setError(null);
  }, [visible]);

  const confirmSignOut = async () => {
    if (signingOut) return;
    setError(null);
    setSigningOut(true);
    const message = await signOut();
    // On success the Router sends signed-out people to Welcome, which unmounts this sheet.
    if (message === null) {
      onClose();
      return;
    }
    setSigningOut(false);
    // Shown only if the sheet is still open; a closed sheet starts clean on reopening.
    if (open.current) setError(message);
  };

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
            {error ? (
              <Text accessibilityLiveRegion="polite" style={[type.small, { color: colors.danger }]}>
                {error}
              </Text>
            ) : null}
            <Button
              label={signingOut ? 'Signing out…' : 'Sign out'}
              variant="destructive"
              disabled={signingOut}
              onPress={confirmSignOut}
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
