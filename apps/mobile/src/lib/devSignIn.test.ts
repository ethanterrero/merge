import { test } from 'node:test';
import assert from 'node:assert/strict';
import { devSignInAccount, devSignInErrorMessage } from './devSignIn';
import { assertNoDevSignIn, devSignInVarsSet, isReleaseConfig } from './devSignInGuard';

const dev = { isDev: true, appEnv: undefined, configured: true, email: 'Dev@Example.com ', password: 'pw' };

test('devSignInAccount: offered in a local dev bundle with both variables set', () => {
  assert.deepEqual(devSignInAccount(dev), { email: 'dev@example.com', password: 'pw' });
  assert.deepEqual(devSignInAccount({ ...dev, appEnv: 'development' }), { email: 'dev@example.com', password: 'pw' });
});

test('devSignInAccount: never offered outside __DEV__ or in a release build', () => {
  assert.equal(devSignInAccount({ ...dev, isDev: false }), null);
  assert.equal(devSignInAccount({ ...dev, appEnv: 'preview' }), null);
  assert.equal(devSignInAccount({ ...dev, appEnv: 'production' }), null);
});

test('devSignInAccount: needs Supabase config and both variables', () => {
  assert.equal(devSignInAccount({ ...dev, configured: false }), null);
  assert.equal(devSignInAccount({ ...dev, email: undefined }), null);
  assert.equal(devSignInAccount({ ...dev, email: '   ' }), null);
  assert.equal(devSignInAccount({ ...dev, password: undefined }), null);
  assert.equal(devSignInAccount({ ...dev, password: '' }), null);
});

test('devSignInErrorMessage: passes the Auth message through for the developer', () => {
  assert.equal(devSignInErrorMessage({ message: 'Invalid login credentials' }), 'Dev sign-in failed: Invalid login credentials');
  assert.equal(devSignInErrorMessage({}), 'Dev sign-in failed: unknown error');
});

test('isReleaseConfig: preview or production APP_ENV, or a non-development EAS profile', () => {
  assert.equal(isReleaseConfig({}), false);
  assert.equal(isReleaseConfig({ EXPO_PUBLIC_APP_ENV: '' }), false);
  assert.equal(isReleaseConfig({ EXPO_PUBLIC_APP_ENV: 'development', EAS_BUILD_PROFILE: 'development' }), false);
  assert.equal(isReleaseConfig({ EXPO_PUBLIC_APP_ENV: 'preview' }), true);
  assert.equal(isReleaseConfig({ EXPO_PUBLIC_APP_ENV: 'production' }), true);
  assert.equal(isReleaseConfig({ EAS_BUILD_PROFILE: 'preview' }), true);
  assert.equal(isReleaseConfig({ EAS_BUILD_PROFILE: 'production' }), true);
});

test('devSignInVarsSet lists only the non-empty dev sign-in variables', () => {
  assert.deepEqual(devSignInVarsSet({}), []);
  assert.deepEqual(devSignInVarsSet({ EXPO_PUBLIC_DEV_SIGN_IN_EMAIL: '' }), []);
  assert.deepEqual(devSignInVarsSet({ EXPO_PUBLIC_DEV_SIGN_IN_PASSWORD: 'pw' }), ['EXPO_PUBLIC_DEV_SIGN_IN_PASSWORD']);
});

test('assertNoDevSignIn: blocks a release build that would bundle the dev account', () => {
  const vars = { EXPO_PUBLIC_DEV_SIGN_IN_EMAIL: 'dev@example.com', EXPO_PUBLIC_DEV_SIGN_IN_PASSWORD: 'pw' };
  assert.throws(() => assertNoDevSignIn({ ...vars, EXPO_PUBLIC_APP_ENV: 'preview' }), /EXPO_PUBLIC_DEV_SIGN_IN_EMAIL/);
  assert.throws(() => assertNoDevSignIn({ ...vars, EAS_BUILD_PROFILE: 'production' }), /Release build blocked/);
  assert.doesNotThrow(() => assertNoDevSignIn(vars));
  assert.doesNotThrow(() => assertNoDevSignIn({ ...vars, EXPO_PUBLIC_APP_ENV: 'development' }));
  assert.doesNotThrow(() => assertNoDevSignIn({ EXPO_PUBLIC_APP_ENV: 'production' }));
});
