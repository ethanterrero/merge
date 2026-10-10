import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, space, type } from '../theme';
import { useAuth } from '../state/auth';
import { Button } from './Button';
import { DeleteAccountConfirm } from './DeleteAccountConfirm';

/** Who's signed in, and the ways out: sign out, or delete the account. */
export function AccountSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { status, email, profile, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const open = useRef(visible);
  const { height } = useWindowDimensions();

  // Closing or reopening the sheet starts it without a stale message, on the main view.
  useEffect(() => {
    open.current = visible;
    setError(null);
    setConfirmingDelete(false);
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
        <SafeAreaView edges={['bottom']}>
          {confirmingDelete ? (
            // The confirmation is longer than the sheet's main view; let it scroll on short screens.
            <ScrollView style={{ maxHeight: height * 0.85 }} contentContainerStyle={{ padding: space.xl }}>
              {/* On success the Router sends the signed-out person to Welcome. */}
              <DeleteAccountConfirm onCancel={() => setConfirmingDelete(false)} onDeleted={onClose} />
            </ScrollView>
          ) : (
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
              {/* Prototype mode has no account to delete. */}
              {status !== 'prototype' ? (
                <Button
                  label="Delete account"
                  variant="secondary"
                  size="md"
                  disabled={signingOut}
                  onPress={() => setConfirmingDelete(true)}
                  style={{ alignSelf: 'center', marginTop: space.sm }}
                />
              ) : null}
            </View>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.maroonZone },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl },
});
