import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitProjection, segmentBox } from './projection';
import { areasBounds } from './areas';

const PARK_ST = { lat: 37.768, lng: -122.24 };
const WEST_END = { lat: 37.776, lng: -122.278 };

const near = (a: number, b: number, tol = 0.5) => Math.abs(a - b) <= tol;

test('fitProjection fits the bounds inside the inset frame and keeps north up', () => {
  const bounds = areasBounds([
    { id: 'a', center: PARK_ST },
    { id: 'b', center: WEST_END },
  ])!;
  const frame = { width: 390, height: 600 };
  const insets = { top: 120, right: 16, bottom: 240, left: 16 };
  const p = fitProjection(bounds, frame, insets);
  const [west, south, east, north] = bounds;
  const nw = p.project({ lat: north, lng: west });
  const se = p.project({ lat: south, lng: east });
  assert.ok(nw.x >= 16 - 0.5 && se.x <= 390 - 16 + 0.5, `x ${nw.x}..${se.x}`);
  assert.ok(nw.y >= 120 - 0.5 && se.y <= 600 - 240 + 0.5, `y ${nw.y}..${se.y}`);
  // One axis is tight against the frame (fit, not just contained).
  assert.ok(near(se.x - nw.x, 390 - 32) || near(se.y - nw.y, 600 - 360));
  // East is right, north is up.
  assert.ok(p.project(PARK_ST).x > p.project(WEST_END).x);
  assert.ok(p.project(PARK_ST).y > p.project(WEST_END).y);
});

test('fitProjection centers the bounds in the frame', () => {
  const bounds: [number, number, number, number] = [-122.3, 37.76, -122.2, 37.78];
  const p = fitProjection(bounds, { width: 400, height: 400 }, { top: 0, right: 0, bottom: 0, left: 0 });
  const c = p.project({ lat: 37.77, lng: -122.25 });
  assert.ok(near(c.x, 200, 1) && near(c.y, 200, 1), `${c.x},${c.y}`);
});

test('pxPerMeter scales an area radius the same way as positions', () => {
  const bounds: [number, number, number, number] = [-122.3, 37.76, -122.2, 37.78];
  const p = fitProjection(bounds, { width: 400, height: 400 }, { top: 0, right: 0, bottom: 0, left: 0 });
  const a = p.project({ lat: 37.77, lng: -122.25 });
  // 0.01° of latitude is about 1112 m.
  const b = p.project({ lat: 37.78, lng: -122.25 });
  assert.ok(near(Math.abs(a.y - b.y), 1112 * p.pxPerMeter, 1.5));
});

test('fitProjection survives a frame smaller than its insets', () => {
  const p = fitProjection([-122.3, 37.76, -122.2, 37.78], { width: 10, height: 10 }, { top: 20, right: 20, bottom: 20, left: 20 });
  assert.ok(Number.isFinite(p.pxPerMeter) && p.pxPerMeter > 0);
});

test('segmentBox describes a rotated bar between two points', () => {
  const box = segmentBox({ x: 0, y: 0 }, { x: 100, y: 0 }, 4);
  assert.deepEqual(box, { left: 0, top: -2, width: 100, height: 4, angleDeg: 0 });
  const diag = segmentBox({ x: 0, y: 0 }, { x: 30, y: 40 }, 2);
  assert.equal(diag.width, 50);
  assert.ok(near(diag.angleDeg, 53.13, 0.01));
  // The bar is centered on the midpoint before rotation.
  assert.ok(near(diag.left + diag.width / 2, 15, 1e-9) && near(diag.top + diag.height / 2, 20, 1e-9));
});
