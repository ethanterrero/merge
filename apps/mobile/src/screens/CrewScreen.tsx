import React from 'react';
import { Screen, TopBar } from '../components/Screen';

// Placeholder: the real screen lands with M-28 Task 3.
export function CrewScreen({ matchId }: { matchId: string }) {
  void matchId;
  return <Screen header={<TopBar title="Commute Crew" />}>{null}</Screen>;
}
