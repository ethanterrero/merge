import React from 'react';
import { Platform, Pressable, SafeAreaView, ScrollView, StatusBar as RNStatusBar, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { colors, radius, space, TOUCH, type } from '../theme';
import { useNav } from '../navigation';
import { Icon, IconName } from './Icon';

const androidTop = Platform.OS === 'android' ? RNStatusBar.currentHeight ?? 0 : 0;

/**
 * Standard screen frame: optional header, scrollable body and a pinned footer
 * for the primary action.
 */
export function Screen({
  header,
  footer,
  children,
  scroll = true,
  background = colors.background,
  contentStyle,
  statusBar = 'dark',
}: {
  header?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  scroll?: boolean;
  background?: string;
  contentStyle?: ViewStyle;
  statusBar?: 'dark' | 'light';
}) {
  return (
    <View style={{ flex: 1, backgroundColor: background }}>
      <StatusBar style={statusBar} />
      {header}
      {scroll ? (
        <ScrollView contentContainerStyle={[styles.content, contentStyle]} showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
      )}
      {footer ? (
        <View style={styles.footer}>
          <SafeAreaView>
            <View style={styles.footerInner}>{footer}</View>
          </SafeAreaView>
        </View>
      ) : null}
    </View>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  color = colors.textPrimary,
  background,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  color?: string;
  background?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.iconBtn, { backgroundColor: background ?? 'transparent', opacity: pressed ? 0.6 : 1 }]}
    >
      <Icon name={icon} size={22} color={color} />
    </Pressable>
  );
}

/** White top bar with back button and a title. */
export function TopBar({ title, right, onBack }: { title?: string; right?: React.ReactNode; onBack?: () => void }) {
  const nav = useNav();
  return (
    <View style={styles.topBarWrap}>
      <SafeAreaView>
        <View style={[styles.topBar, { paddingTop: androidTop + space.sm }]}>
          {nav.canGoBack || onBack ? <IconButton icon="chevron-back" label="Back" onPress={onBack ?? nav.back} /> : null}
          {title ? (
            <Text style={[type.heading, { flex: 1 }]} numberOfLines={1} accessibilityRole="header">
              {title}
            </Text>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          {right}
        </View>
      </SafeAreaView>
    </View>
  );
}

/** Onboarding progress bar, e.g. "Step 1 of 2 · Essentials". */
export function StepProgress({ step, total, label, right }: { step: number; total: number; label: string; right?: React.ReactNode }) {
  const nav = useNav();
  return (
    <View style={styles.topBarWrap}>
      <SafeAreaView>
        <View style={[styles.topBar, { paddingTop: androidTop + space.sm }]}>
          {nav.canGoBack ? <IconButton icon="chevron-back" label="Back" onPress={nav.back} /> : null}
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={[type.eyebrow, { color: colors.textMuted }]}>
              Step {step} of {total} · {label}
            </Text>
            <View style={{ flexDirection: 'row', gap: 4 }} accessibilityLabel={`Step ${step} of ${total}`}>
              {Array.from({ length: total }, (_, i) => (
                <View key={i} style={[styles.progress, { backgroundColor: i < step ? colors.chili : colors.borderStrong }]} />
              ))}
            </View>
          </View>
          {right}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  footer: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  footerInner: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.lg, gap: space.sm },
  iconBtn: { width: TOUCH, height: TOUCH, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  topBarWrap: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.md },
  progress: { flex: 1, height: 4, borderRadius: radius.pill },
});
