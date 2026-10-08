import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  crewStatusAfter,
  resolveConnection,
  type ConnectionOutcome,
  type CrewStatus,
  type RideAgainAnswer,
} from './connection';

const ANSWERS: (RideAgainAnswer | null)[] = ['yes', 'individual', 'no', null];
const CREW_STATUSES: CrewStatus[] = ['proposed', 'active', 'paused', 'ended', 'not_started'];

test('resolveConnection covers every pair of answers, including missing ones', () => {
  // Rows are mine, columns are theirs, in ANSWERS order.
  const expected: ConnectionOutcome[][] = [
    ['ride_again_crew_eligible', 'ride_again', 'none', 'none'],
    ['ride_again', 'ride_again', 'none', 'none'],
    ['none', 'none', 'none', 'none'],
    ['none', 'none', 'none', 'none'],
  ];
  ANSWERS.forEach((mine, i) => {
    ANSWERS.forEach((theirs, j) => {
      assert.equal(resolveConnection(mine, theirs), expected[i][j], `mine=${mine} theirs=${theirs}`);
    });
  });
});

test('resolveConnection is symmetric', () => {
  for (const mine of ANSWERS) {
    for (const theirs of ANSWERS) {
      assert.equal(resolveConnection(mine, theirs), resolveConnection(theirs, mine), `mine=${mine} theirs=${theirs}`);
    }
  }
});

test('resolveConnection never tells "no" apart from "not answered"', () => {
  for (const mine of ANSWERS) {
    assert.equal(resolveConnection(mine, 'no'), resolveConnection(mine, null), `mine=${mine}`);
    assert.equal(resolveConnection('no', mine), resolveConnection(null, mine), `theirs=${mine}`);
  }
});

test('crewStatusAfter covers every outcome and Crew status', () => {
  const expected: Record<ConnectionOutcome, Record<CrewStatus, CrewStatus>> = {
    none: { proposed: 'ended', active: 'ended', paused: 'ended', ended: 'ended', not_started: 'not_started' },
    ride_again: { proposed: 'not_started', active: 'active', paused: 'paused', ended: 'ended', not_started: 'not_started' },
    ride_again_crew_eligible: {
      proposed: 'proposed',
      active: 'active',
      paused: 'paused',
      ended: 'ended',
      not_started: 'not_started',
    },
  };
  for (const outcome of Object.keys(expected) as ConnectionOutcome[]) {
    for (const current of CREW_STATUSES) {
      assert.equal(crewStatusAfter(outcome, current), expected[outcome][current], `outcome=${outcome} current=${current}`);
    }
  }
});
