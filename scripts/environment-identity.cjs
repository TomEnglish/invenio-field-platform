// What makes a dev build a different app from the production one.
//
// A build for a dev environment is given that environment's label, the same
// one its office site shows on every page (EXPO_PUBLIC_ENVIRONMENT_LABEL, for
// example "Dev"). From it the build gets its own name ("Invenio Field Dev"),
// its own app ID and its own link scheme, so it installs beside the production
// app instead of replacing it, and nobody mistakes one for the other. A
// production build has no label and keeps the name and app ID in app.json.
//
// Used by app.config.js when the app is built or an update is published, and
// by scripts/check-release-env.cjs, which confirms the label against the
// office site. lib/config.ts applies the same rule inside the app.
const LABEL = /^[A-Za-z][A-Za-z0-9]{0,11}$/;

// The label and the suffix it gives the app ID, or null for a production build.
function environmentIdentity(value) {
  const label = String(value ?? '').trim();
  if (!label) return null;
  if (!LABEL.test(label)) {
    throw new Error('EXPO_PUBLIC_ENVIRONMENT_LABEL must be one short word of letters and digits that starts with a letter, for example "Dev"');
  }
  return { label, suffix: label.toLowerCase() };
}

// The app configuration for this build: app.json as it is for production, or
// with the label's name, app ID and link scheme for a dev environment.
function withEnvironmentIdentity(config, value) {
  const identity = environmentIdentity(value);
  if (!identity) return config;
  for (const [field, present] of [['name', config.name], ['scheme', config.scheme], ['ios.bundleIdentifier', config.ios?.bundleIdentifier], ['android.package', config.android?.package]]) {
    if (typeof present !== 'string' || !present) throw new Error(`app.json has no ${field} to give the ${identity.label} build its own`);
  }
  return {
    ...config,
    name: `${config.name} ${identity.label}`,
    scheme: `${config.scheme}-${identity.suffix}`,
    ios: { ...config.ios, bundleIdentifier: `${config.ios.bundleIdentifier}.${identity.suffix}` },
    android: { ...config.android, package: `${config.android.package}.${identity.suffix}` },
  };
}

module.exports = { environmentIdentity, withEnvironmentIdentity };
