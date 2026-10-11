import React, { useEffect, useState } from 'react';
import { BackHandler } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { NavigationProvider, Route, useNav } from './src/navigation';
import { CommuteProvider } from './src/state/commute';
import { AuthProvider, useAuth } from './src/state/auth';
import { launchRoute, mustLeaveRoute } from './src/lib/authRules';
import { LoadingScreen } from './src/screens/LoadingScreen';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import { VerifyCodeScreen } from './src/screens/VerifyCodeScreen';
import { ProfileNameScreen } from './src/screens/ProfileNameScreen';
import { CommuteScreen } from './src/screens/CommuteScreen';
import { PreferencesScreen } from './src/screens/PreferencesScreen';
import { DiscoverScreen } from './src/screens/DiscoverScreen';
import { MatchDetailScreen } from './src/screens/MatchDetailScreen';
import { RequestRideScreen } from './src/screens/RequestRideScreen';
import { BookedScreen } from './src/screens/BookedScreen';
import { DriverRequestsScreen } from './src/screens/DriverRequestsScreen';
import { DriverRequestScreen } from './src/screens/DriverRequestScreen';
import { DriverConfirmScreen } from './src/screens/DriverConfirmScreen';
import { RoleScreen } from './src/screens/RoleScreen';
import { VehicleScreen } from './src/screens/VehicleScreen';

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AuthProvider>
        <CommuteProvider>
          <AuthGate />
        </CommuteProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

/**
 * Waits for the stored session and profile, then picks the first screen once.
 * Later status changes don't remount navigation, so onboarding isn't interrupted.
 */
function AuthGate() {
  const { status } = useAuth();
  const [initial, setInitial] = useState<Route | null>(() => (status === 'loading' ? null : { name: launchRoute(status) }));

  useEffect(() => {
    if (initial === null && status !== 'loading') {
      // Typed as Route first: TS won't match { name: 'welcome' | 'discover' } to setState's value-or-updater parameter.
      const first: Route = { name: launchRoute(status) };
      setInitial(first);
    }
  }, [status, initial]);

  if (initial === null) return <LoadingScreen />;
  return (
    <NavigationProvider initial={initial}>
      <Router />
    </NavigationProvider>
  );
}

function Router() {
  const nav = useNav();
  const { status } = useAuth();

  // Android hardware back pops the in-app stack before leaving the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!nav.canGoBack) return false;
      nav.back();
      return true;
    });
    return () => sub.remove();
  }, [nav]);

  // Signing out, or a session ending elsewhere, returns to Welcome.
  useEffect(() => {
    if (mustLeaveRoute(status, nav.route.name)) nav.reset({ name: 'welcome' });
  }, [status, nav]);

  return renderRoute(nav.route);
}

function renderRoute(route: Route): React.ReactElement {
  switch (route.name) {
    case 'welcome':
      return <WelcomeScreen />;
    case 'signIn':
      return <SignInScreen />;
    case 'verifyCode':
      return <VerifyCodeScreen email={route.email} />;
    case 'profileName':
      return <ProfileNameScreen />;
    case 'commute':
      return <CommuteScreen />;
    case 'preferences':
      return <PreferencesScreen />;
    case 'discover':
      return <DiscoverScreen />;
    case 'match':
      return <MatchDetailScreen matchId={route.matchId} />;
    case 'request':
      return <RequestRideScreen matchId={route.matchId} />;
    case 'booked':
      return <BookedScreen matchId={route.matchId} />;
    case 'driverRequests':
      return <DriverRequestsScreen key={route.tab ?? 'new'} initialTab={route.tab} />;
    case 'driverRequest':
      return <DriverRequestScreen requestId={route.requestId} />;
    case 'driverConfirm':
      return <DriverConfirmScreen requestId={route.requestId} />;
    case 'role':
      return <RoleScreen />;
    case 'vehicle':
      return <VehicleScreen />;
  }
}
