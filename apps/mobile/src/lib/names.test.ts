import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicName } from './names';

// The same cases as public_name in supabase/tests/member_status_test.sql (section 4).
const CASES: [string | null, string | null][] = [
  ['Priya Sharma', 'Priya S.'],
  ['Priya', 'Priya'],
  ['  Priya   Sharma  ', 'Priya S.'],
  ['Priya Devi Sharma', 'Priya S.'],
  ['priya sharma', 'priya S.'],
  ['Priya S.', 'Priya S.'],
  ['Priya\tSharma\n', 'Priya S.'],
  ["Mary-Jane O'Neil", 'Mary-Jane O.'],
  ['Priya (Sharma)', 'Priya S.'],
  ['Priya ...', 'Priya'],
  ['Zoë Ångström', 'Zoë Å.'],
  ['   ', null],
  ['', null],
  [null, null],
];

for (const [input, expected] of CASES) {
  test(`publicName(${JSON.stringify(input)}) is ${JSON.stringify(expected)}`, () => {
    assert.equal(publicName(input), expected);
  });
}

test('publicName of undefined is null', () => {
  assert.equal(publicName(undefined), null);
});

test('publicName drops a last word that is only an emoji', () => {
  assert.equal(publicName('Priya 🚗'), 'Priya');
});
