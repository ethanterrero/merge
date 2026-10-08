import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { colors, space, type } from '../theme';
import { useNav } from '../navigation';
import { useAuth } from '../state/auth';
import { digitsOnly, isCompleteCode, RESEND_AFTER_SECONDS } from '../lib/authRules';
import { Screen, TopBar } from '../components/Screen';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';

export function VerifyCodeScreen({ email }: { email: string }) {
  const nav = useNav();
  const { status, sendCode, verifyCode } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_AFTER_SECONDS);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  // A correct code signs the person in. Their auth status then decides where they go.
  useEffect(() => {
    if (status === 'needsProfile') nav.reset({ name: 'profileName' });
    else if (status === 'ready') nav.reset({ name: 'discover' });
  }, [status, nav]);

  const submit = async () => {
    if (!isCompleteCode(code) || verifying) return;
    setError(null);
    setNotice(null);
    setVerifying(true);
    const err = await verifyCode(email, code);
    // On success, stay in the checking state: the auth status effect above leaves this screen.
    if (err) {
      setVerifying(false);
      setError(err);
    }
  };

  const resend = async () => {
    if (resending) return;
    setError(null);
    setNotice(null);
    setResending(true);
    try {
      const err = await sendCode(email);
      if (err) {
        setError(err);
        return;
      }
      setError(null);
      setCode('');
      setNotice('New code sent.');
      setSecondsLeft(RESEND_AFTER_SECONDS);
    } finally {
      setResending(false);
    }
  };

  return (
    <Screen
      header={<TopBar title="Enter code" />}
      footer={<Button label={verifying ? 'Checking…' : 'Verify'} disabled={!isCompleteCode(code) || verifying} onPress={submit} />}
    >
      <Text style={type.title} accessibilityRole="header">
        Check your email
      </Text>
      <Text style={[type.body, { color: colors.textSecondary }]}>We sent a 6-digit code to {email}.</Text>
      <TextField
        label="6-digit code"
        value={code}
        onChangeText={(text) => {
          setCode(digitsOnly(text));
          setError(null);
        }}
        error={error}
        hint={notice}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        returnKeyType="done"
        onSubmitEditing={submit}
      />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button
          label={resending ? 'Sending…' : secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend code'}
          variant="tinted"
          size="sm"
          disabled={secondsLeft > 0 || resending}
          onPress={resend}
          style={{ flex: 1 }}
        />
        <Button label="Use a different email" variant="secondary" size="sm" disabled={verifying} onPress={nav.back} style={{ flex: 1 }} />
      </View>
    </Screen>
  );
}
