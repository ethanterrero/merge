import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { colors, space, type } from '../theme';
import { blockedOnLabel, FORMER_MEMBER, useBlockedPeople } from '../lib/data/blocks';
import { Screen, TopBar } from '../components/Screen';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Card, InfoNote, Row } from '../components/primitives';
import { UnblockSheet } from '../components/BlockReportMenu';

/**
 * People the member blocked, with Unblock. Names aren't available for a blocked pair
 * (profile cards hide them both ways), so each row uses the missing-card label.
 * The Profile screen task (M-30) adds the entry point.
 */
export function BlockedPeopleScreen() {
  const query = useBlockedPeople();
  const [unblocking, setUnblocking] = useState<string | null>(null);

  let body: React.ReactNode;
  switch (query.status) {
    case 'idle':
    case 'loading':
      body = <Text style={[type.small, { color: colors.textMuted }]}>Loading…</Text>;
      break;
    case 'error':
      body = (
        <View style={{ gap: space.sm }}>
          <Text accessibilityLiveRegion="polite" style={[type.small, { color: colors.danger }]}>
            {query.error.message}
          </Text>
          <Button label="Try again" variant="secondary" size="md" onPress={query.refetch} />
        </View>
      );
      break;
    case 'empty':
      body = <Text style={[type.body, { color: colors.textSecondary }]}>{"You haven't blocked anyone."}</Text>;
      break;
    case 'success':
      body = (
        <Card>
          {query.data.map((person, i) => (
            <Row key={person.id} divider={i > 0}>
              <Icon name="person-circle" size={36} color={colors.textFaint} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={type.subheading}>{FORMER_MEMBER}</Text>
                <Text style={[type.small, { color: colors.textMuted }]}>{blockedOnLabel(person.blockedAt)}</Text>
              </View>
              <Button label="Unblock" variant="secondary" size="sm" onPress={() => setUnblocking(person.id)} />
            </Row>
          ))}
        </Card>
      );
      break;
  }

  return (
    <Screen header={<TopBar title="Blocked people" />}>
      <InfoNote text="People you block aren't told. You won't see each other in Merge." />
      {body}
      {query.lastError ? (
        <Text accessibilityLiveRegion="polite" style={[type.small, { color: colors.danger }]}>
          {query.lastError.message}
        </Text>
      ) : null}
      <UnblockSheet visible={unblocking !== null} onClose={() => setUnblocking(null)} personId={unblocking} />
    </Screen>
  );
}
