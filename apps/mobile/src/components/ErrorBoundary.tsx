import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Sentry from '@sentry/react-native';
import { colors, radius, space, type } from '../theme';
import { monitoringOptions } from '../lib/monitoring';
import { Button } from './Button';
import { Icon } from './Icon';

// Crash reporting starts when this file is first imported, before the app renders,
// and only in preview and production builds with a DSN (monitoring.ts). Read as
// literal `process.env.EXPO_PUBLIC_*` so Expo inlines them into the bundle.
const sentryOptions = monitoringOptions({
  appEnv: process.env.EXPO_PUBLIC_APP_ENV,
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
});
if (sentryOptions) Sentry.init(sentryOptions);

// Placeholder until src/lib/links.ts exists (M-46): point this at its support link.
const SUPPORT_URL: string | null = null;

type State = { failed: boolean; generation: number };

/**
 * Root error boundary. A render error shows a fallback instead of a blank screen,
 * and Restart remounts everything inside it with fresh state.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { failed: false, generation: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // A no-op unless Sentry started above.
    Sentry.captureException(error, { contexts: { react: { componentStack: info.componentStack ?? '' } } });
  }

  restart = () => this.setState((s) => ({ failed: false, generation: s.generation + 1 }));

  render() {
    if (this.state.failed) return <ErrorFallback onRestart={this.restart} />;
    // A new key on Restart throws away the crashed tree and its state.
    return <React.Fragment key={this.state.generation}>{this.props.children}</React.Fragment>;
  }
}

// Sits above navigation, so it can't use Screen (which needs useNav).
function ErrorFallback({ onRestart }: { onRestart: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xxl }]}>
      <View style={styles.badge}>
        <Icon name="alert-circle" size={28} color={colors.danger} />
      </View>
      <Text style={[type.title, styles.center]} accessibilityRole="header">
        Something went wrong.
      </Text>
      <View style={styles.actions}>
        <Button label="Restart" onPress={onRestart} />
        <Button
          label="Contact support"
          variant="secondary"
          disabled={!SUPPORT_URL}
          onPress={SUPPORT_URL ? () => void Linking.openURL(SUPPORT_URL) : undefined}
        />
        {!SUPPORT_URL && <Text style={[type.body, styles.note]}>Please contact the pilot team.</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxl,
    gap: space.lg,
  },
  badge: {
    width: 56,
    height: 56,
    borderRadius: radius.xl,
    backgroundColor: colors.dangerBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { textAlign: 'center', color: colors.textPrimary },
  actions: { alignSelf: 'stretch', gap: space.md, marginTop: space.sm },
  note: { textAlign: 'center', color: colors.textSecondary },
});
