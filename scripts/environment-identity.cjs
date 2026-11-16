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
// office site. lib/config.ts reads the label inside the app, by the same form.
//
// What this does not do: the name and app ID are fixed when the app is built,
// while the label on screen and the database address arrive together in each
// bundle, including a published update. An update published to a channel with
// another environment's settings would run in the wrong app. Nothing here
// prevents that; SETUP.md says how to publish so it does not happen.
const LABEL = /^[A-Za-z][A-Za-z0-9]{0,11}$/;
// The label becomes the last part of the Android app ID, where these words are
// not allowed (the build tool's own list: Java keywords and literals).
const RESERVED = new Set(['abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default', 'do',
  'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface',
  'long', 'native', 'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized',
  'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while', 'true', 'false', 'null']);

// Why a label cannot name an app, or null when it can.
function labelProblem(label) {
  if (!LABEL.test(label)) return 'must be one short word of letters and digits that starts with a letter, for example "Dev"';
  if (RESERVED.has(label.toLowerCase())) return `cannot be "${label}": "${label.toLowerCase()}" is a reserved word in an Android app ID`;
  return null;
}

// The label and the suffix it gives the app ID, or null for a production build.
function environmentIdentity(value) {
  const label = String(value ?? '').trim();
  if (!label) return null;
  const problem = labelProblem(label);
  if (problem) throw new Error(`EXPO_PUBLIC_ENVIRONMENT_LABEL ${problem}`);
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

module.exports = { environmentIdentity, withEnvironmentIdentity, labelProblem, LABEL_PATTERN: LABEL.source };
