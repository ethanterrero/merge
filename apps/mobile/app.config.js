// app.json holds the config. This file only adds checks on top of it.
const { assertStoreIdentity } = require('./src/lib/releaseIdentity');

module.exports = ({ config }) => {
  // D-10's IDs are placeholders until the owner decides them. Development,
  // preview and local `expo start` may use them; a production build may not.
  assertStoreIdentity(config, process.env);
  return config;
};
