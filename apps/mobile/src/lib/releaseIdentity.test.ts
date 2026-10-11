import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertStoreIdentity, isProductionBuild, placeholderIds } from './releaseIdentity';

const placeholder = {
  ios: { bundleIdentifier: 'invalid.placeholder.merge' },
  android: { package: 'invalid.placeholder.merge' },
};
const final = {
  ios: { bundleIdentifier: 'com.example.merge' },
  android: { package: 'com.example.merge' },
};

test('isProductionBuild: EXPO_PUBLIC_APP_ENV or the EAS profile set to production', () => {
  assert.equal(isProductionBuild({ EXPO_PUBLIC_APP_ENV: 'production' }), true);
  assert.equal(isProductionBuild({ EAS_BUILD_PROFILE: 'production' }), true);
  assert.equal(isProductionBuild({}), false);
  assert.equal(isProductionBuild({ EXPO_PUBLIC_APP_ENV: 'preview', EAS_BUILD_PROFILE: 'preview' }), false);
  assert.equal(isProductionBuild({ EXPO_PUBLIC_APP_ENV: 'development' }), false);
});

test('placeholderIds lists each key that still holds a placeholder', () => {
  assert.deepEqual(placeholderIds(placeholder), [
    'ios.bundleIdentifier = invalid.placeholder.merge',
    'android.package = invalid.placeholder.merge',
  ]);
  assert.deepEqual(placeholderIds({ ...final, android: placeholder.android }), [
    'android.package = invalid.placeholder.merge',
  ]);
  assert.deepEqual(placeholderIds(final), []);
  assert.deepEqual(placeholderIds({}), []);
});

test('assertStoreIdentity allows placeholders outside production', () => {
  assert.doesNotThrow(() => assertStoreIdentity(placeholder, {}));
  assert.doesNotThrow(() => assertStoreIdentity(placeholder, { EXPO_PUBLIC_APP_ENV: 'development' }));
  assert.doesNotThrow(() => assertStoreIdentity(placeholder, { EXPO_PUBLIC_APP_ENV: 'preview' }));
});

test('assertStoreIdentity blocks a production build with placeholder IDs', () => {
  assert.throws(() => assertStoreIdentity(placeholder, { EXPO_PUBLIC_APP_ENV: 'production' }), /D-10/);
  assert.throws(
    () => assertStoreIdentity({ ...final, ios: placeholder.ios }, { EAS_BUILD_PROFILE: 'production' }),
    /ios\.bundleIdentifier = invalid\.placeholder\.merge/,
  );
});

test('assertStoreIdentity allows a production build with final IDs', () => {
  assert.doesNotThrow(() => assertStoreIdentity(final, { EXPO_PUBLIC_APP_ENV: 'production' }));
});
