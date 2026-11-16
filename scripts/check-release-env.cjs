// Run before publishing an app update or starting a build. The app is built
// for one environment (dev, demo or a customer), named by three settings:
//
//   EXPO_PUBLIC_SUPABASE_URL        that environment's database
//   EXPO_PUBLIC_SUPABASE_ANON_KEY   that database's public key
//   EXPO_PUBLIC_OFFICE_SITE_URL     that environment's office site
//
// and, for a dev environment only, a fourth:
//
//   EXPO_PUBLIC_ENVIRONMENT_LABEL   that environment's label ("Dev")
//
// This refuses to go on unless the first three are set, well formed, and belong
// together: the office site itself must connect to the same database with the
// same key. That is what stops an update from pairing one customer's site with
// another's data.
//
// The office site also says which kind of environment it is. A build for a dev
// environment must carry that environment's label, which makes it its own app
// with a "Dev" label on screen (scripts/environment-identity.cjs); a production
// build must carry none. That is what stops a dev build from being installed
// over the production app, or a production build from wearing a dev label.
//
//   npx eas-cli env:exec production "node scripts/check-release-env.cjs"
//   node scripts/check-release-env.cjs --offline     (format checks only; does not confirm they belong together)
//
// Nothing runs this for you: run it for the profile you are about to build or
// publish. It needs the office site of that environment to be published already.
const { environmentIdentity, withEnvironmentIdentity } = require('./environment-identity.cjs');

const PLACEHOLDER = /(^|\.)example\.|your-|placeholder/i;

function origin(value, label, problems) {
  let url;
  try { url = new URL(String(value || '')); } catch { problems.push(`${label} is not set to an address`); return null; }
  const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !local) || url.origin !== String(value).replace(/\/+$/, '')) {
    problems.push(`${label} must be an https address with no path`); return null;
  }
  if (PLACEHOLDER.test(url.hostname)) { problems.push(`${label} is still a placeholder`); return null; }
  return url.origin;
}

async function checkReleaseEnv({ env = process.env, fetchImpl = fetch, offline = false } = {}) {
  const problems = [];
  const database = origin(env.EXPO_PUBLIC_SUPABASE_URL, 'EXPO_PUBLIC_SUPABASE_URL', problems);
  const office = origin(env.EXPO_PUBLIC_OFFICE_SITE_URL, 'EXPO_PUBLIC_OFFICE_SITE_URL', problems);
  const key = String(env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '');
  if (key.length < 20 || PLACEHOLDER.test(key)) problems.push('EXPO_PUBLIC_SUPABASE_ANON_KEY is not set');
  else if (key.startsWith('sb_secret_')) problems.push('EXPO_PUBLIC_SUPABASE_ANON_KEY is a server key; use the public key');
  else if (!key.startsWith('sb_publishable_')) {
    let claims = null;
    try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')); } catch { /* not a JWT */ }
    if (!claims) problems.push('EXPO_PUBLIC_SUPABASE_ANON_KEY is not a recognized public key');
    else if (claims.role !== 'anon') problems.push(`EXPO_PUBLIC_SUPABASE_ANON_KEY has the "${claims.role}" role; only the public (anon) key may ship in the app`);
    else if (database && claims.ref && new URL(database).hostname.split('.')[0] !== claims.ref) problems.push('EXPO_PUBLIC_SUPABASE_ANON_KEY belongs to a different database than EXPO_PUBLIC_SUPABASE_URL');
  }
  let identity = null;
  try { identity = environmentIdentity(env.EXPO_PUBLIC_ENVIRONMENT_LABEL); } catch (error) { problems.push(error.message); }
  if (!problems.length && !offline) {
    // The office site publishes its own connection; it must be this one.
    let published = null;
    try {
      const response = await fetchImpl(`${office}/supabase-config.js`, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
      if (response.ok) published = await response.text();
      else problems.push(`${office} did not serve its connection settings (${response.status})`);
    } catch (error) { problems.push(`${office} could not be reached: ${error.message}`); }
    if (published !== null) {
      // Whole quoted values only, so a longer address or key that merely starts the same does not pass.
      const names = value => published.includes(`"${value}"`) || published.includes(`'${value}'`);
      if (!names(database)) problems.push(`${office} belongs to a different environment: it does not connect to ${database}`);
      else if (!names(key)) problems.push(`${office} uses a different public key than this build`);
      else {
        // The site knows what kind of environment this is; the build's label must say the same.
        const site = publishedEnvironment(published);
        if (!site) problems.push(`${office} does not say which kind of environment it is, so this build's label cannot be confirmed. Publish the current office site first`);
        else if (site.kind === 'dev' && !identity) problems.push(`${office} is a dev environment: set EXPO_PUBLIC_ENVIRONMENT_LABEL to "${site.label}" so this build is its own app and says so on screen`);
        else if (site.kind === 'dev' && identity.label !== site.label) problems.push(`EXPO_PUBLIC_ENVIRONMENT_LABEL is "${identity.label}" but ${office} is labeled "${site.label}"`);
        else if (site.kind === 'production' && identity) problems.push(`EXPO_PUBLIC_ENVIRONMENT_LABEL is "${identity.label}" but ${office} is a production environment: a production build has no label`);
      }
    }
  }
  if (problems.length) throw new Error(`This build's settings are not ready to publish:\n  ${problems.join('\n  ')}`);
  const app = withEnvironmentIdentity(require('../app.json').expo, identity?.label);
  return { database, office, checkedSite: !offline, label: identity?.label ?? null, appName: app.name, appId: app.ios.bundleIdentifier };
}

// What the office site's published settings say about its environment:
// { kind: 'dev' | 'production', label }, or null when they do not say.
function publishedEnvironment(published) {
  const start = published.indexOf('{');
  const end = published.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let config;
  try { config = JSON.parse(published.slice(start, end + 1)); } catch { return null; }
  if (!['dev', 'production'].includes(config?.kind) || typeof config.label !== 'string' || !config.label) return null;
  return { kind: config.kind, label: config.label };
}

module.exports = { checkReleaseEnv };

if (require.main === module) {
  checkReleaseEnv({ offline: process.argv.includes('--offline') })
    .then(result => {
      const app = `"${result.appName}" (${result.appId})`;
      console.log(result.checkedSite
        ? `Settings are consistent: the app and ${result.office} use ${result.database}. This builds ${result.label ? `the ${result.label} app ${app}, which installs beside the production app` : `the production app ${app}`}.`
        : `Settings are well formed. NOT confirmed to belong together: ${result.office} was not asked which database it uses or which kind of environment it is. Run without --offline before publishing.`);
    })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
