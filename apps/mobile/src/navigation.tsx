import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * A deliberately tiny stack navigator so the UI prototype runs without extra
 * dependencies. Swap for React Navigation / Expo Router once routing needs
 * deep links, gestures or nested stacks.
 */
export type Route =
  | { name: 'welcome' }
  | { name: 'commute' }
  | { name: 'preferences' }
  | { name: 'discover' }
  | { name: 'match'; matchId: string }
  | { name: 'request'; matchId: string }
  | { name: 'booked'; matchId: string }
  | { name: 'driverRequests'; tab?: 'new' | 'upcoming' }
  | { name: 'driverRequest'; requestId: string }
  | { name: 'driverConfirm'; requestId: string };

export type RouteName = Route['name'];

type Nav = {
  route: Route;
  canGoBack: boolean;
  push: (route: Route) => void;
  back: () => void;
  /** Replace the whole stack, e.g. when switching tabs or finishing onboarding. */
  reset: (route: Route) => void;
};

const NavContext = createContext<Nav | null>(null);

export function NavigationProvider({ initial, children }: { initial: Route; children: React.ReactNode }) {
  const [stack, setStack] = useState<Route[]>([initial]);

  const push = useCallback((route: Route) => setStack((s) => [...s, route]), []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const reset = useCallback((route: Route) => setStack([route]), []);

  const value = useMemo<Nav>(
    () => ({ route: stack[stack.length - 1], canGoBack: stack.length > 1, push, back, reset }),
    [stack, push, back, reset],
  );

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav must be used inside NavigationProvider');
  return nav;
}
