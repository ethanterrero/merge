# Pilot builds: EAS profiles and owner steps

Merge is built with [EAS Build](https://docs.expo.dev/build/introduction/). The repo carries the build profiles (`apps/mobile/eas.json`) and the release app config (`apps/mobile/app.json`). The owner runs every step that needs an Expo, Apple or Google account (O-07). Agents never run `eas init`, `eas build`, `eas submit` or `eas login`.

## Profiles

| Profile | What it builds | Distribution | `EXPO_PUBLIC_APP_ENV` | EAS environment |
| --- | --- | --- | --- | --- |
| `development` | A dev build: the app plus `expo-dev-client`, loading JavaScript from your machine. Needed for native modules Expo Go lacks (MapLibre, push) and for D-01's background-location check on real phones (M-37). | Internal (iOS ad hoc, Android APK) | `development` | `development` |
| `preview` | A release build for the owner's own phones. | Internal (iOS ad hoc, Android APK) | `preview` | `preview` |
| `production` | Store builds for TestFlight and Play internal testing (D-11). | Store | `production` | `production` |

`EXPO_PUBLIC_APP_ENV` is set in `eas.json` and baked into the bundle. M-25 uses it so release builds refuse to start in prototype mode. **Until M-25 merges, a preview or production build with missing Supabase variables silently runs as the prototype.**

Version numbers: `expo.version` in `app.json` (now `0.1.0`) is the version people see. Build numbers live on EAS (`cli.appVersionSource: "remote"`), and the production profile increments them on every build.

## Placeholders to replace before the first store build (D-10)

D-10 (app identity) is deferred, so `app.json` carries placeholders. The `.invalid` reverse-DNS prefix is reserved and can never be a real domain, so a search for `invalid.placeholder` finds every one:

| Key in `apps/mobile/app.json` | Placeholder | Replace with |
| --- | --- | --- |
| `expo.ios.bundleIdentifier` | `invalid.placeholder.merge` | The D-10 iOS bundle ID |
| `expo.android.package` | `invalid.placeholder.merge` | The D-10 Android package |
| `expo.name` | `Merge` | The D-10 store name, if it changes ("Merge" is a working name) |

Both IDs become permanent once a build is uploaded to App Store Connect or Play, so set the final values before the first `production` build. Development and preview builds can use the placeholders. Changing the IDs later only means reinstalling those builds.

`apps/mobile/app.config.js` enforces this. It reads `app.json` and throws "Production build blocked: app.json still has placeholder app IDs …" when either ID still contains `invalid.placeholder` and the config is resolved for production: the `production` EAS profile (`EAS_BUILD_PROFILE`) or `EXPO_PUBLIC_APP_ENV=production`. Development, preview and local `expo start` are unaffected. The check lives in `src/lib/releaseIdentity.js`, with unit tests beside it. To try it: `EXPO_PUBLIC_APP_ENV=production npx expo config` (from `apps/mobile`) fails until the IDs are replaced.

The icon, adaptive icon and splash (see [Artwork](#artwork)) are placeholder art awaiting the owner's approval.

## Owner steps (O-07)

Run these from `apps/mobile`, after the Expo, Apple and Google accounts exist (O-06).

1. `npm install --global eas-cli`, then `eas login`.
2. `eas init`. It creates the EAS project and writes `extra.eas.projectId` (and possibly `owner`) into `app.json`. Commit that diff, or hand it to an agent to commit.
3. Set the Supabase values as EAS environment variables, once per environment the profiles use (`development`, `preview`, `production`):

   ```bash
   eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value https://<ref>.supabase.co --visibility plaintext
   eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <publishable key> --visibility sensitive
   ```

   Use the publishable (or legacy `anon`) key only, never a secret or `service_role` key. `EXPO_PUBLIC_` values end up inside the app bundle, so don't use `secret` visibility for them. The Sentry DSN (M-31) is added the same way.

   The map display key (O-08, M-22) is the Stadia Maps **client** key, restricted to the app, never a server key:

   ```bash
   eas env:create --environment preview --name EXPO_PUBLIC_STADIA_KEY --value <stadia client key> --visibility sensitive
   ```

   For local checks, put the same line (`EXPO_PUBLIC_STADIA_KEY=...`) in `apps/mobile/.env`. Without it, every map in the app is the stylized, offline BayMap (see [Maps](#maps)).
4. Build:

   ```bash
   eas device:create                                      # once per iPhone, for internal iOS builds
   eas build --profile development --platform all
   eas build --profile preview --platform all
   eas build --profile production --platform all          # fails until D-10's final IDs are in app.json
   ```

   EAS asks to create signing credentials on the first build. Let it manage them, and back up the Android upload keystore (`eas credentials`).
5. `eas submit --profile production` once the store records exist (O-06, O-10). Read [Background location and App Review](#background-location-and-app-review) first.

## Background location and App Review

`app.json` declares the iOS `location` background mode now, but no code uses it until M-37 adds ride mode (D-01). Apple rejects builds that declare a background mode they don't use (App Review Guideline 2.5.4), so:

- **Don't submit a build to TestFlight external testing (Beta App Review) or the App Store before M-37 has merged** and that build contains it. Development and preview builds, and TestFlight builds for internal testers only, aren't reviewed and are fine.
- The same applies on Android: hold the Play foreground-service (location) declaration (O-10) until M-37 is in the build, because Play asks for a video of the feature in use.

When you submit, put this in the App Review notes (TestFlight "Beta App Review Information", and App Store "Notes"), adjusted to the shipped UI. Add the review sign-in details from M-41.

> Merge is a carpool app. It uses location only while a ride is in progress, with "While Using the App" permission; it never asks for "Always". When the driver taps "Picked up" at the pickup, the app starts location updates. They keep running if the driver locks the phone or switches to a navigation app, which is why the app declares the location background mode, and iOS shows the blue location indicator. The phone checks whether the car has reached the drop-off area. When it has, the app marks the ride as arrived and stops location updates. Only "arrived" and a timestamp are sent to our server, never coordinates, and other members never see anyone's location. If location is off, the ride completes on a timer instead. To see it: sign in with the review account, open the booked ride under Trips, tap "Picked up", then put the app in the background.

## Running a dev build

Install the development build on the phone, then start Metro with the dev-client target:

```bash
npm --workspace apps/mobile run dev-client     # same as: npx expo start --dev-client (from apps/mobile)
```

`npm run start`, `npm run ios` and `npm run android` still open the app in **Expo Go** (they pass `--go`), because installing `expo-dev-client` would otherwise make `expo start` default to a dev build. M-22 kept it that way: Expo Go lacks MapLibre's native module, but the map falls back to the stylized BayMap there instead of crashing, so Expo Go still runs every screen. Use the dev build (`dev-client`) to see real map tiles on a phone. Switch the default only when a module with no fallback arrives (push, M-38).

## Maps

Discover and "Where and when" draw generalized areas (0.5 mi circles around server-picked area centers, never exact points) with `src/components/map/AreaMap`. Which map you get:

| Where | `EXPO_PUBLIC_STADIA_KEY` set | Map |
| --- | --- | --- |
| Dev, preview or production build (iOS, Android) | yes | MapLibre Native with Stadia Maps tiles (D-08) |
| Expo Go, or a dev build made before M-22 | yes | Stylized BayMap (no MapLibre native module) |
| Web build | yes | maplibre-gl with Stadia Maps tiles, loaded on demand |
| Anywhere | no (prototype mode, empty `.env`) | Stylized BayMap, no network |

Real maps show "© Stadia Maps © OpenMapTiles © OpenStreetMap contributors", linking to each source, as on `site/attributions.html`. If the real map throws or its style can't load, the stylized map takes its place. A development build made before M-22 has no MapLibre, so rebuild it (`eas build --profile development`) after M-22 merges. The `@maplibre/maplibre-react-native` config plugin adds no permissions (checked with `npx expo config --type introspect`).

## What the release config sets

- **iPhone only:** `ios.supportsTablet: false` (D-10).
- **Light mode only:** `userInterfaceStyle: "light"`, because `src/theme.ts` has no dark palette. On Android this needs `expo-system-ui`, which is installed; without it, date pickers, keyboards and dialogs follow the system dark theme.
- **Export compliance:** `ios.config.usesNonExemptEncryption: false`, because the app only uses HTTPS. App Store Connect then skips the encryption question.
- **Location for D-01's ride mode:** the `expo-location` plugin with a "while using" usage string only. The "Always" strings are removed (`false`), iOS gets the `location` background mode (the blue indicator), and Android gets `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_LOCATION` for the "Ride in progress" notification. `ACCESS_BACKGROUND_LOCATION` is in `android.blockedPermissions`, so no library can add it. No geofencing. Play needs a foreground-service declaration for this (O-10).
- **Blocked Android permissions** the app doesn't use: background location, external storage, overlay (`SYSTEM_ALERT_WINDOW`) and microphone.
- **Continuous native generation:** `apps/mobile/ios/` and `apps/mobile/android/` are generated from `app.json` by EAS or `npx expo prebuild`, and are git-ignored. Change native settings in `app.json` or a config plugin, never in those folders.

To see the resolved config without building:

```bash
cd apps/mobile
npx expo config --type public       # the fields above
npx expo config --type introspect   # adds the generated Info.plist and AndroidManifest permissions
```

## Artwork

The placeholder mark is the Ionicons `git-merge` glyph, flipped vertically as on the Welcome screen, in Forest `deep` (`#14301C`) on an `accentLight` (`#A9D4B4`) tile. The splash shows the tile on a `deep` background, like the loading screen.

| File | Use |
| --- | --- |
| `assets/icon.png` | App icon, 1024 × 1024, opaque (iOS rejects transparency) |
| `assets/adaptive-icon.png` | Android adaptive icon foreground. The background is `android.adaptiveIcon.backgroundColor` |
| `assets/adaptive-icon-monochrome.png` | Android 13+ themed icon (only its alpha is used) |
| `assets/splash-icon.png` | Splash image, via the `expo-splash-screen` plugin |

The SVG sources are in `apps/mobile/assets/source/`. After editing one, run `apps/mobile/assets/generate-images.sh` (it fetches a pinned `sharp-cli` with npx) and commit the SVGs and PNGs together.
