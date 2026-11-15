const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { checkReleaseEnv } = require('../scripts/check-release-env.cjs');

// A public (anon) key for a database reference; nothing here is signed or sent anywhere.
const key = (ref, role = 'anon') => `header.${Buffer.from(JSON.stringify({ ref, role })).toString('base64url')}.signature`;
const settings = (overrides = {}) => ({
  EXPO_PUBLIC_SUPABASE_URL: 'https://acmedb.supabase.co', EXPO_PUBLIC_SUPABASE_ANON_KEY: key('acmedb'),
  EXPO_PUBLIC_OFFICE_SITE_URL: 'https://field.acme.test', ...overrides,
});
// The office site's published connection file, for whichever database and key it was built with.
const site = (database, publicKey, status = 200) => async (url, options) => {
  assert.equal(url, 'https://field.acme.test/supabase-config.js');
  assert.equal(options.redirect, 'manual');
  return { ok: status === 200, status, text: async () => `window.SUPABASE_CONFIG = {"url": "${database}", "anonKey": "${publicKey}"};` };
};

test('settings that belong to one environment pass, and the office site is asked', async () => {
  assert.deepEqual(await checkReleaseEnv({ env: settings(), fetchImpl: site('https://acmedb.supabase.co', key('acmedb')) }),
    { database: 'https://acmedb.supabase.co', office: 'https://field.acme.test', checkedSite: true });
});

test('an office site that connects to another environment\'s database stops the release', async () => {
  await assert.rejects(checkReleaseEnv({ env: settings(), fetchImpl: site('https://demodb.supabase.co', key('demodb')) }),
    /belongs to a different environment: it does not connect to https:\/\/acmedb\.supabase\.co/);
  await assert.rejects(checkReleaseEnv({ env: settings(), fetchImpl: site('https://acmedb.supabase.co', key('acmedb') + 'longer') }),
    /uses a different public key/);
  await assert.rejects(checkReleaseEnv({ env: settings(), fetchImpl: site('https://acmedb.supabase.co.evil.test', key('acmedb')) }), /belongs to a different environment/);
  await assert.rejects(checkReleaseEnv({ env: settings(), fetchImpl: site('https://acmedb.supabase.co', key('acmedb'), 404) }), /did not serve its connection settings \(404\)/);
  await assert.rejects(checkReleaseEnv({ env: settings(), fetchImpl: async () => { throw new Error('offline'); } }), /could not be reached: offline/);
});

test('missing, placeholder and mismatched settings are each named, before the site is contacted', async () => {
  const never = async () => { throw new Error('the office site must not be contacted'); };
  const refuses = (overrides, pattern) => assert.rejects(checkReleaseEnv({ env: settings(overrides), fetchImpl: never }), pattern);
  await refuses({ EXPO_PUBLIC_OFFICE_SITE_URL: undefined }, /EXPO_PUBLIC_OFFICE_SITE_URL is not set/);
  await refuses({ EXPO_PUBLIC_OFFICE_SITE_URL: 'https://office.example.com' }, /EXPO_PUBLIC_OFFICE_SITE_URL is still a placeholder/);
  await refuses({ EXPO_PUBLIC_OFFICE_SITE_URL: 'https://field.acme.test/login.html' }, /EXPO_PUBLIC_OFFICE_SITE_URL must be an https address with no path/);
  await refuses({ EXPO_PUBLIC_OFFICE_SITE_URL: 'http://field.acme.test' }, /must be an https address/);
  await refuses({ EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }, /EXPO_PUBLIC_SUPABASE_URL is still a placeholder/);
  await refuses({ EXPO_PUBLIC_SUPABASE_URL: 'https://your-project-id.supabase.co' }, /EXPO_PUBLIC_SUPABASE_URL is still a placeholder/);
  await refuses({ EXPO_PUBLIC_SUPABASE_ANON_KEY: 'ci-build-placeholder' }, /EXPO_PUBLIC_SUPABASE_ANON_KEY is not set/);
  await refuses({ EXPO_PUBLIC_SUPABASE_ANON_KEY: key('acmedb', 'service_role') }, /only the public \(anon\) key may ship/);
  await refuses({ EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_0123456789abcdefghij' }, /server key/);
  await refuses({ EXPO_PUBLIC_SUPABASE_ANON_KEY: key('demodb') }, /belongs to a different database/);
  // Every problem is listed together.
  await assert.rejects(checkReleaseEnv({ env: {}, fetchImpl: never }), error =>
    ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_OFFICE_SITE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'].every(name => error.message.includes(name)));
});

test('--offline checks the settings without contacting the site, and the command exits non-zero on a problem', async () => {
  const offline = await checkReleaseEnv({ env: settings(), offline: true, fetchImpl: async () => { throw new Error('must not fetch'); } });
  assert.equal(offline.checkedSite, false);
  const script = path.resolve(__dirname, '../scripts/check-release-env.cjs');
  const run = (env) => spawnSync(process.execPath, [script, '--offline'], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  const good = run(settings());
  assert.equal(good.status, 0, good.stderr);
  // Offline never claims the settings belong together.
  assert.match(good.stdout, /well formed\. NOT confirmed to belong together/);
  assert.doesNotMatch(good.stdout, /consistent/);
  assert.doesNotMatch(good.stdout + good.stderr, new RegExp(key('acmedb')));
  const bad = run({});
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /not ready to publish/);
});
