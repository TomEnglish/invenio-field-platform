// app.json holds the production app. A build for a dev environment carries
// that environment's label and becomes its own app: see
// scripts/environment-identity.cjs.
const { withEnvironmentIdentity } = require('./scripts/environment-identity.cjs');

module.exports = ({ config }) => withEnvironmentIdentity(config, process.env.EXPO_PUBLIC_ENVIRONMENT_LABEL);
