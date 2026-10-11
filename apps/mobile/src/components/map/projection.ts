// Screen projection for the stylized fallback map, which has no tiles. Pure:
// `npm test` runs it under Node.

import type { Bounds, LatLng } from './areas';

export type Frame = { width: number; height: number };
export type Insets = { top: number; right: number; bottom: number; left: number };
export type Point = { x: number; y: number };

export type Projection = {
  project: (p: LatLng) => Point;
  /** Screen pixels per meter on the ground, for drawing radii. */
  pxPerMeter: number;
};

const M_PER_DEG_LAT = (Math.PI * 6_371_008.8) / 180;

/**
 * Fits `bounds` into the part of `frame` inside `insets`, north up, centered,
 * the same way the real map's camera fits them. Equirectangular, scaled at the
 * middle latitude, which is plenty for a few kilometers of Bay Area.
 */
export function fitProjection(bounds: Bounds, frame: Frame, insets: Insets): Projection {
  const [west, south, east, north] = bounds;
  const midLat = (south + north) / 2;
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);
  const spanX = Math.max(1, (east - west) * mPerDegLng);
  const spanY = Math.max(1, (north - south) * M_PER_DEG_LAT);
  const availW = Math.max(1, frame.width - insets.left - insets.right);
  const availH = Math.max(1, frame.height - insets.top - insets.bottom);
  const pxPerMeter = Math.min(availW / spanX, availH / spanY);
  const cx = insets.left + availW / 2;
  const cy = insets.top + availH / 2;
  const midLng = (west + east) / 2;
  return {
    pxPerMeter,
    project: ({ lat, lng }) => ({
      x: cx + (lng - midLng) * mPerDegLng * pxPerMeter,
      y: cy - (lat - midLat) * M_PER_DEG_LAT * pxPerMeter,
    }),
  };
}

/**
 * A bar of `thickness` from `a` to `b`, as an unrotated box centered on the
 * midpoint plus the angle to rotate it by (around its center).
 */
export function segmentBox(a: Point, b: Point, thickness: number) {
  const width = Math.hypot(b.x - a.x, b.y - a.y);
  const angleDeg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  return { left: mx - width / 2, top: my - thickness / 2, width, height: thickness, angleDeg };
}
