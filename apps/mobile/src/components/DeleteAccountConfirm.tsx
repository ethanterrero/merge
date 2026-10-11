import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, space, type } from '../theme';
import { useAuth } from '../state/auth';
import { Button } from './Button';
import { Eyebrow } from './primitives';

// From the account-deletion policy (docs/superpowers/specs/2026-10-08-account-deletion-design.md, D-15).
// Update both lists when a feature adds data that deletion removes or keeps.
const DELETED = [
  'Your profile, vehicle and commutes',
  'Your ride feedback, Ride Again connections and blocks',
  "Invitations that didn't become a ride",
  'Your sign-in history',
];

const KEPT = [
  'Rides you shared stay in the other person\'s history as "Former member", with no name or photo.',
  "Upcoming confirmed rides are cancelled, and any Commute Crew you're in ends.",
  'Safety reports are kept for 12 months for safety follow-up, no longer linked to your account.',
];

function Bullets({ items }: { items: string[] }) {
  return (
    <View style={{ gap: space.xs }}>
      {items.map((item) => (
        <View key={item} style={styles.bullet}>
          <Text style={[type.body, styles.dot]} importantForAccessibility="no" accessibilityElementsHidden>
            •
          </Text>
          <Text style={[type.body, styles.bulletText]}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Explains what deleting the account removes and keeps, and deletes it on confirmation.
 * On success the Router returns to Welcome. Renders nothing in prototype mode, which has
 * no account to delete. `onDeletingChange` lets a container (a sheet or modal) refuse to
 * close while the request is in flight.
 */
export function DeleteAccountConfirm({
  onCancel,
  onDeleted,
  onDeletingChange,
}: {
  onCancel: () => void;
  onDeleted?: () => void;
  onDeletingChange?: (deleting: boolean) => void;
}) {
  const { status, deleteAccount } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  // Set synchronously, so a fast double tap can't send a second request before re-render.
  const inFlight = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  if (status === 'prototype') return null;

  const confirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setDeleting(true);
    onDeletingChange?.(true);
    const message = await deleteAccount();
    inFlight.current = false;
    onDeletingChange?.(false);
    if (!mounted.current) return;
    if (message === null) {
      onDeleted?.();
      return;
    }
    setDeleting(false);
    setError(message);
  };

  return (
    <View style={{ gap: space.md }}>
      <Text style={type.heading} accessibilityRole="header">
        Delete your account?
      </Text>
      <Text style={[type.body, { color: colors.textSecondary }]}>{"This can't be undone."}</Text>
      <Eyebrow>Deleted</Eyebrow>
      <Bullets items={DELETED} />
      <Eyebrow>What others keep</Eyebrow>
      <Bullets items={KEPT} />
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[type.small, { color: colors.danger }]}>
          {error}
        </Text>
      ) : null}
      <Button
        label={deleting ? 'Deleting…' : 'Delete account'}
        variant="destructive"
        disabled={deleting}
        onPress={confirm}
        accessibilityHint="Permanently deletes your Merge account"
      />
      <Button label="Cancel" variant="secondary" disabled={deleting} onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  bullet: { flexDirection: 'row', gap: space.sm },
  dot: { color: colors.textMuted },
  bulletText: { flex: 1, color: colors.textPrimary },
});
