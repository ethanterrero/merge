import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius, space, type } from '../theme';
import { useNav } from '../navigation';
import { useAuth } from '../state/auth';
import {
  detailsLength,
  EMERGENCY_LINE,
  MAX_REPORT_DETAILS,
  REPORT_CATEGORIES,
  REPORT_SENT_BODY,
  REPORT_SENT_TITLE,
  useReportActions,
  validateReport,
  type ReportCategory,
} from '../lib/data/reports';
import { Screen, TopBar } from '../components/Screen';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Card, Eyebrow, Row, Toggle } from '../components/primitives';

/**
 * File a safety report about another member, a ride, or both. Reports are insert-only:
 * after sending, nothing about the report is shown again, here or anywhere.
 */
export function ReportScreen({
  personId,
  personName,
  rideId,
  rideLabel,
}: {
  personId?: string;
  personName?: string;
  rideId?: string;
  rideLabel?: string;
}) {
  const nav = useNav();
  const { status } = useAuth();
  const { submitReport, pending } = useReportActions();
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [details, setDetails] = useState('');
  const [includeRide, setIncludeRide] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const send = async () => {
    setError(null);
    const checked = validateReport({
      category,
      details,
      reportedUserId: personId ?? null,
      rideId: rideId && includeRide ? rideId : null,
    });
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    const result = await submitReport(checked.report);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    // Clear the form: once sent, the report isn't shown again.
    setCategory(null);
    setDetails('');
    setSent(true);
  };

  const emergency = (
    <Card style={styles.emergency}>
      <Icon name="call" size={20} color={colors.danger} />
      <Text style={[type.subheading, { color: colors.textPrimary, flex: 1 }]} accessibilityRole="header">
        {EMERGENCY_LINE}
      </Text>
      <Button label="Call 911" variant="secondary" size="sm" onPress={() => void Linking.openURL('tel:911')} />
    </Card>
  );

  if (sent) {
    return (
      <Screen header={<TopBar title="Report" />} footer={<Button label="Done" onPress={nav.back} />}>
        {emergency}
        <Card style={{ padding: space.lg, gap: space.sm, alignItems: 'flex-start' }}>
          <Icon name="checkmark-circle" size={28} color={colors.success} />
          <Text style={type.heading} accessibilityRole="header" accessibilityLiveRegion="polite">
            {REPORT_SENT_TITLE}
          </Text>
          <Text style={[type.body, { color: colors.textSecondary }]}>{REPORT_SENT_BODY}</Text>
          {personName ? (
            <Text style={[type.small, { color: colors.textMuted }]}>{`${personName} can't see this report.`}</Text>
          ) : null}
        </Card>
      </Screen>
    );
  }

  const length = detailsLength(details);

  return (
    <Screen
      header={<TopBar title={personName ? `Report ${personName}` : 'Report a safety concern'} />}
      footer={
        <>
          {error ? (
            <Text accessibilityLiveRegion="polite" style={[type.small, { color: colors.danger }]}>
              {error}
            </Text>
          ) : null}
          <Button label={pending ? 'Sending…' : 'Send report'} disabled={pending || category === null} onPress={send} />
        </>
      }
    >
      {emergency}

      {status === 'prototype' ? (
        <Text style={[type.small, { color: colors.textMuted }]}>{"Prototype: reports stay on this device and aren't sent to anyone."}</Text>
      ) : null}

      <Eyebrow>What happened?</Eyebrow>
      <Card>
        <View accessibilityRole="radiogroup">
          {REPORT_CATEGORIES.map((c, i) => {
            const on = c.value === category;
            return (
              <Pressable
                key={c.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() => setCategory(c.value)}
                style={({ pressed }) => [pressed && { backgroundColor: colors.background }]}
              >
                <Row divider={i > 0}>
                  <Icon name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? colors.primary : colors.textFaint} />
                  <Text style={[type.body, { color: colors.textPrimary, flex: 1 }]}>{c.label}</Text>
                </Row>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Eyebrow>Details (optional)</Eyebrow>
      <View style={{ gap: 6 }}>
        <TextInput
          accessibilityLabel="Details"
          accessibilityHint="Describe what happened"
          placeholder="What happened, and when?"
          placeholderTextColor={colors.textFaint}
          multiline
          textAlignVertical="top"
          maxLength={MAX_REPORT_DETAILS}
          value={details}
          onChangeText={setDetails}
          style={styles.details}
        />
        <Text style={[type.caption, { color: colors.textMuted, alignSelf: 'flex-end' }]}>
          {length} / {MAX_REPORT_DETAILS}
        </Text>
      </View>

      {rideId ? (
        <Card>
          <Row>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={type.subheading}>Include this ride</Text>
              {rideLabel ? <Text style={[type.small, { color: colors.textMuted }]}>{rideLabel}</Text> : null}
            </View>
            <Toggle value={includeRide} onValueChange={setIncludeRide} label="Include this ride" />
          </Row>
        </Card>
      ) : null}

      <Text style={[type.small, { color: colors.textMuted }]}>
        {personName
          ? `${personName} can't see this report, and you won't see it again after you send it.`
          : "You won't see this report again after you send it."}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  emergency: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, backgroundColor: colors.dangerBg },
  details: {
    minHeight: 140,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    padding: space.lg,
    fontSize: 17,
    lineHeight: 22,
    color: colors.textPrimary,
  },
});
