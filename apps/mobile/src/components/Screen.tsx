import React, { useEffect, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors, radius, space, TOUCH, type } from '../theme';
import { useNav } from '../navigation';
import { Icon, IconName } from './Icon';

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
  const keyboardUp = useKeyboardVisible();
  return (
    // 'padding' on both platforms: the view measures how far the keyboard overlaps it, so it
    // pads by the keyboard height when Android draws edge-to-edge and by 0 if the window was
    // resized instead. On Android it's switched off once the keyboard hides, because RN's
    // keyboardDidHide event reports a position that would leave the system-bar height as padding.
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: background }}
      behavior="padding"
      enabled={Platform.OS !== 'android' || keyboardUp}
    >
      <StatusBar style={statusBar} />
      {header}
      {scroll ? (
        <ScrollView contentContainerStyle={[styles.content, contentStyle]} showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
      )}
      {footer ? <Footer keyboardUp={keyboardUp}>{footer}</Footer> : null}
    </KeyboardAvoidingView>
  );
}

/**
 * Pinned footer. Pads the bottom inset (home indicator or Android navigation bar),
 * except while the keyboard is up: the keyboard already covers that inset, so keeping
 * it would float the footer above the keyboard.
 */
function Footer({ keyboardUp, children }: { keyboardUp: boolean; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.footer}>
      <View style={[styles.footerInner, { paddingBottom: space.lg + (keyboardUp ? 0 : insets.bottom) }]}>{children}</View>
    </View>
  );
}

/** iOS reports the keyboard as it starts to animate, Android only once it's shown or hidden. */
function useKeyboardVisible() {
  const [visible, setVisible] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const subs = [
      Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () => setVisible(true)),
      Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setVisible(false)),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);
  return visible;
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
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.topBarWrap}>
      <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]}>
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
    </View>
  );
}

/** Onboarding progress bar, e.g. "Step 1 of 2 · Essentials". */
export function StepProgress({ step, total, label, right }: { step: number; total: number; label: string; right?: React.ReactNode }) {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.topBarWrap}>
      <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]}>
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
