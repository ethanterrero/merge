import React, { useState } from 'react';
import { Text } from 'react-native';
import { type } from '../theme';
import { useNav } from '../navigation';
import { useAuth } from '../state/auth';
import { useCommute } from '../state/commute';
import { displayNameError } from '../lib/authRules';
import { Screen, TopBar } from '../components/Screen';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';

export function ProfileNameScreen() {
  const nav = useNav();
  const { saveProfile } = useAuth();
  const { commute } = useCommute();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async () => {
    if (saving) return;
    const invalid = displayNameError(name);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setSaving(true);
    const err = await saveProfile({ displayName: name, role: commute.role });
    setSaving(false);
    if (err) {
      setError(err);
      setFailed(true);
      return;
    }
    nav.reset({ name: 'commute' });
  };

  return (
    <Screen
      header={<TopBar title="Your name" />}
      footer={<Button label={saving ? 'Saving…' : failed ? 'Retry' : 'Continue'} disabled={saving} onPress={submit} />}
    >
      <Text style={type.title} accessibilityRole="header">
        What should riders call you?
      </Text>
      <TextField
        label="Name"
        value={name}
        onChangeText={(text) => {
          setName(text);
          setError(null);
        }}
        error={error}
        hint="First name and last initial, like Priya S."
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        maxLength={60}
        returnKeyType="done"
        onSubmitEditing={submit}
      />
    </Screen>
  );
}
