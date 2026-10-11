import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { colors, space, type } from '../theme';
import { useNav } from '../navigation';
import { useAuth } from '../state/auth';
import { useBlockActions } from '../lib/data/blocks';
import { ActionSheet } from './ActionSheet';
import { Button } from './Button';

/**
 * The "Block or report" menu for another member. Reusable: Match detail and a driver's
 * request use it now; Booked, Trips, Ride Again and the message thread add it later.
 * Block asks for confirmation first; Report opens the report form.
 */
export function BlockReportMenu({
  visible,
  onClose,
  personId,
  firstName,
  rideId,
  rideLabel,
  onBlocked,
}: {
  visible: boolean;
  onClose: () => void;
  personId: string;
  /** Shown in the menu ("Block Priya"); never sent anywhere. */
  firstName: string;
  /** The ride this is about, if there is one (a ride the member was on). */
  rideId?: string;
  rideLabel?: string;
  /** Called once the block is saved and the sheet has closed. */
  onBlocked?: () => void;
}) {
  const nav = useNav();
  const { status } = useAuth();
  const { block, pending } = useBlockActions();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every opening starts on the menu, without a stale error.
  useEffect(() => {
    if (visible) {
      setConfirming(false);
      setError(null);
    }
  }, [visible]);

  const report = () => {
    onClose();
    nav.push({ name: 'report', personId, personName: firstName, rideId, rideLabel });
  };

  const confirmBlock = async () => {
    setError(null);
    const result = await block(personId);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onClose();
    onBlocked?.();
  };

  if (confirming) {
    return (
      <ActionSheet visible={visible} onClose={onClose} dismissible={!pending} title={`Block ${firstName}?`}>
        <View style={{ gap: space.sm }}>
          <Text style={[type.body, { color: colors.textPrimary, fontWeight: '700' }]}>{"They won't be told."}</Text>
          <Text style={[type.body, { color: colors.textSecondary }]}>
            {"You'll stop seeing each other in Merge, and any Ride Again connection or Commute Crew between you ends. You can unblock later, but those don't come back."}
          </Text>
          {status === 'prototype' ? (
            <Text style={[type.small, { color: colors.textMuted }]}>Prototype: blocks stay on this device until you reload.</Text>
          ) : null}
        </View>
        {error ? (
          <Text accessibilityLiveRegion="polite" style={[type.small, { color: colors.danger }]}>
            {error}
          </Text>
        ) : null}
        <Button label={pending ? 'Blocking…' : `Block ${firstName}`} variant="destructive" disabled={pending} onPress={confirmBlock} />
        <Button label="Cancel" variant="secondary" disabled={pending} onPress={onClose} />
      </ActionSheet>
    );
  }

  return (
    <ActionSheet
      visible={visible}
      onClose={onClose}
      actions={[
        { label: `Block ${firstName}`, icon: 'ban', tone: 'destructive', onPress: () => setConfirming(true) },
        { label: `Report ${firstName}`, icon: 'flag', onPress: report, accessibilityHint: 'Opens the safety report form' },
      ]}
    />
  );
}

/** Confirms an unblock. Used by Match detail's blocked state and Blocked people. */
export function UnblockSheet({
  visible,
  onClose,
  personId,
  onUnblocked,
}: {
  visible: boolean;
  onClose: () => void;
  personId: string | null;
  onUnblocked?: () => void;
}) {
  const { unblock, pending } = useBlockActions();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) setError(null);
  }, [visible]);

  const confirm = async () => {
    if (!personId) return;
    setError(null);
    const result = await unblock(personId);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onClose();
    onUnblocked?.();
  };

  return (
    <ActionSheet
      visible={visible}
      onClose={onClose}
      dismissible={!pending}
      title="Unblock this person?"
      message="They won't be told. A Ride Again connection or Commute Crew that ended when you blocked them doesn't come back."
    >
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[type.small, { color: colors.danger }]}>
          {error}
        </Text>
      ) : null}
      <Button label={pending ? 'Unblocking…' : 'Unblock'} disabled={pending || !personId} onPress={confirm} />
      <Button label="Cancel" variant="secondary" disabled={pending} onPress={onClose} />
    </ActionSheet>
  );
}
