const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = path.resolve(__dirname, '..');
const env = (site) => ({ process: { env: {
  EXPO_PUBLIC_SUPABASE_URL: 'https://test.example.com', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
  ...(site === undefined ? {} : { EXPO_PUBLIC_OFFICE_SITE_URL: site }),
} } });
const config = (site) => createModuleLoader({ globals: env(site) }).load('./lib/config.ts');

test('the office site address comes only from the build setting', () => {
  assert.equal(config('https://office.example.com').officeSiteUrl, 'https://office.example.com');
  assert.equal(config(' https://office.example.com/ ').officeSiteUrl, 'https://office.example.com');
  assert.equal(config('https://office.example.com').officeSitePage('/login.html'), 'https://office.example.com/login.html');
  assert.equal(config('http://localhost:8092').officeSitePage('projects.html'), 'http://localhost:8092/projects.html');
  for (const unusable of [undefined, '', 'office.example.com', 'http://office.example.com', 'https://office.example.com/app', 'https://office.example.com?x=1', 'javascript:alert(1)']) {
    assert.equal(config(unusable).officeSiteUrl, null, String(unusable));
    assert.equal(config(unusable).officeSitePage('login.html'), null);
  }
});

async function openLogin(site) {
  const calls = { resets: [] };
  const loader = createModuleLoader({ globals: env(site), stubs: {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': {
      View: 'View', Text: 'Text', Image: 'Image', KeyboardAvoidingView: 'KeyboardAvoidingView',
      Platform: { OS: 'ios' }, StyleSheet: { create: (styles) => styles },
    },
    'expo-router': { router: { replace: () => {} } },
    '@/lib/supabase': { supabase: { auth: { resetPasswordForEmail: async (email, options) => { calls.resets.push([email, options]); return { error: null }; } } } },
    '@/stores/authStore': { useAuthStore: (select) => select({ signIn: async () => ({ error: null }) }) },
    '@/components/ui/Button': { Button: 'Button' },
    '@/components/ui/Input': { Input: 'Input' },
    '@/lib/design/tokens': new Proxy({}, { get: (_, key) => (key === '__esModule' ? false : new Proxy({}, { get: () => 1 })) }),
    '@/assets/images/invenio-technologies-logo.png': 1,
  } });
  const LoginScreen = loader.load('./app/(auth)/login.tsx').default;
  let renderer;
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(LoginScreen)); });
  const type = (label, text) => TestRenderer.act(async () => {
    renderer.root.findAll(node => node.type === 'Input' && node.props.label === label)[0].props.onChangeText(text);
  });
  const forgot = () => TestRenderer.act(async () => {
    await renderer.root.findAll(node => node.type === 'Button' && node.props.title === 'Forgot password?')[0].props.onPress();
  });
  const says = (text) => renderer.root.findAll(node => node.type === 'Text' && [].concat(node.props.children).join('') === text).length > 0;
  return { calls, type, forgot, says };
}

test('a password reset opens the reset page on this environment\'s office site', async () => {
  const screen = await openLogin('https://acme.example.com/');
  await screen.type('Email', ' worker-a@example.com ');
  await screen.forgot();
  // The options object is made inside the loaded module, so compare it by value.
  assert.deepEqual(JSON.parse(JSON.stringify(screen.calls.resets)), [['worker-a@example.com', { redirectTo: 'https://acme.example.com/login.html' }]]);
  assert.equal(screen.says('If this account can receive a reset link, check your email to set a new password.'), true);
});

test('a build with no office site sends no reset and says who to ask', async () => {
  const screen = await openLogin(undefined);
  await screen.type('Email', 'worker-a@example.com');
  await screen.forgot();
  assert.deepEqual(screen.calls.resets, []);
  assert.equal(screen.says('Password reset is not available in this version of the app. Ask your administrator to reset your password.'), true);
});

async function openAccessPending(site, role) {
  const opened = [];
  const loader = createModuleLoader({ globals: env(site), stubs: {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { View: 'View', Text: 'Text', Linking: { openURL: (url) => opened.push(url) } },
    '@/stores/authStore': { useAuthStore: () => ({ user: { role }, loadSession: () => {}, signOut: () => {} }) },
    '@/components/ui/Button': { Button: 'Button' },
    '@/components/ui/EnvironmentLabel': { EnvironmentLabel: 'EnvironmentLabel' },
    '@/lib/design/tokens': { colors: { canvas: '#fff', textPrimary: '#000', textMuted: '#555' } },
  } });
  const { AccessPendingScreen } = loader.load('./components/screens/AccessPendingScreen.tsx');
  let renderer;
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(AccessPendingScreen)); });
  const buttons = () => renderer.root.findAll(node => node.type === 'Button').map(node => node.props.title);
  const press = (title) => renderer.root.findAll(node => node.type === 'Button' && node.props.title === title)[0].props.onPress();
  // A new dev account lands here before it has a project, so the screen carries the environment label too.
  assert.equal(renderer.root.findAll(node => node.type === 'EnvironmentLabel' && node.props.variant === 'pill').length, 1);
  return { opened, buttons, press };
}

test('an administrator without a project is sent to their own office site to manage projects', async () => {
  const screen = await openAccessPending('https://acme.example.com', 'admin');
  assert.deepEqual(screen.buttons(), ['Check access again', 'Manage projects and users', 'Sign out']);
  screen.press('Manage projects and users');
  assert.deepEqual(screen.opened, ['https://acme.example.com/projects.html']);
});

test('the manage button is left out for other roles and when no office site is set', async () => {
  assert.deepEqual((await openAccessPending('https://acme.example.com', 'field_worker')).buttons(), ['Check access again', 'Sign out']);
  assert.deepEqual((await openAccessPending(undefined, 'admin')).buttons(), ['Check access again', 'Sign out']);
});

test('no site or database address is written into the app; they come from build settings', () => {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const relative = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(relative);
      else if (/\.(ts|tsx|js|cjs|json)$/.test(entry.name)) files.push(relative);
    }
  };
  for (const directory of ['app', 'components', 'lib', 'stores', 'constants', 'types']) walk(directory);
  assert.ok(files.length > 50);
  // Documentation links in comments are fine; anything else must come from a setting.
  const allowed = /^https:\/\/(docs\.expo\.(io|dev)|reactnative\.dev|github\.com|www\.w3\.org)\//;
  const offenders = files.flatMap((file) => (fs.readFileSync(path.join(root, file), 'utf8').match(/https?:\/\/[A-Za-z0-9.-]+\.[a-z]{2,}[^\s'"`)]*/g) || [])
    .filter((address) => !allowed.test(address)).map((address) => `${file}: ${address}`));
  assert.deepEqual(offenders, []);
  const eas = fs.readFileSync(path.join(root, 'eas.json'), 'utf8') + fs.readFileSync(path.join(root, 'app.json'), 'utf8');
  assert.doesNotMatch(eas, /supabase\.co|netlify\.app/);
});
