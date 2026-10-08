import React, { useEffect, useState } from 'react';
import { BackHandler, Text, View } from 'react-native';
import { colors, space, type } from '../theme';
import { useNav } from '../navigation';
import { useAuth } from '../state/auth';
import { digitsOnly, isCompleteCode, RESEND_AFTER_SECONDS, VERIFY_CODE_ERROR } from '../lib/authRules';
import { Screen, TopBar } from '../components/Screen';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';

// TopBar has no disabled state, so the header Back is swapped for this no-op while the code is checked.
const ignoreBack = () => {};

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

  // While the code is being checked, hold the person on this screen: leaving would unmount the
  // status effect above, and a sign-in that lands afterwards would strand them on Sign in.
  // Android hardware back is swallowed here. BackHandler calls the most recently added listener
  // first and Router re-adds its own after every stack change, so this is registered when
  // `verifying` turns true (not on mount) to sit above Router's.
  useEffect(() => {
    if (!verifying) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [verifying]);

  const submit = async () => {
    if (!isCompleteCode(code) || verifying) return;
    setError(null);
    setNotice(null);
    setVerifying(true);
    let err: string | null;
    try {
      err = await verifyCode(email, code);
    } catch {
      // verifyCode resolves to a message, but a throw must not leave the screen stuck on 'Checking…'.
      err = VERIFY_CODE_ERROR;
    }
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
      header={<TopBar title="Enter code" onBack={verifying ? ignoreBack : undefined} />}
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
