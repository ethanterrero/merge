import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAP_KEY_ENV, chooseRenderer, readMapKey, redactKey, stadiaStyleUrl, withStadiaKey } from './provider';

const KEY = '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b';

test('the display key comes from one public Expo variable', () => {
  assert.equal(MAP_KEY_ENV, 'EXPO_PUBLIC_STADIA_KEY');
});

test('readMapKey treats missing, blank and placeholder values as no key', () => {
  assert.equal(readMapKey(undefined), null);
  assert.equal(readMapKey(''), null);
  assert.equal(readMapKey('   '), null);
  assert.equal(readMapKey('<your key>'), null);
  assert.equal(readMapKey('"abc"'), null);
  assert.equal(readMapKey('has space inside'), null);
  assert.equal(readMapKey('short'), null);
});

test('readMapKey treats obvious placeholders as no key', () => {
  for (const placeholder of [
    'undefined',
    'null',
    'NULL',
    'none',
    'changeme',
    'changeme123',
    'change-me',
    'your-stadia-key',
    'YOUR-API-KEY',
    'your_key_here',
    'stadia-key-here',
    'placeholder',
    'my-placeholder-key',
    'example-key',
    'test-key-1234',
    'xxxxxxxxxxxx',
    'XXXXXXXX-XXXX',
    '00000000',
    '00000000-0000-0000-0000-000000000000',
    'todo-fill-me-in',
    'replace_me',
    'insert-key',
    'api_key',
    'apikey12',
    'stadia_key',
    'EXPO_PUBLIC_STADIA_KEY',
  ]) {
    assert.equal(readMapKey(placeholder), null, placeholder);
  }
});

test('readMapKey keeps a well-formed key, trimmed', () => {
  assert.equal(readMapKey(KEY), KEY);
  assert.equal(readMapKey(`  ${KEY}\n`), KEY);
});

test('no key means the stylized fallback on every platform', () => {
  for (const platform of ['ios', 'android', 'web'] as const) {
    assert.deepEqual(chooseRenderer({ key: null, platform, nativeMapAvailable: true }), { kind: 'fallback', reason: 'no-key' });
  }
});

test('native platforms need the MapLibre native module (missing in Expo Go)', () => {
  assert.deepEqual(chooseRenderer({ key: KEY, platform: 'ios', nativeMapAvailable: true }), { kind: 'native' });
  assert.deepEqual(chooseRenderer({ key: KEY, platform: 'android', nativeMapAvailable: true }), { kind: 'native' });
  assert.deepEqual(chooseRenderer({ key: KEY, platform: 'ios', nativeMapAvailable: false }), {
    kind: 'fallback',
    reason: 'no-native-module',
  });
});

test('web uses maplibre-gl when there is a key', () => {
  assert.deepEqual(chooseRenderer({ key: KEY, platform: 'web', nativeMapAvailable: false }), { kind: 'web' });
});

test('other platforms fall back', () => {
  assert.deepEqual(chooseRenderer({ key: KEY, platform: 'windows', nativeMapAvailable: false }), {
    kind: 'fallback',
    reason: 'unsupported-platform',
  });
});

test('stadiaStyleUrl points at a Stadia style with the key encoded', () => {
  assert.equal(stadiaStyleUrl(KEY), `https://tiles.stadiamaps.com/styles/alidade_smooth.json?api_key=${KEY}`);
  assert.equal(stadiaStyleUrl('a+b/c'), 'https://tiles.stadiamaps.com/styles/alidade_smooth.json?api_key=a%2Bb%2Fc');
});

test('withStadiaKey adds the key to Stadia requests only', () => {
  assert.equal(
    withStadiaKey('https://tiles.stadiamaps.com/data/openmaptiles/1/2/3.pbf', KEY),
    `https://tiles.stadiamaps.com/data/openmaptiles/1/2/3.pbf?api_key=${KEY}`,
  );
  assert.equal(
    withStadiaKey('https://tiles.stadiamaps.com/fonts/x/0-255.pbf?v=2', KEY),
    `https://tiles.stadiamaps.com/fonts/x/0-255.pbf?v=2&api_key=${KEY}`,
  );
});

test('withStadiaKey never sends the key anywhere else', () => {
  for (const url of [
    'https://example.com/tiles/1/2/3.pbf',
    'https://stadiamaps.com.evil.example/x.pbf',
    'https://evilstadiamaps.com/x.pbf',
    'http://tiles.stadiamaps.com/x.pbf',
    'not a url',
  ]) {
    assert.equal(withStadiaKey(url, KEY), url, url);
  }
});

test('withStadiaKey leaves a URL that already carries a key alone', () => {
  const url = `https://tiles.stadiamaps.com/styles/alidade_smooth.json?api_key=${KEY}`;
  assert.equal(withStadiaKey(url, KEY), url);
});

test('redactKey strips api_key values from URLs and error messages', () => {
  assert.equal(
    redactKey(`AJAXError: Unauthorized (401): https://tiles.stadiamaps.com/styles/alidade_smooth.json?api_key=${KEY}`),
    'AJAXError: Unauthorized (401): https://tiles.stadiamaps.com/styles/alidade_smooth.json?api_key=[redacted]',
  );
  assert.equal(
    redactKey(`https://tiles.stadiamaps.com/fonts/x.pbf?v=2&api_key=${KEY}&z=1 and ?API_KEY=${KEY}`),
    'https://tiles.stadiamaps.com/fonts/x.pbf?v=2&api_key=[redacted]&z=1 and ?API_KEY=[redacted]',
  );
  assert.equal(redactKey(`api_key%3D${KEY}`), 'api_key%3D[redacted]', 'URL-encoded inside another URL');
  assert.equal(redactKey('no key here'), 'no key here');
});

test('redactKey also removes the key itself wherever it appears', () => {
  assert.equal(redactKey(`Stadia-Auth ${KEY} failed`, KEY), 'Stadia-Auth [redacted] failed');
  assert.equal(redactKey('nothing', null), 'nothing');
});
