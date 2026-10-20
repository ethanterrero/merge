import React from 'react';
import { Screen, TopBar } from '../components/Screen';

// Placeholder: the real screen lands with M-28 Task 3.
export function RideAgainScreen({ matchId }: { matchId: string }) {
  void matchId;
  return <Screen header={<TopBar title="Ride Again" />}>{null}</Screen>;
}
