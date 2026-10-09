import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, TOUCH } from '../theme';
import { useNav } from '../navigation';
import { useAuth } from '../state/auth';
import { welcomeNext } from '../lib/authRules';
import { Button } from '../components/Button';
import {
  AVENUE,
  BadgeTrack,
  CAR,
  CarId,
  CarTrack,
  DESIGN,
  DURATION_MS,
  FEEDER_IDS,
  FeederId,
  LEAD_FINAL,
  Pt,
  Track,
  badgeTracks,
  carTracks,
  feederStreet,
  mapZoomTrack,
  overlayTracks,
} from '../lib/welcomeMotion';

const CAR_TRACKS = carTracks();
const BADGES = badgeTracks();
const OVERLAY = overlayTracks();

const MAP_LABEL = 'A street map where three cars turn onto one avenue and merge into a single car';

/** The owner-approved mark: Ionicons git-merge, flipped vertically. */
function MergeGlyph({ size }: { size: number }) {
  return (
    <View style={{ transform: [{ scaleY: -1 }] }}>
      <Ionicons name="git-merge" size={size} color={colors.deep} accessibilityElementsHidden importantForAccessibility="no" />
    </View>
  );
}

/**
 * Full-bleed street map with a bottom sheet. Log in plays the merge animation
 * (three cars join one avenue, the map zooms into the logo) and then moves on.
 */
export function WelcomeScreen() {
  const nav = useNav();
  const { status } = useAuth();
  const { width, height } = useWindowDimensions();
  const s = width / DESIGN.width;

  const progress = useRef(new Animated.Value(0)).current;
  const [playing, setPlaying] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(280);
  const started = useRef(false);
  const navigated = useRef(false);
  const mounted = useRef(true);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      progress.stopAnimation();
    };
  }, [progress]);

  const finish = useCallback(() => {
    if (navigated.current || !mounted.current) return;
    navigated.current = true;
    nav.push({ name: welcomeNext(statusRef.current) });
  }, [nav]);

  const logIn = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    setPlaying(true);
    let reduceMotion = false;
    try {
      reduceMotion = await AccessibilityInfo.isReduceMotionEnabled();
    } catch {
      reduceMotion = false;
    }
    if (!mounted.current) return;
    if (reduceMotion) {
      finish();
      return;
    }
    Animated.timing(progress, { toValue: 1, duration: DURATION_MS, easing: (t) => t, useNativeDriver: true }).start(({ finished }) => {
      if (finished) finish();
    });
  }, [finish, progress]);

  const signUp = useCallback(() => {
    if (!started.current) nav.push({ name: 'role' });
  }, [nav]);

  const zoom = useMemo(() => {
    const z = mapZoomTrack({ width, height }, s);
    const at = (output: number[]) => progress.interpolate({ inputRange: z.inputRange, outputRange: output });
    return [{ translateX: at(z.translateX) }, { translateY: at(z.translateY) }, { scale: at(z.scale) }];
  }, [width, height, s, progress]);

  const overlay = useMemo(() => {
    const at = (t: Track, k = 1) => progress.interpolate({ inputRange: t.inputRange, outputRange: t.output.map((v) => v * k) });
    return {
      sheetY: at(OVERLAY.sheet, sheetHeight * 1.1),
      chipOpacity: at(OVERLAY.chipOpacity),
      markOpacity: at(OVERLAY.markOpacity),
      markScale: at(OVERLAY.markScale),
      coverOpacity: at(OVERLAY.coverOpacity),
    };
  }, [progress, sheetHeight]);

  const onSheetLayout = (e: LayoutChangeEvent) => setSheetHeight(e.nativeEvent.layout.height);
  const mark = 120 * s;

  return (
    <View style={styles.root} pointerEvents={playing ? 'none' : 'auto'}>
      <StatusBar style="dark" />

      <View style={StyleSheet.absoluteFill} accessible accessibilityRole="image" accessibilityLabel={MAP_LABEL}>
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.map, { transform: zoom }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <MapDrawing s={s} designHeight={Math.max(DESIGN.height, height / s)} />
          {(['f1', 'f2', 'f3'] as const).map((id) => (
            <Car key={id} id={id} track={CAR_TRACKS[id]} s={s} progress={progress} />
          ))}
          <Car id="lead" track={CAR_TRACKS.lead} s={s} progress={progress} badges={BADGES} />
        </Animated.View>
        <Animated.View
          style={[
            styles.mark,
            {
              width: mark,
              height: mark,
              borderRadius: 34 * s,
              left: LEAD_FINAL.x * s - mark / 2,
              top: LEAD_FINAL.y * s - mark / 2,
              opacity: overlay.markOpacity,
              transform: [{ scale: overlay.markScale }],
            },
          ]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <MergeGlyph size={72 * s} />
        </Animated.View>
      </View>

      <SafeAreaView style={styles.chipArea} edges={['top']} pointerEvents="none">
        <Animated.View style={[styles.chip, { marginTop: 8, opacity: overlay.chipOpacity }]}>
          <View style={styles.chipLogo}>
            <MergeGlyph size={18} />
          </View>
          <Text style={styles.wordmark} accessibilityRole="header" accessibilityLabel="Merge">
            merge
          </Text>
        </Animated.View>
      </SafeAreaView>

      <Animated.View
        onLayout={onSheetLayout}
        style={[styles.sheet, { transform: [{ translateY: overlay.sheetY }] }]}
        accessibilityElementsHidden={playing}
        importantForAccessibility={playing ? 'no-hide-descendants' : 'auto'}
      >
        <SafeAreaView edges={['bottom']}>
          <View style={styles.sheetInner}>
            <Text style={styles.headline} accessibilityRole="header">
              Share the commute.
            </Text>
            <View style={styles.actions}>
              <Button label="Log in" onPress={logIn} style={styles.loginButton} />
              <View style={styles.signUpRow}>
                <Text style={styles.signUpLead}>New to Merge?</Text>
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel="Sign up"
                  onPress={signUp}
                  hitSlop={{ left: 8, right: 8 }}
                  style={({ pressed }) => [styles.signUp, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <Text style={styles.signUpText}>Sign up</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </SafeAreaView>
      </Animated.View>

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.cover, { opacity: overlay.coverOpacity }]} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Map, drawn with plain Views in 390-wide design px scaled by `s`.

/** A straight stroke from a to b; `cap` extends it by half its width at each end, like a round line cap. */
function Stroke({ a, b, w, color, cap, s }: { a: Pt; b: Pt; w: number; color: string; cap?: boolean; s: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) + (cap ? w : 0);
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  return (
    <View
      style={{
        position: 'absolute',
        left: (cx - len / 2) * s,
        top: (cy - w / 2) * s,
        width: len * s,
        height: w * s,
        borderRadius: cap ? (w * s) / 2 : 0,
        backgroundColor: color,
        transform: [{ rotate: `${(Math.atan2(dy, dx) * 180) / Math.PI}deg` }],
      }}
    />
  );
}

/** Feeder street plus its curve onto the avenue, approximated with short round-capped strokes. */
function feederPolyline(id: FeederId): Pt[] {
  const pts = feederStreet(id);
  // The first two points are the straight street; the rest sample the curve finely.
  const curve = pts.slice(2);
  const step = Math.ceil(curve.length / 12);
  const picked = curve.filter((_, i) => i % step === step - 1);
  if (picked[picked.length - 1] !== curve[curve.length - 1]) picked.push(curve[curve.length - 1]);
  return [pts[0], pts[1], ...picked];
}

const V_GRID = [15, 150, 205, 285, 345];
const H_GRID = [95, 175, 300, 395, 540, 650, 740];

const MapDrawing = memo(function MapDrawing({ s, designHeight }: { s: number; designHeight: number }) {
  const bottom = designHeight;
  const st = colors.street;
  return (
    <>
      {/* Water in the top-right corner, then the park beside the avenue. */}
      <View
        style={{
          position: 'absolute',
          left: 300 * s,
          top: 0,
          width: 90 * s,
          height: 120 * s,
          borderBottomLeftRadius: 90 * s,
          backgroundColor: colors.mapWater,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: (281.5 - 89.4 / 2) * s,
          top: (387.5 - 51.2 / 2) * s,
          width: 89.4 * s,
          height: 51.2 * s,
          backgroundColor: colors.park,
          transform: [{ rotate: '-40.46deg' }],
        }}
      />

      {V_GRID.map((x) => (
        <Stroke key={`v${x}`} a={{ x, y: 0 }} b={{ x, y: bottom }} w={5} color={st} s={s} />
      ))}
      {H_GRID.map((y) => (
        <Stroke key={`h${y}`} a={{ x: 0, y }} b={{ x: DESIGN.width, y }} w={5} color={st} s={s} />
      ))}
      <Stroke a={{ x: 0, y: 250 }} b={{ x: 390, y: 20 }} w={5} color={st} s={s} />
      <Stroke a={{ x: 210, y: 844 }} b={{ x: 390, y: 610 }} w={5} color={st} s={s} />

      <Stroke a={{ x: 250, y: 0 }} b={{ x: 250, y: bottom }} w={11} color={st} cap s={s} />
      <Stroke a={{ x: 0, y: 230 }} b={{ x: 390, y: 230 }} w={11} color={st} cap s={s} />
      <Stroke a={{ x: 330, y: 300 }} b={{ x: 330, y: bottom }} w={11} color={st} cap s={s} />

      {FEEDER_IDS.map((id) => {
        const pts = feederPolyline(id);
        return pts.slice(1).map((p, i) => <Stroke key={`${id}-${i}`} a={pts[i]} b={p} w={13} color={st} cap s={s} />);
      })}

      <Stroke a={AVENUE.from} b={AVENUE.to} w={22} color={colors.avenue} cap s={s} />
      <Stroke a={AVENUE.from} b={AVENUE.to} w={12} color={colors.avenueInner} cap s={s} />
    </>
  );
});

// ---------------------------------------------------------------------------
// Cars: top-down, pointing up, positioned by their centre.

const CAR_COLORS = {
  lead: { body: colors.carLeadBody, side: colors.carLeadSide, highlight: colors.carLeadHighlight },
  sand: { body: colors.carSandBody, side: colors.carSandSide, highlight: colors.carSandHighlight },
};

function Car({ id, track, s, progress, badges }: { id: CarId; track: CarTrack; s: number; progress: Animated.Value; badges?: BadgeTrack[] }) {
  const anim = useMemo(() => {
    const { inputRange } = track;
    return {
      opacity: progress.interpolate({ inputRange, outputRange: track.opacity }),
      transform: [
        { translateX: progress.interpolate({ inputRange, outputRange: track.x.map((x) => (x - CAR.width / 2) * s) }) },
        { translateY: progress.interpolate({ inputRange, outputRange: track.y.map((y) => (y - CAR.height / 2) * s) }) },
        { rotate: progress.interpolate({ inputRange, outputRange: track.rotate }) },
      ],
    };
  }, [track, s, progress]);

  const c = id === 'lead' ? CAR_COLORS.lead : CAR_COLORS.sand;
  const r = { borderTopLeftRadius: 13 * s, borderTopRightRadius: 13 * s, borderBottomLeftRadius: 11 * s, borderBottomRightRadius: 11 * s };

  return (
    <Animated.View
      style={[
        styles.car,
        r,
        { width: CAR.width * s, height: CAR.height * s, backgroundColor: c.body, shadowOffset: { width: 0, height: 5 * s }, shadowRadius: 5 * s },
        anim,
      ]}
    >
      <View style={[StyleSheet.absoluteFill, r, { overflow: 'hidden' }]}>
        <View style={[styles.strip, { left: 0, width: 5 * s, backgroundColor: c.side }]} />
        <View style={[styles.strip, { left: 9 * s, width: 6 * s, backgroundColor: c.highlight }]} />
        <View style={[styles.strip, { right: 0, width: 5 * s, backgroundColor: c.side }]} />
      </View>
      <View
        style={{
          position: 'absolute',
          left: 5 * s,
          top: 13 * s,
          width: 20 * s,
          height: 23 * s,
          borderTopLeftRadius: 8 * s,
          borderTopRightRadius: 8 * s,
          borderBottomLeftRadius: 6 * s,
          borderBottomRightRadius: 6 * s,
          backgroundColor: colors.carCabin,
        }}
      />
      <View style={{ position: 'absolute', left: 8 * s, top: 15 * s, width: 6 * s, height: 9 * s, borderRadius: 4 * s, backgroundColor: colors.carShine }} />
      {badges?.map((b) => <Badge key={b.riders} badge={b} s={s} progress={progress} />)}
    </Animated.View>
  );
}

function Badge({ badge, s, progress }: { badge: BadgeTrack; s: number; progress: Animated.Value }) {
  const style = useMemo(
    () => ({
      opacity: progress.interpolate({ inputRange: badge.inputRange, outputRange: badge.opacity }),
      transform: [{ scale: progress.interpolate({ inputRange: badge.inputRange, outputRange: badge.scale }) }],
    }),
    [badge, progress],
  );
  return (
    <View style={{ position: 'absolute', left: 22 * s, top: -16 * s, width: 90 * s, alignItems: 'flex-start' }}>
      <Animated.View style={[styles.badge, { paddingHorizontal: 7 * s, paddingVertical: 3 * s, gap: 3 * s }, style]}>
        <Ionicons name="people" size={11 * s} color={colors.onDark} />
        <Text style={[styles.badgeText, { fontSize: 11 * s }]} numberOfLines={1}>
          {badge.riders} riders
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.mapBg, overflow: 'hidden' },
  map: { backgroundColor: colors.mapBg },
  mark: { position: 'absolute', backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  car: { position: 'absolute', left: 0, top: 0, shadowColor: colors.carShadow, shadowOpacity: 1, elevation: 4 },
  strip: { position: 'absolute', top: 0, bottom: 0 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.deep,
    shadowColor: colors.carShadow,
    shadowOpacity: 0.7,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
  badgeText: { color: colors.onDark, fontWeight: '800' },
  chipArea: { position: 'absolute', top: 0, left: 0, right: 0 },
  chip: {
    alignSelf: 'flex-start',
    marginLeft: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 12,
    borderRadius: 14,
    backgroundColor: colors.surface,
    ...shadow.md,
  },
  chipLogo: { width: 30, height: 30, borderRadius: 9, backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  wordmark: { fontSize: 19, fontWeight: '800', letterSpacing: -0.4, color: colors.deep },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    shadowColor: colors.deep,
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
    elevation: 12,
  },
  sheetInner: { paddingTop: 26, paddingHorizontal: 24, paddingBottom: 10, minHeight: 228, gap: 22 },
  headline: { fontSize: 34, lineHeight: 37, fontWeight: '800', letterSpacing: -1.2, color: colors.textPrimary },
  actions: { marginTop: 'auto', gap: 6 },
  loginButton: { borderRadius: radius.lg },
  signUpRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: TOUCH },
  signUpLead: { fontSize: 15, color: colors.textMuted },
  signUp: { minHeight: TOUCH, justifyContent: 'center', paddingHorizontal: 2 },
  signUpText: { fontSize: 15, fontWeight: '700', color: colors.accent, textDecorationLine: 'underline' },
  cover: { backgroundColor: colors.background },
});
