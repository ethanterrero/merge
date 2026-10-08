import React, { useState } from 'react';
import { Text } from 'react-native';
import { colors, type } from '../theme';
import { useNav } from '../navigation';
import { useAuth } from '../state/auth';
import { INVALID_EMAIL_ERROR, isValidEmail, normalizeEmail } from '../lib/authRules';
import { Screen, TopBar } from '../components/Screen';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';

export function SignInScreen() {
  const nav = useNav();
  const { sendCode } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

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
    </Screen>
  );
}
