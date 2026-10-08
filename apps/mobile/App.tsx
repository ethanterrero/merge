import React, { useEffect } from 'react';
import { BackHandler } from 'react-native';
import { NavigationProvider, Route, useNav } from './src/navigation';
import { CommuteProvider } from './src/state/commute';
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

export default function App() {
  return (
    <CommuteProvider>
      <NavigationProvider initial={{ name: 'welcome' }}>
        <Router />
      </NavigationProvider>
    </CommuteProvider>
  );
}

function Router() {
  const nav = useNav();

  // Android hardware back pops the in-app stack before leaving the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!nav.canGoBack) return false;
      nav.back();
      return true;
    });
    return () => sub.remove();
  }, [nav]);

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
  }
}
