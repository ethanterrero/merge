import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AREA_RADIUS_M,
  areaRadius,
  areaSignature,
  areasBounds,
  areasFeatureCollection,
  circleRing,
  distanceM,
  isValidLatLng,
  southEdge,
  type MapArea,
} from './areas';

const PARK_ST = { lat: 37.768, lng: -122.24 };
const FIDI = { lat: 37.792, lng: -122.398 };

test('the area radius matches the server (public.area_radius_m() = 402 m)', () => {
  assert.equal(AREA_RADIUS_M, 402);
});

test('areaRadius never draws a circle smaller than a generalized area', () => {
  assert.equal(areaRadius(undefined), 402);
  assert.equal(areaRadius(0), 402);
  assert.equal(areaRadius(5), 402, 'a tiny radius would be a pin');
  assert.equal(areaRadius(-100), 402);
  assert.equal(areaRadius(Number.NaN), 402);
  assert.equal(areaRadius(Number.POSITIVE_INFINITY), 402);
  assert.equal(areaRadius(800), 800, 'a larger area is fine');
});

test('isValidLatLng accepts real coordinates and rejects junk', () => {
  assert.equal(isValidLatLng(PARK_ST), true);
  assert.equal(isValidLatLng({ lat: 91, lng: 0 }), false);
  assert.equal(isValidLatLng({ lat: 0, lng: 181 }), false);
  assert.equal(isValidLatLng({ lat: Number.NaN, lng: 0 }), false);
});

test('distanceM is close to known Bay Area distances', () => {
  const d = distanceM(PARK_ST, FIDI);
  assert.ok(d > 14_000 && d < 15_500, `Park St to FiDi was ${d} m`);
  assert.equal(distanceM(PARK_ST, PARK_ST), 0);
});

test('circleRing is a closed ring whose points sit on the radius', () => {
  const ring = circleRing(PARK_ST, 402, 48);
  assert.equal(ring.length, 49);
  assert.deepEqual(ring[0], ring[ring.length - 1]);
  for (const [lng, lat] of ring) {
    const d = distanceM(PARK_ST, { lat, lng });
    assert.ok(Math.abs(d - 402) < 1, `point at ${d} m`);
  }
});

test('southEdge is one radius due south of the center', () => {
  const s = southEdge(PARK_ST, 402);
  assert.ok(s.lat < PARK_ST.lat);
  assert.ok(Math.abs(s.lng - PARK_ST.lng) < 1e-9);
  assert.ok(Math.abs(distanceM(PARK_ST, s) - 402) < 0.5);
});

test('areasFeatureCollection emits one polygon per valid area, ids and style only', () => {
  const areas: MapArea[] = [
    { id: 'a', center: PARK_ST, tone: 'primary', emphasis: true, label: 'Park Street area' },
    { id: 'b', center: FIDI, tone: 'deep', dashed: true, radiusM: 3 },
    { id: 'bad', center: { lat: 200, lng: 0 } },
  ];
  const fc = areasFeatureCollection(areas);
  assert.equal(fc.type, 'FeatureCollection');
  assert.deepEqual(
    fc.features.map((f) => f.properties),
    [
      { id: 'a', tone: 'primary', emphasis: true, dashed: false },
      { id: 'b', tone: 'deep', emphasis: false, dashed: true },
    ],
  );
  assert.equal(fc.features[0].geometry.type, 'Polygon');
  // Area b asked for 3 m; it is still drawn at the generalized radius.
  const [lng, lat] = fc.features[1].geometry.coordinates[0][0];
  assert.ok(Math.abs(distanceM(FIDI, { lat, lng }) - 402) < 1);
});

test('areasFeatureCollection never puts a point geometry on the map', () => {
  const fc = areasFeatureCollection([{ id: 'a', center: PARK_ST }]);
  for (const f of fc.features) assert.equal(f.geometry.type, 'Polygon');
});

test('areasBounds covers every circle, not just the centers', () => {
  const b = areasBounds([
    { id: 'a', center: PARK_ST },
    { id: 'b', center: FIDI },
  ]);
  assert.ok(b);
  const [west, south, east, north] = b!;
  assert.ok(west < FIDI.lng && east > PARK_ST.lng);
  assert.ok(south < PARK_ST.lat && north > FIDI.lat);
  // The western edge is about one radius west of FiDi's center.
  const westGap = distanceM(FIDI, { lat: FIDI.lat, lng: west });
  assert.ok(Math.abs(westGap - 402) < 2, `west gap ${westGap}`);
});

test('areasBounds widens a lone area to the minimum span', () => {
  const b = areasBounds([{ id: 'a', center: PARK_ST }], 3000)!;
  const [west, south, east, north] = b;
  const width = distanceM({ lat: PARK_ST.lat, lng: west }, { lat: PARK_ST.lat, lng: east });
  const height = distanceM({ lat: south, lng: PARK_ST.lng }, { lat: north, lng: PARK_ST.lng });
  assert.ok(Math.abs(width - 3000) < 5, `width ${width}`);
  assert.ok(Math.abs(height - 3000) < 5, `height ${height}`);
  // Still centered on the area.
  assert.ok(Math.abs((west + east) / 2 - PARK_ST.lng) < 1e-9);
  assert.ok(Math.abs((south + north) / 2 - PARK_ST.lat) < 1e-9);
});

test('areasBounds is null when there is nothing valid to show', () => {
  assert.equal(areasBounds([]), null);
  assert.equal(areasBounds([{ id: 'x', center: { lat: Number.NaN, lng: 0 } }]), null);
});

test('areaSignature changes only when something drawn changes', () => {
  const a: MapArea = { id: 'a', center: PARK_ST, tone: 'primary' };
  assert.equal(areaSignature([a]), areaSignature([{ ...a }]));
  assert.notEqual(areaSignature([a]), areaSignature([{ ...a, center: FIDI }]));
  assert.notEqual(areaSignature([a]), areaSignature([{ ...a, tone: 'deep' }]));
  assert.notEqual(areaSignature([a]), areaSignature([{ ...a, label: 'Pickup' }]));
  assert.notEqual(areaSignature([a]), areaSignature([{ ...a, emphasis: true }]));
  assert.notEqual(areaSignature([a]), areaSignature([a, { ...a, id: 'b' }]));
});
