import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MAP_ATTRIBUTION, attributionText } from './attribution';

test('the attribution reads exactly as D-08 requires', () => {
  assert.equal(attributionText(), '© Stadia Maps © OpenMapTiles © OpenStreetMap contributors');
});

test('every credit links to its source over HTTPS', () => {
  assert.deepEqual(
    MAP_ATTRIBUTION.map((a) => a.url),
    ['https://stadiamaps.com/', 'https://openmaptiles.org/', 'https://www.openstreetmap.org/copyright'],
  );
});

test('the in-app attribution matches site/attributions.html (M-40)', () => {
  const html = readFileSync(resolve(__dirname, '../../../../../site/attributions.html'), 'utf8');
  const mapSection = html.slice(html.indexOf('id="map"'), html.indexOf('id="boundaries"'));
  assert.ok(mapSection.length > 0, 'the attributions page has a Map section');
  for (const { label, url } of MAP_ATTRIBUTION) {
    const name = label.replace(/^© /, '');
    assert.ok(mapSection.includes(`© <a href="${url}">${name}</a>`), `site credits ${label} at ${url}`);
  }
});
