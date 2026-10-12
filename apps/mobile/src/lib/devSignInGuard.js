// Release-build guard for the dev sign-in account. Plain CommonJS with no imports,
// because app.config.js loads it in Node before any bundler runs.

const DEV_SIGN_IN_VARS = ['EXPO_PUBLIC_DEV_SIGN_IN_EMAIL', 'EXPO_PUBLIC_DEV_SIGN_IN_PASSWORD'];

/**
 * True for a preview or production build: either APP_ENV (as eas.json sets it) or
 * the EAS profile is anything but development. Local `expo start` leaves both unset.
 * @param {Record<string, string | undefined>} env
 */
function isReleaseConfig(env) {
  const appEnv = env.EXPO_PUBLIC_APP_ENV;
  const profile = env.EAS_BUILD_PROFILE;
  const releaseAppEnv = appEnv !== undefined && appEnv !== '' && appEnv !== 'development';
  const releaseProfile = profile !== undefined && profile !== '' && profile !== 'development';
  return releaseAppEnv || releaseProfile;
}

/**
 * The dev sign-in variables that hold a value.
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
function devSignInVarsSet(env) {
  return DEV_SIGN_IN_VARS.filter((key) => Boolean(env[key]));
}

/**
 * Throws when a release build would inline the dev account into its bundle. Expo
 * inlines every EXPO_PUBLIC_* the code reads, whether or not that code runs.
 * @param {Record<string, string | undefined>} env
 */
function assertNoDevSignIn(env) {
  if (!isReleaseConfig(env)) return;
  const set = devSignInVarsSet(env);
  if (set.length === 0) return;
  throw new Error(
    `Release build blocked: ${set.join(', ')} is set. The dev sign-in account is for local development only; ` +
      'remove it from the environment (apps/mobile/.env or the EAS environment) before building.',
  );
}

module.exports = { DEV_SIGN_IN_VARS, isReleaseConfig, devSignInVarsSet, assertNoDevSignIn };
