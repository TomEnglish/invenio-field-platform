const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');
const { environmentIdentity, withEnvironmentIdentity } = require('../scripts/environment-identity.cjs');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = path.resolve(__dirname, '..');
const appJson = () => JSON.parse(JSON.stringify(require('../app.json').expo));
const env = (label) => ({ process: { env: {
  EXPO_PUBLIC_SUPABASE_URL: 'https://test.example.com', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
  EXPO_PUBLIC_OFFICE_SITE_URL: 'https://office.example.com',
  ...(label === undefined ? {} : { EXPO_PUBLIC_ENVIRONMENT_LABEL: label }),
} } });
// Labels a build could be handed, and whether each is one short word.
const LABELS = [['Dev', true], ['Test2', true], ['  Dev  ', true], ['dev build', false], ['Dev!', false], ['2dev', false], ['Dev-2', false], ['Dev.x', false], ['Abcdefghijklm', false], ['Dév', false]];

test('a production build has no label and keeps the app in app.json exactly', () => {
  for (const none of [undefined, null, '', '   ']) {
    assert.equal(environmentIdentity(none), null);
    assert.deepEqual(withEnvironmentIdentity(appJson(), none), appJson());
  }
});

test('a labeled build is its own app: name, app ID and link scheme, and nothing else changes', () => {
  assert.deepEqual(environmentIdentity(' Dev '), { label: 'Dev', suffix: 'dev' });
  const production = appJson();
  const dev = withEnvironmentIdentity(appJson(), 'Dev');
  assert.equal(dev.name, 'Invenio Field Dev');
  assert.equal(dev.ios.bundleIdentifier, `${production.ios.bundleIdentifier}.dev`);
  assert.equal(dev.android.package, `${production.android.package}.dev`);
  assert.equal(dev.scheme, `${production.scheme}-dev`);
  // Installed side by side, the two must differ in every identity a phone goes by.
  for (const pick of [c => c.name, c => c.ios.bundleIdentifier, c => c.android.package, c => c.scheme]) assert.notEqual(pick(dev), pick(production));
  // Same project, version, updates address, permissions and everything else.
  const same = (config) => ({ ...config, name: 0, scheme: 0, ios: { ...config.ios, bundleIdentifier: 0 }, android: { ...config.android, package: 0 } });
  assert.deepEqual(same(dev), same(production));
  assert.deepEqual(production, appJson(), 'the configuration passed in is not changed');
});

test('a label that is not one short word stops the build instead of naming an app badly', () => {
  for (const [label, valid] of LABELS) {
    if (valid) assert.ok(environmentIdentity(label), label);
    else assert.throws(() => withEnvironmentIdentity(appJson(), label), /EXPO_PUBLIC_ENVIRONMENT_LABEL must be one short word/, label);
  }
  assert.throws(() => withEnvironmentIdentity({ ...appJson(), scheme: undefined }, 'Dev'), /app\.json has no scheme/);
});

test('app.config.js gives the build tool the app for the label it is built with', () => {
  const config = require('../app.config.js');
  const before = process.env.EXPO_PUBLIC_ENVIRONMENT_LABEL;
  try {
    delete process.env.EXPO_PUBLIC_ENVIRONMENT_LABEL;
    assert.deepEqual(config({ config: appJson() }), appJson());
    process.env.EXPO_PUBLIC_ENVIRONMENT_LABEL = 'Dev';
    assert.equal(config({ config: appJson() }).ios.bundleIdentifier, 'com.qrassetscanner.app.dev');
    process.env.EXPO_PUBLIC_ENVIRONMENT_LABEL = 'not a label';
    assert.throws(() => config({ config: appJson() }), /must be one short word/);
  } finally {
    if (before === undefined) delete process.env.EXPO_PUBLIC_ENVIRONMENT_LABEL; else process.env.EXPO_PUBLIC_ENVIRONMENT_LABEL = before;
  }
});

test('the app reads its label by the same rule the build uses', () => {
  const inApp = (label) => createModuleLoader({ globals: env(label) }).load('./lib/config.ts').environmentLabel;
  assert.equal(inApp(undefined), null);
  assert.equal(inApp(''), null);
  for (const [label, valid] of LABELS) assert.equal(inApp(label), valid ? label.trim() : null, label);
});

function render(label, element) {
  const loader = createModuleLoader({ globals: env(label), stubs: {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { View: 'View', Text: 'Text', StyleSheet: { create: (styles) => styles } },
    '@/lib/design/tokens': new Proxy({}, { get: (_, key) => (key === '__esModule' ? false : new Proxy({}, { get: (_tokens, name) => String(name) })) }),
  } });
  const { EnvironmentLabel } = loader.load('./components/ui/EnvironmentLabel.tsx');
  let renderer;
  TestRenderer.act(() => { renderer = TestRenderer.create(React.createElement(EnvironmentLabel, element)); });
  return renderer;
}

test('a dev build says so on screen; a production build shows nothing', () => {
  assert.equal(render(undefined, {}).toJSON(), null);
  assert.equal(render('', { variant: 'pill' }).toJSON(), null);
  for (const variant of [undefined, 'strip', 'pill']) {
    const shown = render('Dev', variant ? { variant } : {});
    assert.equal(shown.root.findByType('Text').props.children.join(''), 'Dev · Sample data only');
    assert.equal(shown.root.findByType('View').props.accessibilityLabel, 'Dev environment. Sample data only.');
  }
  // Its own color: not the orange, blue or red of the offline and sync banners.
  const color = (variant) => render('Dev', { variant }).root.findByType('View').props.style.backgroundColor;
  assert.equal(color('strip'), 'info');
  assert.equal(color('pill'), 'info');
});

test('the sign-in screen carries the label of a dev build', async () => {
  const open = async (label) => {
    const loader = createModuleLoader({ globals: env(label), stubs: {
      react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
      'react-native': { View: 'View', Text: 'Text', Image: 'Image', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'ios' }, StyleSheet: { create: (styles) => styles } },
      'expo-router': { router: { replace: () => {} } },
      '@/lib/supabase': { supabase: { auth: {} } },
      '@/stores/authStore': { useAuthStore: (select) => select({ signIn: async () => ({ error: null }) }) },
      '@/components/ui/Button': { Button: 'Button' },
      '@/components/ui/Input': { Input: 'Input' },
      '@/lib/design/tokens': new Proxy({}, { get: (_, key) => (key === '__esModule' ? false : new Proxy({}, { get: () => 1 })) }),
      '@/assets/images/invenio-technologies-logo.png': 1,
    } });
    const LoginScreen = loader.load('./app/(auth)/login.tsx').default;
    let renderer;
    await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(LoginScreen)); });
    return renderer.root.findAll(node => node.type === 'Text').map(node => [].concat(node.props.children).join(''));
  };
  assert.ok((await open('Dev')).includes('Dev · Sample data only'));
  assert.ok(!(await open(undefined)).some(text => /Sample data/.test(text)));
});

test('each build profile names the environment its settings come from', () => {
  // Left unsaid, the build service picks one from the profile's other fields, and a
  // production build that drew dev's settings would connect the production app to dev.
  const { build } = JSON.parse(require('node:fs').readFileSync(path.join(root, 'eas.json'), 'utf8'));
  assert.deepEqual(Object.keys(build).sort(), ['development', 'preview', 'production']);
  for (const [profile, settings] of Object.entries(build)) {
    assert.equal(settings.environment, profile, `${profile} builds with the ${profile} environment's settings`);
    assert.equal(settings.channel, profile, `${profile} builds listen for ${profile} updates`);
  }
});

test('the label is a setting, never written into the app or its build profiles', () => {
  const fs = require('node:fs');
  // A profile that named the label itself could disagree with the database address set beside it.
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'), /ENVIRONMENT_LABEL/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'app.json'), 'utf8'), /ENVIRONMENT_LABEL|\.dev"/);
});
