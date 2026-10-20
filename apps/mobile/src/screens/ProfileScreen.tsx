import React, { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { colors, space, type } from '../theme';
import { useNav } from '../navigation';
import { useAuth } from '../state/auth';
import { Role, useCommute } from '../state/commute';
import { displayNameError, normalizeDisplayName } from '../lib/authRules';
import { publicName } from '../lib/names';
import { LINKS } from '../lib/links';
import { vehicleSummary } from '../lib/vehicleRules';
import { Screen, TopBar } from '../components/Screen';
import { TabBar } from '../components/TabBar';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { Icon } from '../components/Icon';
import { DeleteAccountConfirm } from '../components/DeleteAccountConfirm';
import { Card, Eyebrow, Segmented, SettingRow } from '../components/primitives';
import appConfig from '../../app.json';

const ROLES: { value: Role; label: string }[] = [
  { value: 'driver', label: 'Drive' },
  { value: 'passenger', label: 'Ride' },
  { value: 'both', label: 'Both' },
];

function asRole(value: string | undefined): Role | null {
  return ROLES.some((r) => r.value === value) ? (value as Role) : null;
}

// Prototype mode has no profile row, so the name lives here for the session.
let prototypeName = '';

/**
 * The Profile tab: name and role, links to the commute settings and Blocked people,
 * legal and support links, the app version, and (connected mode only) Sign out and
 * Delete account. Commute and Preferences open their onboarding screens until M-34
 * gives them an edit mode.
 */
export function ProfileScreen() {
  const nav = useNav();
  const { status, email, profile, saveProfile, signOut } = useAuth();
  const { commute, update } = useCommute();
  const prototype = status === 'prototype';

  const savedName = prototype ? prototypeName : (profile?.display_name ?? '');
  const savedRole = prototype ? commute.role : (asRole(profile?.role) ?? commute.role);
  const [name, setName] = useState(savedName);
  const [role, setRole] = useState<Role>(savedRole);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const dirty = normalizeDisplayName(name) !== savedName || role !== savedRole;
  const preview = publicName(name);

  const edited = () => {
    setSaved(false);
    setSaveError(null);
  };

  const save = async () => {
    if (saving) return;
    const invalid = displayNameError(name);
    if (invalid) {
      setNameError(invalid);
      return;
    }
    setNameError(null);
    setSaveError(null);
    const displayName = normalizeDisplayName(name);
    if (prototype) {
      prototypeName = displayName;
    } else {
      setSaving(true);
      const err = await saveProfile({ displayName, role });
      if (!mounted.current) return;
      setSaving(false);
      if (err) {
        setSaveError(err);
        return;
      }
    }
    // The commute draft drives the role-aware screens until M-34 loads it from the server.
    update({ role });
    setName(displayName);
    setSaved(true);
  };

  const confirmSignOut = async () => {
    if (signingOut) return;
    setSignOutError(null);
    setSigningOut(true);
    const message = await signOut();
    // On success the Router sends signed-out people to Welcome, which unmounts this screen.
    if (!mounted.current || message === null) return;
    setSigningOut(false);
    setSignOutError(message);
  };

  const open = (url: string) => {
    setLinkError(null);
    Linking.openURL(url).catch(() => {
      if (mounted.current) setLinkError("Couldn't open the link. Try again later.");
    });
  };

  if (confirmingDelete) {
    return (
      <Screen header={<TopBar title="Delete account" onBack={deleting ? undefined : () => setConfirmingDelete(false)} />}>
        {/* On success the Router sends the signed-out person to Welcome. */}
        <DeleteAccountConfirm onCancel={() => setConfirmingDelete(false)} onDeletingChange={setDeleting} />
      </Screen>
    );
  }

  const drives = savedRole !== 'passenger';
  const vehicle = commute.vehicle;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Screen header={<TopBar title="Profile" />} contentStyle={{ gap: space.lg }}>
        <View style={{ gap: space.sm }}>
          <Eyebrow>Your profile</Eyebrow>
          <Card style={{ padding: space.lg, gap: space.lg }}>
            <TextField
              label="Name"
              value={name}
              onChangeText={(text) => {
                setName(text);
                setNameError(null);
                edited();
              }}
              error={nameError}
              hint={preview ? `Others see: ${preview}` : 'First name and last initial, like Priya S.'}
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              maxLength={60}
              returnKeyType="done"
              onSubmitEditing={dirty ? save : undefined}
            />
            <View style={{ gap: 6 }}>
              <Text style={type.subheading}>Role</Text>
              <Segmented
                options={ROLES}
                value={role}
                onChange={(next) => {
                  setRole(next);
                  edited();
                }}
              />
            </View>
          </Card>
          {saveError ? (
            <Text accessibilityLiveRegion="polite" style={[type.small, { color: colors.danger }]}>
              {saveError}
            </Text>
          ) : null}
          {dirty ? (
            <Button label={saving ? 'Saving…' : saveError ? 'Retry' : 'Save changes'} size="md" disabled={saving} onPress={save} />
          ) : saved ? (
            <Text accessibilityLiveRegion="polite" style={[type.small, { color: colors.successText }]}>
              Saved.
            </Text>
          ) : null}
        </View>

        <View style={{ gap: space.sm }}>
          <Eyebrow>Your commute</Eyebrow>
          <Card>
            <NavRow
              title="Where and when"
              description={`${commute.pickupArea} to ${commute.dropoffArea}`}
              onPress={() => nav.push({ name: 'commute' })}
            />
            <NavRow divider title="Preferences" onPress={() => nav.push({ name: 'preferences' })} />
            {drives ? (
              <NavRow
                divider
                title="Vehicle"
                description={vehicle ? vehicleSummary(vehicle) : 'Not added yet'}
                onPress={() => nav.push({ name: 'vehicle' })}
              />
            ) : null}
          </Card>
        </View>

        <View style={{ gap: space.sm }}>
          <Eyebrow>Privacy and safety</Eyebrow>
          <Card>
            <NavRow title="Blocked people" onPress={() => nav.push({ name: 'blockedPeople' })} />
          </Card>
        </View>

        <View style={{ gap: space.sm }}>
          <Eyebrow>About</Eyebrow>
          <Card>
            <NavRow external title="Privacy Policy" onPress={() => open(LINKS.privacy)} />
            <NavRow external divider title="Terms" onPress={() => open(LINKS.terms)} />
            <NavRow external divider title="Contact support" onPress={() => open(LINKS.support)} />
            <SettingRow divider title="Version" trailing={<Text style={[type.body, { color: colors.textMuted }]}>{appConfig.expo.version}</Text>} />
          </Card>
          {linkError ? (
            <Text accessibilityLiveRegion="polite" style={[type.small, { color: colors.danger }]}>
              {linkError}
            </Text>
          ) : null}
        </View>

        {/* Prototype mode has no account to sign out of or delete. */}
        {!prototype ? (
          <View style={{ gap: space.sm }}>
            <Eyebrow>Account</Eyebrow>
            <Text style={[type.small, { color: colors.textMuted }]}>Signed in as {email}</Text>
            {signOutError ? (
              <Text accessibilityLiveRegion="polite" style={[type.small, { color: colors.danger }]}>
                {signOutError}
              </Text>
            ) : null}
            <Button
              label={signingOut ? 'Signing out…' : 'Sign out'}
              variant="destructive"
              size="md"
              disabled={signingOut}
              onPress={confirmSignOut}
            />
            <Button
              label="Delete account"
              variant="secondary"
              size="md"
              disabled={signingOut}
              onPress={() => setConfirmingDelete(true)}
            />
          </View>
        ) : null}
      </Screen>
      <TabBar active="profile" />
    </View>
  );
}

/** A settings row that opens a screen, or an outside page when `external`. */
function NavRow({
  title,
  description,
  onPress,
  divider,
  external,
}: {
  title: string;
  description?: string;
  onPress: () => void;
  divider?: boolean;
  external?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={external ? 'link' : 'button'}
      accessibilityLabel={description ? `${title}, ${description}` : title}
      accessibilityHint={external ? 'Opens in your browser' : undefined}
      onPress={onPress}
      style={({ pressed }) => (pressed ? { backgroundColor: colors.background } : null)}
    >
      <SettingRow
        divider={divider}
        title={title}
        description={description}
        trailing={<Icon name={external ? 'open-outline' : 'chevron-forward'} size={20} color={colors.textFaint} />}
      />
    </Pressable>
  );
}
