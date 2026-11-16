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
// The office site's published settings file, written the way the office site writes it, for whichever
// database and key it was built with and whichever kind of environment it is (null: an older site that does not say).
const published = (database, publicKey, environment) => '// Generated for the "acme" environment from environments.json. Do not edit.\n'
  + `window.SUPABASE_CONFIG = ${JSON.stringify({ environment: 'acme', ...(environment || {}), url: database, anonKey: publicKey, options: { auth: { persistSession: true } } }, null, 2)};\n`;
const PRODUCTION = { kind: 'production', label: 'Acme' };
const DEV = { kind: 'dev', label: 'Dev' };
const site = (database, publicKey, status = 200, environment = PRODUCTION) => async (url, options) => {
  assert.equal(url, 'https://field.acme.test/supabase-config.js');
  assert.equal(options.redirect, 'manual');
  return { ok: status === 200, status, text: async () => published(database, publicKey, environment) };
};
const ours = (environment) => site('https://acmedb.supabase.co', key('acmedb'), 200, environment);

test('settings that belong to one environment pass, and the office site is asked', async () => {
  assert.deepEqual(await checkReleaseEnv({ env: settings(), fetchImpl: site('https://acmedb.supabase.co', key('acmedb')) }),
    { database: 'https://acmedb.supabase.co', office: 'https://field.acme.test', checkedSite: true, label: null, appName: 'Invenio Field', appId: 'com.qrassetscanner.app' });
});

test('a build for a dev environment must carry that environment\'s label, and becomes its own app', async () => {
  const dev = await checkReleaseEnv({ env: settings({ EXPO_PUBLIC_ENVIRONMENT_LABEL: 'Dev' }), fetchImpl: ours(DEV) });
  assert.deepEqual([dev.label, dev.appName, dev.appId], ['Dev', 'Invenio Field Dev', 'com.qrassetscanner.app.dev']);
  // Without the label it would be built as the production app and installed over it.
  await assert.rejects(checkReleaseEnv({ env: settings(), fetchImpl: ours(DEV) }),
    /https:\/\/field\.acme\.test is a dev environment: set EXPO_PUBLIC_ENVIRONMENT_LABEL to "Dev"/);
  await assert.rejects(checkReleaseEnv({ env: settings({ EXPO_PUBLIC_ENVIRONMENT_LABEL: '  ' }), fetchImpl: ours(DEV) }), /is a dev environment/);
  await assert.rejects(checkReleaseEnv({ env: settings({ EXPO_PUBLIC_ENVIRONMENT_LABEL: 'Test' }), fetchImpl: ours(DEV) }),
    /EXPO_PUBLIC_ENVIRONMENT_LABEL is "Test" but https:\/\/field\.acme\.test is labeled "Dev"/);
  await assert.rejects(checkReleaseEnv({ env: settings({ EXPO_PUBLIC_ENVIRONMENT_LABEL: 'dev' }), fetchImpl: ours(DEV) }), /is "dev" but .* is labeled "Dev"/);
});

test('a production build must carry no label', async () => {
  await assert.rejects(checkReleaseEnv({ env: settings({ EXPO_PUBLIC_ENVIRONMENT_LABEL: 'Dev' }), fetchImpl: ours(PRODUCTION) }),
    /EXPO_PUBLIC_ENVIRONMENT_LABEL is "Dev" but https:\/\/field\.acme\.test is a production environment: a production build has no label/);
  // A production's own label ("Acme") is not a build label either.
  await assert.rejects(checkReleaseEnv({ env: settings({ EXPO_PUBLIC_ENVIRONMENT_LABEL: 'Acme' }), fetchImpl: ours(PRODUCTION) }), /a production build has no label/);
});

test('an office site that does not say its kind cannot confirm a label, with or without one', async () => {
  for (const environment of [null, { kind: 'staging', label: 'Dev' }, { kind: 'dev' }, { kind: 'dev', label: '' }, { label: 'Dev' }]) {
    for (const label of [undefined, 'Dev']) {
      await assert.rejects(checkReleaseEnv({ env: settings({ EXPO_PUBLIC_ENVIRONMENT_LABEL: label }), fetchImpl: ours(environment) }),
        /does not say which kind of environment it is, so this build's label cannot be confirmed/, JSON.stringify(environment));
    }
  }
  const unreadable = async () => ({ ok: true, status: 200, text: async () => `window.SUPABASE_CONFIG = {"url": "https://acmedb.supabase.co", "anonKey": "${key('acmedb')}", kind: dev};` });
  await assert.rejects(checkReleaseEnv({ env: settings(), fetchImpl: unreadable }), /does not say which kind of environment/);
});

test('the database is confirmed before the label: another environment\'s site is never asked about labels', async () => {
  await assert.rejects(checkReleaseEnv({ env: settings({ EXPO_PUBLIC_ENVIRONMENT_LABEL: 'Dev' }), fetchImpl: site('https://demodb.supabase.co', key('demodb'), 200, DEV) }),
    error => /belongs to a different environment/.test(error.message) && !/label/i.test(error.message));
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
  await refuses({ EXPO_PUBLIC_ENVIRONMENT_LABEL: 'Dev build' }, /EXPO_PUBLIC_ENVIRONMENT_LABEL must be one short word/);
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
  // Offline, a label is only checked for its form, and nothing is claimed about the environment.
  const labeled = run(settings({ EXPO_PUBLIC_ENVIRONMENT_LABEL: 'Dev' }));
  assert.equal(labeled.status, 0, labeled.stderr);
  assert.match(labeled.stdout, /was not asked which database it uses or which kind of environment it is/);
  assert.equal(run(settings({ EXPO_PUBLIC_ENVIRONMENT_LABEL: 'Dev!' })).status, 1);
});

test('the command says which app the settings build', async () => {
  const http = require('node:http');
  const local = (environment) => new Promise(resolve => {
    const server = http.createServer((request, response) => {
      const address = `http://127.0.0.1:${server.address().port}`;
      response.end(request.url === '/supabase-config.js' ? published(address, localKey, environment) : '');
    }).listen(0, '127.0.0.1', () => resolve(server));
  });
  const localKey = key(undefined);
  const script = path.resolve(__dirname, '../scripts/check-release-env.cjs');
  const run = async (environment, label) => {
    const server = await local(environment);
    const address = `http://127.0.0.1:${server.address().port}`;
    const { execFile } = require('node:child_process');
    try {
      return await new Promise(resolve => execFile(process.execPath, [script], { encoding: 'utf8', env: {
        PATH: process.env.PATH, EXPO_PUBLIC_SUPABASE_URL: address, EXPO_PUBLIC_OFFICE_SITE_URL: address, EXPO_PUBLIC_SUPABASE_ANON_KEY: localKey,
        ...(label ? { EXPO_PUBLIC_ENVIRONMENT_LABEL: label } : {}),
      } }, (error, stdout, stderr) => resolve({ status: error ? error.code : 0, stdout, stderr })));
    } finally { server.close(); }
  };
  const dev = await run(DEV, 'Dev');
  assert.equal(dev.status, 0, dev.stderr);
  assert.match(dev.stdout, /Settings are consistent: .* This builds the Dev app "Invenio Field Dev" \(com\.qrassetscanner\.app\.dev\), which installs beside the production app\./);
  const production = await run(PRODUCTION);
  assert.equal(production.status, 0, production.stderr);
  assert.match(production.stdout, /This builds the production app "Invenio Field" \(com\.qrassetscanner\.app\)\./);
  const wrong = await run(PRODUCTION, 'Dev');
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /a production build has no label/);
});
