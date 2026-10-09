// https://docs.expo.dev/guides/using-eslint/
// eslint-config-expo's flat config includes eslint-plugin-react-hooks
// (rules-of-hooks as an error, exhaustive-deps as a warning).
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*'],
  },
  {
    rules: {
      // Downgraded from error when ESLint was added (M-03), because existing
      // screens use plain apostrophes and quotes inside <Text>. React Native
      // renders them literally, so this web-HTML rule only flags style.
      'react/no-unescaped-entities': 'warn',
    },
  },
]);
