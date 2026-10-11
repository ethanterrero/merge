// Store-build guard for the D-10 placeholder app IDs. Plain CommonJS with no
// imports, because app.config.js loads it in Node before any bundler runs.

/** Every placeholder ID in app.json contains this, so a search finds them all. */
const PLACEHOLDER_MARKER = 'invalid.placeholder';

/**
 * True for a store build: the production EAS profile, or a local config
 * resolved with EXPO_PUBLIC_APP_ENV=production.
 * @param {Record<string, string | undefined>} env
 */
function isProductionBuild(env) {
  return env.EXPO_PUBLIC_APP_ENV === 'production' || env.EAS_BUILD_PROFILE === 'production';
}

/**
 * The app-ID keys that still hold a placeholder, as "key = value" strings.
 * @param {{ ios?: { bundleIdentifier?: string }, android?: { package?: string } }} config
 * @returns {string[]}
 */
function placeholderIds(config) {
  const ids = [
    ['ios.bundleIdentifier', config.ios?.bundleIdentifier],
    ['android.package', config.android?.package],
  ];
  return ids
    .filter(([, value]) => typeof value === 'string' && value.includes(PLACEHOLDER_MARKER))
    .map(([key, value]) => `${key} = ${value}`);
}

/**
 * Throws when a production build would ship placeholder IDs. Store IDs are
 * permanent after the first upload, so this must fail before EAS builds.
 * @param {Parameters<typeof placeholderIds>[0]} config
 * @param {Record<string, string | undefined>} env
 */
function assertStoreIdentity(config, env) {
  if (!isProductionBuild(env)) return;
  const found = placeholderIds(config);
  if (found.length === 0) return;
  throw new Error(
    `Production build blocked: app.json still has placeholder app IDs (${found.join(', ')}). ` +
      'Set the final iOS bundle ID and Android package from decision D-10 first; see docs/pilot/builds.md.',
  );
}

module.exports = { PLACEHOLDER_MARKER, isProductionBuild, placeholderIds, assertStoreIdentity };
