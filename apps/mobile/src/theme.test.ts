import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colors } from './theme';

function channels(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`Not a #rrggbb color: ${hex}`);
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

// WCAG 2.x relative luminance and contrast ratio.
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function hue(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

test('danger is a red, never the green brand', () => {
  const h = hue(colors.danger);
  assert.ok(h >= 345 || h <= 15, `danger hue ${h.toFixed(0)}° is not red`);
  assert.notEqual(colors.danger, colors.primary);
  assert.notEqual(colors.danger, colors.accent);
});

test('danger text meets WCAG AA (4.5:1) on every surface it appears on', () => {
  for (const bg of [colors.background, colors.surface, colors.dangerBg]) {
    assert.ok(contrast(colors.danger, bg) >= 4.5, `danger on ${bg} is ${contrast(colors.danger, bg).toFixed(2)}:1`);
  }
});
