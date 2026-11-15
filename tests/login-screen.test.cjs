const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function openLogin() {
  const calls = { signIns: [], opened: [] };
  const auth = { signIn: async (email, password) => { calls.signIns.push([email, password]); return { error: null }; } };
  const loader = createModuleLoader({ stubs: {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': {
      View: 'View', Text: 'Text', Image: 'Image', KeyboardAvoidingView: 'KeyboardAvoidingView',
      Platform: { OS: 'ios' }, StyleSheet: { create: (styles) => styles },
    },
    'expo-router': { router: { replace: (path) => calls.opened.push(path) } },
    '@/lib/supabase': { supabase: { auth: {} } },
    '@/stores/authStore': { useAuthStore: (select) => select(auth) },
    '@/components/ui/Button': { Button: 'Button' },
    '@/components/ui/Input': { Input: 'Input' },
    '@/lib/design/tokens': new Proxy({}, { get: (_, key) => (key === '__esModule' ? false : new Proxy({}, { get: () => 1 })) }),
    '@/assets/images/invenio-technologies-logo.png': 1,
  } });
  const LoginScreen = loader.load('./app/(auth)/login.tsx').default;
  let renderer;
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(LoginScreen)); });
  const field = (label) => renderer.root.findAll(node => node.type === 'Input' && node.props.label === label)[0];
  const type = (label, text) => TestRenderer.act(async () => { field(label).props.onChangeText(text); });
  const signIn = () => TestRenderer.act(async () => {
    await renderer.root.findAll(node => node.type === 'Button' && node.props.title === 'Sign In')[0].props.onPress();
  });
  const says = (text) => renderer.root.findAll(node => node.type === 'Text' && [].concat(node.props.children).join('') === text).length > 0;
  return { calls, field, type, signIn, says };
}

test('the email field leaves the address as typed: no autocorrect, no capitals', async () => {
  const screen = await openLogin();
  assert.equal(screen.field('Email').props.autoCorrect, false);
  assert.equal(screen.field('Email').props.autoCapitalize, 'none');
});

test('an address with a space after it is still an address, and sign-in goes ahead', async () => {
  const screen = await openLogin();
  await screen.type('Email', 'worker-a@example.com ');
  await screen.type('Password', 'fixture-password');
  await screen.signIn();
  assert.equal(screen.calls.signIns.length, 1);
  assert.deepEqual(screen.calls.opened, ['/']);
});

test('an email of spaces only is asked for again and nothing is sent', async () => {
  const screen = await openLogin();
  await screen.type('Email', '   ');
  await screen.type('Password', 'fixture-password');
  await screen.signIn();
  assert.equal(screen.calls.signIns.length, 0);
  assert.equal(screen.says('Please enter email and password'), true);
  assert.equal(screen.field('Email').props.error, 'Email is required');
  assert.deepEqual(screen.calls.opened, []);
});
