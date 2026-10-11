// Pure geometry for the area map. No react-native or expo imports: `npm test`
// runs this under Node.
//
// The map only ever draws generalized areas: a circle of at least
// AREA_RADIUS_M around an area center the server picked (M-18's random-offset
// center, never the exact pin). There is no point or pin geometry here.

export type LatLng = { lat: number; lng: number };

/** [west, south, east, north], the order MapLibre uses. */
export type Bounds = [west: number, south: number, east: number, north: number];

export type AreaTone = 'primary' | 'deep';

/** One generalized area on the map. */
export type MapArea = {
  id: string;
  /** The stored area center, never an exact address or pin. */
  center: LatLng;
  /** Defaults to, and is never drawn below, AREA_RADIUS_M. */
  radiusM?: number;
  /** A short tag drawn under the circle, for example "Pickup". */
  label?: string;
  tone?: AreaTone;
  emphasis?: boolean;
  dashed?: boolean;
};

/** Matches `public.area_radius_m()` (M-18): 402 m, so the circle is 0.5 mi wide. */
export const AREA_RADIUS_M = 402;

const EARTH_RADIUS_M = 6_371_008.8;
const M_PER_DEG_LAT = (Math.PI * EARTH_RADIUS_M) / 180;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** The radius to draw. Anything smaller than an area would act as a pin, so it's raised to one. */
export function areaRadius(radiusM: number | undefined): number {
  if (radiusM === undefined || !Number.isFinite(radiusM)) return AREA_RADIUS_M;
  return Math.max(AREA_RADIUS_M, radiusM);
}

export function isValidLatLng(p: LatLng): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

/** Great-circle distance in meters (haversine). */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function destination(from: LatLng, bearingRad: number, distM: number): LatLng {
  const d = distM / EARTH_RADIUS_M;
  const lat1 = toRad(from.lat);
  const lng1 = toRad(from.lng);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearingRad));
  const lng2 = lng1 + Math.atan2(Math.sin(bearingRad) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: toDeg(lat2), lng: toDeg(lng2) };
}

/** A closed polygon ring ([lng, lat] pairs) approximating the circle. */
export function circleRing(center: LatLng, radiusM: number, steps = 64): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const p = destination(center, (2 * Math.PI * i) / steps, radiusM);
    ring.push([p.lng, p.lat]);
  }
  ring.push(ring[0]);
  return ring;
}

/** The point on the circle due south of the center, where a label hangs. */
export function southEdge(center: LatLng, radiusM: number): LatLng {
  return { lat: center.lat - radiusM / M_PER_DEG_LAT, lng: center.lng };
}

export type AreaFeature = {
  type: 'Feature';
  id: string;
  properties: { id: string; tone: AreaTone; emphasis: boolean; dashed: boolean };
  geometry: { type: 'Polygon'; coordinates: [number, number][][] };
};

export type AreaFeatureCollection = { type: 'FeatureCollection'; features: AreaFeature[] };

/** GeoJSON polygons for the valid areas. Properties carry only the id and styling. */
export function areasFeatureCollection(areas: MapArea[]): AreaFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: areas
      .filter((a) => isValidLatLng(a.center))
      .map((a) => ({
        type: 'Feature',
        id: a.id,
        properties: { id: a.id, tone: a.tone ?? 'primary', emphasis: Boolean(a.emphasis), dashed: Boolean(a.dashed) },
        geometry: { type: 'Polygon', coordinates: [circleRing(a.center, areaRadius(a.radiusM))] },
      })),
  };
}

/**
 * The box around every circle (not only the centers), widened to at least
 * `minSpanM` on each side so a lone area isn't shown at street level.
 */
export function areasBounds(areas: MapArea[], minSpanM = 0): Bounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const a of areas) {
    if (!isValidLatLng(a.center)) continue;
    const r = areaRadius(a.radiusM);
    const dLat = r / M_PER_DEG_LAT;
    const dLng = dLat / Math.cos(toRad(a.center.lat));
    west = Math.min(west, a.center.lng - dLng);
    east = Math.max(east, a.center.lng + dLng);
    south = Math.min(south, a.center.lat - dLat);
    north = Math.max(north, a.center.lat + dLat);
  }
  if (!Number.isFinite(west)) return null;

  const midLat = (south + north) / 2;
  const midLng = (west + east) / 2;
  const minDLat = minSpanM / M_PER_DEG_LAT;
  const minDLng = minDLat / Math.cos(toRad(midLat));
  if (north - south < minDLat) {
    south = midLat - minDLat / 2;
    north = midLat + minDLat / 2;
  }
  if (east - west < minDLng) {
    west = midLng - minDLng / 2;
    east = midLng + minDLng / 2;
  }
  return [west, south, east, north];
}

/**
 * A string that changes only when something drawn changes. Screens rebuild
 * their area arrays on every render; maps key their updates on this instead.
 */
export function areaSignature(areas: MapArea[]): string {
  return areas
    .map((a) => [a.id, a.center.lat, a.center.lng, areaRadius(a.radiusM), a.label ?? '', a.tone ?? '', a.emphasis ? 1 : 0, a.dashed ? 1 : 0].join(':'))
    .join('|');
}
