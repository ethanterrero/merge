import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveStatus,
  digitsOnly,
  displayNameError,
  isCompleteCode,
  isValidEmail,
  launchRoute,
  mustLeaveRoute,
  normalizeDisplayName,
  normalizeEmail,
  sendCodeErrorMessage,
  welcomeNext,
} from './authRules';

test('normalizeEmail trims and lowercases', () => {
  assert.equal(normalizeEmail('  Priya@Example.COM '), 'priya@example.com');
});

test('isValidEmail accepts ordinary addresses and rejects malformed ones', () => {
  assert.equal(isValidEmail(' priya@example.com '), true);
  assert.equal(isValidEmail('priya.s+merge@work.example.co'), true);
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail('priya'), false);
  assert.equal(isValidEmail('priya@example'), false);
  assert.equal(isValidEmail('priya s@example.com'), false);
});

test('normalizeDisplayName trims and collapses inner spaces', () => {
  assert.equal(normalizeDisplayName('  Priya    S. '), 'Priya S.');
});

test('displayNameError enforces 2 to 40 characters after normalizing', () => {
  assert.equal(displayNameError(''), 'Enter at least 2 characters.');
  assert.equal(displayNameError('  P  '), 'Enter at least 2 characters.');
  assert.equal(displayNameError('Po'), null);
  assert.equal(displayNameError('Priya S.'), null);
  assert.equal(displayNameError('x'.repeat(40)), null);
  assert.equal(displayNameError('x'.repeat(41)), 'Use 40 characters or fewer.');
});

test('displayNameError counts characters, not UTF-16 code units, like the database check', () => {
  assert.equal(displayNameError('🚗'), 'Enter at least 2 characters.');
  assert.equal(displayNameError('🚗'.repeat(40)), null);
  assert.equal(displayNameError('🚗'.repeat(41)), 'Use 40 characters or fewer.');
});

test('digitsOnly strips non-digits and caps at 6', () => {
  assert.equal(digitsOnly('12 34-56'), '123456');
  assert.equal(digitsOnly('1234567'), '123456');
  assert.equal(digitsOnly('abc'), '');
});

test('isCompleteCode requires exactly 6 digits', () => {
  assert.equal(isCompleteCode('123456'), true);
  assert.equal(isCompleteCode('12345'), false);
  assert.equal(isCompleteCode('12345a'), false);
});

test('sendCodeErrorMessage distinguishes rate limits from other failures', () => {
  assert.equal(sendCodeErrorMessage({ status: 429 }), 'Too many codes requested. Try again in a few minutes.');
  assert.equal(sendCodeErrorMessage({ status: 500 }), "Couldn't send the code. Check your connection and try again.");
  assert.equal(sendCodeErrorMessage({}), "Couldn't send the code. Check your connection and try again.");
});

test('sendCodeErrorMessage reports addresses the server rejects as invalid emails', () => {
  assert.equal(sendCodeErrorMessage({ status: 400, code: 'email_address_invalid' }), 'Enter a valid email address.');
  assert.equal(sendCodeErrorMessage({ status: 422, code: 'validation_failed' }), 'Enter a valid email address.');
  assert.equal(
    sendCodeErrorMessage({ status: 429, code: 'over_email_send_rate_limit' }),
    'Too many codes requested. Try again in a few minutes.',
  );
});

test('deriveStatus', () => {
  const base = { configured: true, sessionLoaded: true, hasSession: true, profileLoaded: true, hasProfile: true };
  assert.equal(deriveStatus({ ...base, configured: false, sessionLoaded: false }), 'prototype');
  assert.equal(deriveStatus({ ...base, sessionLoaded: false }), 'loading');
  assert.equal(deriveStatus({ ...base, hasSession: false, profileLoaded: false, hasProfile: false }), 'signedOut');
  assert.equal(deriveStatus({ ...base, profileLoaded: false, hasProfile: false }), 'loading');
  assert.equal(deriveStatus({ ...base, hasProfile: false }), 'needsProfile');
  assert.equal(deriveStatus(base), 'ready');
});

test('launchRoute sends only ready users past Welcome', () => {
  assert.equal(launchRoute('ready'), 'discover');
  assert.equal(launchRoute('needsProfile'), 'welcome');
  assert.equal(launchRoute('signedOut'), 'welcome');
  assert.equal(launchRoute('prototype'), 'welcome');
});

test('welcomeNext picks the next onboarding step', () => {
  assert.equal(welcomeNext('signedOut'), 'signIn');
  assert.equal(welcomeNext('needsProfile'), 'profileName');
  assert.equal(welcomeNext('ready'), 'commute');
  assert.equal(welcomeNext('prototype'), 'commute');
});

test('mustLeaveRoute only moves signed-out people off signed-in screens', () => {
  assert.equal(mustLeaveRoute('signedOut', 'discover'), true);
  assert.equal(mustLeaveRoute('signedOut', 'commute'), true);
  assert.equal(mustLeaveRoute('signedOut', 'welcome'), false);
  assert.equal(mustLeaveRoute('signedOut', 'signIn'), false);
  assert.equal(mustLeaveRoute('signedOut', 'verifyCode'), false);
  assert.equal(mustLeaveRoute('signedOut', 'role'), false);
  assert.equal(mustLeaveRoute('ready', 'discover'), false);
  assert.equal(mustLeaveRoute('prototype', 'discover'), false);
});
