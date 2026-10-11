import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AREA_FILL_LAYER_ID, areaLayers } from './layers';

const palette = { primary: '#111111', deep: '#222222' };

test('areas draw as a fill plus outlines, never as point symbols', () => {
  const layers = areaLayers(palette);
  assert.deepEqual(
    layers.map((l) => l.type),
    ['fill', 'line', 'line'],
  );
  assert.equal(layers[0].id, AREA_FILL_LAYER_ID);
});

test('solid and dashed outlines split the areas between them', () => {
  const [, solid, dashed] = areaLayers(palette);
  assert.deepEqual(solid.filter, ['!=', ['get', 'dashed'], true]);
  assert.deepEqual(dashed.filter, ['==', ['get', 'dashed'], true]);
  assert.ok(dashed.type === 'line' && dashed.paint?.['line-dasharray']);
});

test('colors come from the palette by tone', () => {
  const [fill] = areaLayers(palette);
  assert.ok(fill.type === 'fill');
  assert.deepEqual(fill.paint?.['fill-color'], ['match', ['get', 'tone'], 'deep', '#222222', '#111111']);
});
