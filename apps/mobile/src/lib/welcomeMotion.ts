// Pure maths for the Welcome screen's merge animation. No React Native imports,
// so `npm test` can run this file under Node.
//
// Everything is in the 390×844 design space of the approved prototype. The screen
// multiplies positions by its own scale. Times are in seconds on a 4.6 s timeline.
// Tracks are returned as sampled arrays for Animated.interpolate over a normalized
// 0..1 progress value, because the native driver ignores `easing` and only
// interpolates linearly between samples.

export type Pt = { x: number; y: number };

export const DESIGN = { width: 390, height: 844 } as const;
/** Car body in design px, drawn pointing up. */
export const CAR = { width: 30, height: 50 } as const;
/** Timeline length in seconds and milliseconds. */
export const T = 4.6;
export const DURATION_MS = 4600;

// ---------------------------------------------------------------------------
// Easing

/** CSS cubic-bezier(x1, y1, x2, y2) as a function of linear progress 0..1. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u: number) => ((ay * u + by) * u + cy) * u;
  const slopeX = (u: number) => (3 * ax * u + 2 * bx) * u + cx;

  const solveU = (x: number) => {
    let u = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(u) - x;
      if (Math.abs(err) < 1e-7) return u;
      const d = slopeX(u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    let lo = 0;
    let hi = 1;
    u = x;
    while (hi - lo > 1e-7) {
      if (sampleX(u) < x) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return u;
  };

  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return sampleY(solveU(t));
  };
}

const linear = (t: number) => t;
const easeIn = cubicBezier(0.55, 0, 1, 1); // feeders: join → vanish
const mapEase = cubicBezier(0.6, 0, 0.25, 1);
const markEase = cubicBezier(0.55, 0, 0.75, 0.2);
const sheetEase = cubicBezier(0.4, 0, 0.2, 1);
const chipEase = cubicBezier(0, 0, 0.58, 1); // CSS ease-out
const coverEase = cubicBezier(0.2, 0.8, 0.2, 1);

// ---------------------------------------------------------------------------
// Geometry (ported from geom.py)

const K = 0.85;
/** Arc length per unit x along the avenue. */
const SC = Math.sqrt(1 + K * K);
/** Unit direction of travel along the avenue (up and to the right). */
const D: Pt = { x: 1 / SC, y: -K / SC };

/** The main avenue: y = 360 − 0.85(x − 195). */
export function avenueY(x: number): number {
  return 360 - K * (x - 195);
}

/** Heading in degrees for a direction vector: up = 0, clockwise positive. */
function headingOf(dx: number, dy: number): number {
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

export const AVENUE_HEADING_DEG = headingOf(D.x, D.y);

/** Where the avenue enters and leaves the 390-wide design. */
export const AVENUE = { from: { x: -40, y: avenueY(-40) }, to: { x: 430, y: avenueY(430) } } as const;

/** Distance along the lead's path (which starts at x = −40) at avenue position x. */
export function avenueDistance(x: number): number {
  return (x - AVENUE.from.x) * SC;
}

export const LEAD_FINAL: Pt = { x: 195, y: 360 };
const LEAD_STOP_S = 3;

/** Lead car x over time: 30 + 55t for 3 s, then holds at 195. */
export function leadX(t: number): number {
  return 30 + 55 * Math.min(Math.max(t, 0), LEAD_STOP_S);
}

/** A polyline with cumulative arc length, sampled from lines and cubic curves. */
class Path {
  readonly pts: Pt[];
  readonly cum: number[];
  constructor(pts: Pt[]) {
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) {
      this.cum.push(this.cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    }
  }
  get length(): number {
    return this.cum[this.cum.length - 1];
  }
  /** Position and heading at arc length s (clamped to the path). */
  at(s: number): Pt & { heading: number } {
    const d = Math.min(Math.max(s, 0), this.length);
    let lo = 0;
    let hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    const a = this.pts[lo];
    const b = this.pts[hi];
    const segLen = this.cum[hi] - this.cum[lo];
    const f = segLen > 0 ? (d - this.cum[lo]) / segLen : 0;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, heading: headingOf(b.x - a.x, b.y - a.y) };
  }
}

function cubicPoints(p0: Pt, c1: Pt, c2: Pt, p3: Pt, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
    });
  }
  return out;
}

export type FeederId = 'f1' | 'f2' | 'f3';
export type CarId = 'lead' | FeederId;

export type FeederSpec = {
  /** Straight street the car starts on, ending where the curve begins. */
  street: Pt[];
  /** First control point of the curve onto the avenue. */
  c1: Pt;
  /** Avenue x where the curve joins. */
  joinX: number;
  /** Seconds: start moving, reach the junction, vanish into the lead. */
  tStart: number;
  tJoin: number;
  tVanish: number;
};

/** Ordered by when they merge: f2 first, then f1, then f3. */
export const FEEDERS: Record<FeederId, FeederSpec> = {
  f2: { street: [{ x: 40, y: 578 }, { x: 40, y: 505 }], c1: { x: 40, y: 492 }, joinX: 55, tStart: 0, tJoin: 1.2, tVanish: 1.55 },
  f1: { street: [{ x: -12, y: 470 }, { x: 40, y: 470 }], c1: { x: 58, y: 470 }, joinX: 80, tStart: 0.35, tJoin: 1.9, tVanish: 2.25 },
  f3: { street: [{ x: 110, y: 578 }, { x: 110, y: 452 }], c1: { x: 110, y: 438 }, joinX: 125, tStart: 0.75, tJoin: 2.55, tVanish: 2.95 },
};
export const FEEDER_IDS: FeederId[] = ['f2', 'f1', 'f3'];

/** Seconds a merged feeder takes to fade (0.4% of the timeline, as designed). */
const VANISH_FADE_S = 0.004 * T;
const CURVE_SAMPLES = 240;

type FeederGeom = { path: Path; sJoin: number; sVanish: number; streetAndCurve: Pt[] };

function buildFeeder(f: FeederSpec): FeederGeom {
  const J: Pt = { x: f.joinX, y: avenueY(f.joinX) };
  const c2: Pt = { x: J.x - D.x * 13, y: J.y - D.y * 13 };
  const last = f.street[f.street.length - 1];
  const streetAndCurve = [...f.street, ...cubicPoints(last, f.c1, c2, J, CURVE_SAMPLES)];
  const path = new Path([...streetAndCurve, { ...AVENUE.to }]);
  const sJoin = path.cum[streetAndCurve.length - 1];
  const sVanish = sJoin + (avenueDistance(leadX(f.tVanish)) - avenueDistance(f.joinX));
  return { path, sJoin, sVanish, streetAndCurve };
}

const leadPath = new Path([{ ...AVENUE.from }, { ...AVENUE.to }]);
const feederGeom: Record<FeederId, FeederGeom> = {
  f1: buildFeeder(FEEDERS.f1),
  f2: buildFeeder(FEEDERS.f2),
  f3: buildFeeder(FEEDERS.f3),
};

/** The street and curve of a feeder in design px, for drawing the map. */
export function feederStreet(id: FeederId): Pt[] {
  return feederGeom[id].streetAndCurve;
}

function feederDistance(id: FeederId, t: number): number {
  const f = FEEDERS[id];
  const g = feederGeom[id];
  if (t <= f.tStart) return 0;
  if (t <= f.tJoin) return (g.sJoin * (t - f.tStart)) / (f.tJoin - f.tStart);
  if (t <= f.tVanish) return g.sJoin + (g.sVanish - g.sJoin) * easeIn((t - f.tJoin) / (f.tVanish - f.tJoin));
  return g.sVanish;
}

/** Fades 1 → 0 linearly between two times. */
function fadeOut(t: number, from: number, to: number): number {
  if (t <= from) return 1;
  if (t >= to) return 0;
  return 1 - (t - from) / (to - from);
}

const LEAD_FADE = { from: 0.7 * T, to: 0.76 * T };

export type Pose = { x: number; y: number; rotation: number; opacity: number };

/** Where a car is at time t (seconds): centre in design px, heading in degrees. */
export function carPose(id: CarId, t: number): Pose {
  if (id === 'lead') {
    const p = leadPath.at(avenueDistance(leadX(t)));
    return { x: p.x, y: p.y, rotation: p.heading, opacity: fadeOut(t, LEAD_FADE.from, LEAD_FADE.to) };
  }
  const f = FEEDERS[id];
  const p = feederGeom[id].path.at(feederDistance(id, t));
  return { x: p.x, y: p.y, rotation: p.heading, opacity: fadeOut(t, f.tVanish, f.tVanish + VANISH_FADE_S) };
}

// ---------------------------------------------------------------------------
// Sampled tracks for Animated.interpolate

/** Sorted, de-duplicated 0..1 samples: a uniform grid plus exact keyframe times. */
function sampleGrid(samples: number, keys: number[]): number[] {
  const all = [...Array.from({ length: samples + 1 }, (_, i) => i / samples), ...keys.filter((k) => k > 0 && k < 1)];
  all.sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of all) if (out.length === 0 || v - out[out.length - 1] > 1e-6) out.push(v);
  return out;
}

/** Removes 360° jumps so interpolating between neighbours turns the short way. */
function unwrap(angles: number[]): number[] {
  const out: number[] = [];
  for (const a of angles) {
    if (out.length === 0) {
      out.push(a);
      continue;
    }
    let v = a;
    const prev = out[out.length - 1];
    while (v - prev > 180) v -= 360;
    while (v - prev < -180) v += 360;
    out.push(v);
  }
  return out;
}

export type CarTrack = { inputRange: number[]; x: number[]; y: number[]; rotate: string[]; opacity: number[] };

const roundDeg = (v: number) => `${(Math.round(v * 100) / 100 || 0).toString()}deg`;

/** Per-car x/y (design px, car centre), rotation and opacity over progress 0..1. */
export function carTracks(samples = 160): Record<CarId, CarTrack> {
  const keys = [LEAD_STOP_S / T, LEAD_FADE.from / T, LEAD_FADE.to / T];
  for (const id of FEEDER_IDS) {
    const f = FEEDERS[id];
    keys.push(f.tStart / T, f.tJoin / T, f.tVanish / T, (f.tVanish + VANISH_FADE_S) / T);
  }
  const inputRange = sampleGrid(samples, keys);
  const track = (id: CarId): CarTrack => {
    const poses = inputRange.map((p) => carPose(id, p * T));
    return {
      inputRange,
      x: poses.map((q) => q.x),
      y: poses.map((q) => q.y),
      rotate: unwrap(poses.map((q) => q.rotation)).map(roundDeg),
      opacity: poses.map((q) => q.opacity),
    };
  };
  return { lead: track('lead'), f1: track('f1'), f2: track('f2'), f3: track('f3') };
}

export type BadgeTrack = { riders: 2 | 3 | 4; inputRange: number[]; opacity: number[]; scale: number[] };

/** The "N riders" badge on the lead car: one window per merge, each replacing the last. */
export function badgeTracks(): BadgeTrack[] {
  const starts = FEEDER_IDS.map((id) => (FEEDERS[id].tVanish + VANISH_FADE_S) / T);
  const POP = 0.026;
  return starts.map((start, i) => {
    const riders = (i + 2) as 2 | 3 | 4;
    const next = starts[i + 1];
    const [holdEnd, off] = next === undefined ? [LEAD_FADE.from / T, LEAD_FADE.to / T] : [next - 0.001, next];
    return {
      riders,
      inputRange: [0, start, start + POP, holdEnd, off, 1],
      opacity: [0, 0, 1, 1, 0, 0],
      scale: [0.6, 0.6, 1, 1, 1, 1],
    };
  });
}

type Keyframe = { p: number; v: number };
export type Track = { inputRange: number[]; output: number[] };

/** Samples keyframes with one easing applied per segment, like a CSS animation. */
function keyframeTrack(frames: Keyframe[], ease: (t: number) => number, perSegment = 24): Track {
  const inputRange = [frames[0].p];
  const output = [frames[0].v];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    const n = a.v === b.v || ease === linear ? 1 : perSegment;
    for (let j = 1; j <= n; j++) {
      inputRange.push(j === n ? b.p : a.p + ((b.p - a.p) * j) / n);
      output.push(j === n ? b.v : a.v + (b.v - a.v) * ease(j / n));
    }
  }
  return { inputRange, output };
}

/**
 * RN scales a view around its centre. Returns the translation that, applied
 * before the scale (`[{ translateX }, { translateY }, { scale }]`), keeps `focus` fixed.
 */
export function scaleAroundPoint(focus: Pt, center: Pt, scale: number): { translateX: number; translateY: number } {
  return { translateX: (focus.x - center.x) * (1 - scale), translateY: (focus.y - center.y) * (1 - scale) };
}

export type ZoomTrack = { inputRange: number[]; scale: number[]; translateX: number[]; translateY: number[] };

/**
 * Map zoom 1 → 2.4 between 0.66 and 0.80, around the lead's final point.
 * `view` is the map container in screen px; `unit` is screen px per design px.
 */
export function mapZoomTrack(view: { width: number; height: number }, unit: number): ZoomTrack {
  const k = keyframeTrack(
    [
      { p: 0, v: 1 },
      { p: 0.66, v: 1 },
      { p: 0.8, v: 2.4 },
      { p: 1, v: 2.4 },
    ],
    mapEase,
  );
  const focus = { x: LEAD_FINAL.x * unit, y: LEAD_FINAL.y * unit };
  const center = { x: view.width / 2, y: view.height / 2 };
  const t = k.output.map((s) => scaleAroundPoint(focus, center, s));
  return { inputRange: k.inputRange, scale: k.output, translateX: t.map((v) => v.translateX), translateY: t.map((v) => v.translateY) };
}

export type OverlayTracks = {
  /** Bottom sheet slide-out, 0 → 1 (multiply by 110% of the sheet height). */
  sheet: Track;
  chipOpacity: Track;
  /** Logo tile centred on the lead's final point. */
  markOpacity: Track;
  markScale: Track;
  /** Full-screen cover in the next screen's background colour. */
  coverOpacity: Track;
};

export function overlayTracks(): OverlayTracks {
  return {
    sheet: keyframeTrack(
      [
        { p: 0, v: 0 },
        { p: 0.09, v: 1 },
        { p: 1, v: 1 },
      ],
      sheetEase,
    ),
    chipOpacity: keyframeTrack(
      [
        { p: 0, v: 1 },
        { p: 0.06, v: 0 },
        { p: 1, v: 0 },
      ],
      chipEase,
    ),
    markOpacity: keyframeTrack(
      [
        { p: 0, v: 0 },
        { p: 0.7, v: 0 },
        { p: 0.78, v: 1 },
        { p: 0.92, v: 1 },
        { p: 0.97, v: 0 },
        { p: 1, v: 0 },
      ],
      markEase,
    ),
    markScale: keyframeTrack(
      [
        { p: 0, v: 0.45 },
        { p: 0.7, v: 0.45 },
        { p: 0.78, v: 1 },
        { p: 0.8, v: 1 },
        { p: 0.92, v: 16 },
        { p: 0.97, v: 22 },
        { p: 1, v: 22 },
      ],
      markEase,
    ),
    coverOpacity: keyframeTrack(
      [
        { p: 0, v: 0 },
        { p: 0.86, v: 0 },
        { p: 1, v: 1 },
      ],
      coverEase,
    ),
  };
}
