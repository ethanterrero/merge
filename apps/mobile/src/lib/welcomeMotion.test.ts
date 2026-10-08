import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AVENUE_HEADING_DEG,
  CAR,
  DURATION_MS,
  FEEDERS,
  FEEDER_IDS,
  LEAD_FINAL,
  T,
  avenueDistance,
  avenueY,
  badgeTracks,
  carPose,
  carTracks,
  cubicBezier,
  leadX,
  mapZoomTrack,
  overlayTracks,
  scaleAroundPoint,
} from './welcomeMotion';

const close = (a: number, b: number, eps: number, msg?: string) =>
  assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} expected ${a} ≈ ${b} (±${eps})`);

const strictlyIncreasing = (xs: number[], name: string) => {
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1], `${name} not increasing at ${i}: ${xs[i - 1]} → ${xs[i]}`);
};

const deg = (s: string) => {
  assert.match(s, /^-?\d+(\.\d+)?deg$/);
  return parseFloat(s);
};

test('timeline is 4.6 s', () => {
  assert.equal(T, 4.6);
  assert.equal(DURATION_MS, 4600);
});

test('avenue line matches the design: y = 360 − 0.85(x − 195)', () => {
  assert.equal(avenueY(195), 360);
  close(avenueY(-40), 559.75, 1e-9);
  close(avenueY(430), 160.25, 1e-9);
  close(AVENUE_HEADING_DEG, (Math.atan2(1, 0.85) * 180) / Math.PI, 1e-9);
  close(AVENUE_HEADING_DEG, 49.64, 0.01);
});

test('lead drives x = 30 + 55t for 3 s, then holds at x = 195', () => {
  assert.equal(leadX(0), 30);
  assert.equal(leadX(1), 85);
  assert.equal(leadX(3), 195);
  assert.equal(leadX(4), 195);
  assert.equal(leadX(T), 195);
});

test('lead starts at x = 30 on the avenue and ends at (195, 360)', () => {
  const start = carPose('lead', 0);
  close(start.x, 30, 1e-6);
  close(start.y, avenueY(30), 1e-6);
  const end = carPose('lead', T);
  close(end.x, LEAD_FINAL.x, 1e-6);
  close(end.y, LEAD_FINAL.y, 1e-6);
  assert.deepEqual(LEAD_FINAL, { x: 195, y: 360 });

  const tracks = carTracks();
  const lead = tracks.lead;
  close(lead.x[0], 30, 1e-6);
  close(lead.x[lead.x.length - 1], 195, 1e-6);
  close(lead.y[lead.y.length - 1], 360, 1e-6);
});

test('feeders start on their own streets', () => {
  close(carPose('f2', 0).x, 40, 1e-6);
  close(carPose('f2', 0).y, 578, 1e-6);
  close(carPose('f1', 0).x, -12, 1e-6);
  close(carPose('f1', 0).y, 470, 1e-6);
  close(carPose('f3', 0).x, 110, 1e-6);
  close(carPose('f3', 0).y, 578, 1e-6);
  // f1 and f3 wait at their start until their start time.
  close(carPose('f1', 0.3).x, -12, 1e-6);
  close(carPose('f3', 0.7).y, 578, 1e-6);
});

test('each feeder vanishes within 1 px of the lead at its vanish time', () => {
  for (const id of FEEDER_IDS) {
    const tv = FEEDERS[id].tVanish;
    const f = carPose(id, tv);
    const l = carPose('lead', tv);
    const d = Math.hypot(f.x - l.x, f.y - l.y);
    assert.ok(d <= 1, `${id}: ${d.toFixed(3)} px from lead`);
    assert.equal(f.opacity, 1, `${id} still visible at the vanish instant`);
    assert.equal(carPose(id, tv + 0.05).opacity, 0, `${id} gone shortly after`);
  }
});

test('at each join the feeder is at least 52 px behind the lead along the avenue (car length 50)', () => {
  assert.equal(CAR.height, 50);
  for (const id of FEEDER_IDS) {
    const { tJoin, joinX } = FEEDERS[id];
    const f = carPose(id, tJoin);
    close(f.x, joinX, 1e-6, `${id} at its junction`);
    close(f.y, avenueY(joinX), 1e-6);
    const gap = avenueDistance(leadX(tJoin)) - avenueDistance(f.x);
    assert.ok(gap >= 52, `${id}: gap ${gap.toFixed(2)} px`);
  }
});

test('feeders keep a constant speed on their street until the join, then ease in', () => {
  const f = FEEDERS.f2;
  const a = carPose('f2', f.tStart + 0.2);
  const b = carPose('f2', f.tStart + 0.4);
  const c = carPose('f2', f.tStart + 0.6);
  close(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - b.x, c.y - b.y), 0.5);
  // Ease-in: the first half of join→vanish covers less ground than the second.
  const tm = (f.tJoin + f.tVanish) / 2;
  const j = carPose('f2', f.tJoin);
  const m = carPose('f2', tm);
  const v = carPose('f2', f.tVanish);
  assert.ok(Math.hypot(m.x - j.x, m.y - j.y) < Math.hypot(v.x - m.x, v.y - m.y));
});

test('rotation follows the heading: up = 0deg, avenue ≈ its heading', () => {
  close(carPose('lead', 1).rotation, AVENUE_HEADING_DEG, 0.01);
  close(carPose('f2', 0.2).rotation, 0, 0.01); // driving up
  close(carPose('f1', 0.5).rotation, 90, 0.01); // driving right
  close(carPose('f3', 1).rotation, 0, 0.01);
  for (const id of FEEDER_IDS) close(carPose(id, FEEDERS[id].tVanish).rotation, AVENUE_HEADING_DEG, 1, id);
});

test('car tracks: ≥120 strictly increasing samples over 0..1 with matching outputs', () => {
  const tracks = carTracks();
  for (const id of ['lead', ...FEEDER_IDS] as const) {
    const t = tracks[id];
    assert.ok(t.inputRange.length >= 120, `${id} samples`);
    assert.equal(t.inputRange[0], 0);
    assert.equal(t.inputRange[t.inputRange.length - 1], 1);
    strictlyIncreasing(t.inputRange, id);
    for (const arr of [t.x, t.y, t.rotate, t.opacity]) assert.equal(arr.length, t.inputRange.length);
    const angles = t.rotate.map(deg);
    for (let i = 1; i < angles.length; i++) assert.ok(Math.abs(angles[i] - angles[i - 1]) < 90, `${id} rotation unwrapped`);
  }
  // The lead's rotation on the avenue is the avenue's heading.
  close(deg(tracks.lead.rotate[10]), AVENUE_HEADING_DEG, 0.01);
  // The lead fades out 0.70 → 0.76.
  const lead = tracks.lead;
  const at = (p: number) => lead.opacity[lead.inputRange.findIndex((x) => x >= p - 1e-9)];
  assert.equal(at(0.7), 1);
  assert.equal(at(0.76), 0);
});

test('badge windows: 2, 3 then 4 riders, appearing as each feeder merges', () => {
  const badges = badgeTracks();
  assert.deepEqual(
    badges.map((b) => b.riders),
    [2, 3, 4],
  );
  const order = ['f2', 'f1', 'f3'] as const;
  badges.forEach((b, i) => {
    strictlyIncreasing(b.inputRange, `badge ${b.riders}`);
    assert.equal(b.opacity.length, b.inputRange.length);
    assert.equal(b.scale.length, b.inputRange.length);
    assert.equal(b.opacity[0], 0);
    assert.equal(b.opacity[b.opacity.length - 1], 0);
    const shownAt = b.inputRange[b.opacity.indexOf(1)];
    assert.ok(shownAt > FEEDERS[order[i]].tVanish / T, `badge ${b.riders} after its merge`);
  });
  // Windows don't overlap: each badge is gone before the next one starts to show.
  for (let i = 0; i < badges.length - 1; i++) {
    const lastOn = badges[i].inputRange[badges[i].opacity.lastIndexOf(1)];
    const nextStart = badges[i + 1].inputRange[badges[i + 1].opacity.findIndex((o, k) => k > 0 && o > 0) - 1];
    assert.ok(lastOn <= nextStart, `badge ${badges[i].riders} overlaps ${badges[i + 1].riders}`);
  }
});

test('cubicBezier matches the endpoints and is monotonic', () => {
  const ease = cubicBezier(0.55, 0, 1, 1);
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  let prev = 0;
  for (let i = 1; i <= 100; i++) {
    const v = ease(i / 100);
    assert.ok(v >= prev);
    prev = v;
  }
  assert.ok(ease(0.5) < 0.5, 'ease-in is below the diagonal');
});

test('scaleAroundPoint keeps the focus point fixed when RN scales around the view centre', () => {
  const center = { x: 201, y: 437 };
  const focus = { x: 201, y: 371 };
  for (const k of [1, 1.7, 2.4]) {
    const { translateX, translateY } = scaleAroundPoint(focus, center, k);
    // RN applies [translate, scale] around the centre: p' = c + t + k(p − c)
    close(center.x + translateX + k * (focus.x - center.x), focus.x, 1e-9);
    close(center.y + translateY + k * (focus.y - center.y), focus.y, 1e-9);
  }
});

test('map zoom: scale 1 → 2.4 between 0.66 and 0.80 around the lead’s final point', () => {
  const view = { width: 402, height: 874 };
  const unit = 402 / 390;
  const z = mapZoomTrack(view, unit);
  strictlyIncreasing(z.inputRange, 'zoom');
  const at = (p: number) => z.inputRange.findIndex((x) => Math.abs(x - p) < 1e-9);
  assert.equal(z.scale[0], 1);
  assert.equal(z.scale[at(0.66)], 1);
  close(z.scale[at(0.8)], 2.4, 1e-9);
  assert.equal(z.scale[z.scale.length - 1], 2.4);
  const fx = 195 * unit;
  const fy = 360 * unit;
  z.inputRange.forEach((_, i) => {
    const k = z.scale[i];
    close(view.width / 2 + z.translateX[i] + k * (fx - view.width / 2), fx, 1e-6);
    close(view.height / 2 + z.translateY[i] + k * (fy - view.height / 2), fy, 1e-6);
  });
});

test('overlay tracks: sheet, chip, logo tile and cover keyframes', () => {
  const o = overlayTracks();
  const value = (track: { inputRange: number[]; output: number[] }, p: number) => {
    const i = track.inputRange.findIndex((x) => Math.abs(x - p) < 1e-9);
    assert.ok(i >= 0, `keyframe ${p} present`);
    return track.output[i];
  };
  for (const track of [o.sheet, o.chipOpacity, o.markOpacity, o.markScale, o.coverOpacity]) {
    strictlyIncreasing(track.inputRange, 'overlay');
    assert.equal(track.inputRange[0], 0);
    assert.equal(track.inputRange[track.inputRange.length - 1], 1);
    assert.equal(track.output.length, track.inputRange.length);
  }
  assert.equal(value(o.sheet, 0), 0);
  assert.equal(value(o.sheet, 0.09), 1);
  assert.equal(value(o.chipOpacity, 0), 1);
  assert.equal(value(o.chipOpacity, 0.06), 0);
  assert.equal(value(o.markOpacity, 0.7), 0);
  assert.equal(value(o.markOpacity, 0.78), 1);
  assert.equal(value(o.markScale, 0.78), 1);
  assert.equal(value(o.markScale, 0.8), 1);
  assert.equal(value(o.markScale, 0.92), 16);
  assert.equal(value(o.markScale, 0.97), 22);
  assert.equal(value(o.markOpacity, 0.97), 0);
  assert.equal(value(o.coverOpacity, 0.86), 0);
  assert.equal(value(o.coverOpacity, 1), 1);
});
