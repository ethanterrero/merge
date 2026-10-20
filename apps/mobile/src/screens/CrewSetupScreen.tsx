import React from 'react';
import { Screen, TopBar } from '../components/Screen';

// Placeholder: the real screen lands with M-28 Task 3.
export function CrewSetupScreen({ matchId }: { matchId: string }) {
  void matchId;
  return <Screen header={<TopBar title="Set up a Crew" />}>{null}</Screen>;
}
