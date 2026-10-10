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

   Use the publishable (or legacy `anon`) key only, never a secret or `service_role` key. `EXPO_PUBLIC_` values end up inside the app bundle, so don't use `secret` visibility for them. Later tasks add the map display key (M-22) and the Sentry DSN (M-31) the same way.
4. Build:

   ```bash
   eas device:create                                      # once per iPhone, for internal iOS builds
   eas build --profile development --platform all
   eas build --profile preview --platform all
   eas build --profile production --platform all          # only after D-10's final IDs are in app.json
   ```

   EAS asks to create signing credentials on the first build. Let it manage them, and back up the Android upload keystore (`eas credentials`).
5. `eas submit --profile production` once the store records exist (O-06, O-10).

## Running a dev build

Install the development build on the phone, then start Metro with the dev-client target:

```bash
npm --workspace apps/mobile run dev-client     # same as: npx expo start --dev-client (from apps/mobile)
```

`npm run start`, `npm run ios` and `npm run android` still open the app in **Expo Go** (they pass `--go`), because installing `expo-dev-client` would otherwise make `expo start` default to a dev build. Once the app needs a native module Expo Go doesn't have (MapLibre in M-22), switch those scripts to the dev build.

## What the release config sets

- **iPhone only:** `ios.supportsTablet: false` (D-10).
- **Light mode only:** `userInterfaceStyle: "light"`, because `src/theme.ts` has no dark palette.
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
