import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { colors, space, type } from '../theme';
import { useNav } from '../navigation';
import { useAuth } from '../state/auth';
import { INVALID_EMAIL_ERROR, isValidEmail, normalizeEmail } from '../lib/authRules';
import { Screen, TopBar } from '../components/Screen';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';

export function SignInScreen() {
  const nav = useNav();
  const { status, sendCode, devSignIn } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [devError, setDevError] = useState<string | null>(null);
  const [devSigningIn, setDevSigningIn] = useState(false);

  // Only the dev sign-in signs someone in from this screen; the code path does it on Verify.
  useEffect(() => {
    if (!devSigningIn) return;
    if (status === 'needsProfile') nav.reset({ name: 'profileName' });
    else if (status === 'ready') nav.reset({ name: 'discover' });
  }, [devSigningIn, status, nav]);

  const submit = async () => {
    if (sending) return;
    if (!isValidEmail(email)) {
      setError(INVALID_EMAIL_ERROR);
      return;
    }
    setError(null);
    setSending(true);
    const err = await sendCode(email);
    setSending(false);
    if (err) setError(err);
    else nav.push({ name: 'verifyCode', email: normalizeEmail(email) });
  };

  const signInAsDev = async () => {
    if (!devSignIn || devSigningIn) return;
    setDevError(null);
    setDevSigningIn(true);
    const err = await devSignIn.signIn();
    // On success, stay in the signing-in state: the status effect above leaves this screen.
    if (err) {
      setDevSigningIn(false);
      setDevError(err);
    }
  };

  return (
    <Screen
      header={<TopBar title="Sign in" />}
      footer={<Button label={sending ? 'Sending…' : 'Send code'} disabled={sending || email.trim() === ''} onPress={submit} />}
    >
      <Text style={type.title} accessibilityRole="header">
        What's your email?
      </Text>
      <Text style={[type.body, { color: colors.textSecondary }]}>We'll email you a 6-digit code. No password needed.</Text>
      <TextField
        label="Email"
        value={email}
        onChangeText={(text) => {
          setEmail(text);
          setError(null);
        }}
        error={error}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="send"
        onSubmitEditing={submit}
      />
      {devSignIn ? (
        <View style={{ gap: space.sm, marginTop: space.lg }}>
          <Text style={[type.small, { color: colors.textMuted }]}>Development build only</Text>
          <Button
            label={devSigningIn ? 'Signing in…' : `Skip code: sign in as ${devSignIn.email}`}
            variant="tinted"
            size="sm"
            disabled={devSigningIn || sending}
            onPress={signInAsDev}
          />
          {devError ? (
            <Text accessibilityLiveRegion="polite" style={[type.small, { color: colors.danger }]}>
              {devError}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
