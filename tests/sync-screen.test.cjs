const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('an older queue read cannot replace a newer empty snapshot', async () => {
  let resolveFirstRead;
  const firstRead = new Promise((resolve) => { resolveFirstRead = resolve; });
  let reads = 0;
  let queueListener;
  const auth = {
    user: { id: 'worker-a' },
    activeProject: { id: 'project-a', name: 'Project A', status: 'active' },
    accessMode: 'online',
    loading: false,
  };
  const useAuthStore = Object.assign(() => auth, { getState: () => auth });
  const useNetworkStore = (selector) => selector({ isOnline: true });
  const belongsToCurrentContext = (item) => item.userId === auth.user.id && item.projectId === auth.activeProject.id;
  const loader = createModuleLoader({ stubs: {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': {
      View: 'View', Text: 'Text', ScrollView: 'ScrollView', Pressable: 'Pressable',
      StyleSheet: { create: (styles) => styles },
    },
    'expo-router': {
      Stack: { Screen: () => React.createElement('StackScreen') },
      Redirect: (props) => React.createElement('Redirect', props),
      useFocusEffect: (effect) => React.useEffect(effect, [effect]),
    },
    'expo-updates': { runtimeVersion: 'test', channel: 'test', updateId: 'test-update', isEmbeddedLaunch: false },
    'expo-constants': { expoConfig: { version: '1.0.0' } },
    '@/stores/authStore': { useAuthStore },
    '@/lib/sync/networkStore': { useNetworkStore },
    '@/lib/sync/offlineQueue': {
      getQueue: async () => (++reads === 1 ? firstRead : []),
      subscribeQueue: (listener) => { queueListener = listener; return () => {}; },
      retryQueueItem: async () => {},
      belongsToCurrentContext,
    },
    '@/lib/sync/syncManager': { processQueue: async () => ({ processed: 0, failed: 0 }) },
    '@/components/ui/Button': { Button: (props) => React.createElement('Button', props) },
    '@/lib/design/tokens': { colors: new Proxy({}, { get: () => '#000' }) },
  } });
  const SyncScreen = loader.load('./app/sync.tsx').default;
  const staleItem = {
    id: 'stale-submission', userId: 'worker-a', projectId: 'project-a',
    action: { type: 'receiving', payload: { material: { material_type: 'Steel Pipe', qty: 4 }, po: {} } },
    createdAt: '2026-09-09T12:00:00.000Z',
  };

  let renderer;
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(SyncScreen)); });
  assert.equal(typeof queueListener, 'function');

  await TestRenderer.act(async () => { queueListener(); await Promise.resolve(); });
  assert.equal(renderer.root.findAllByProps({ children: '0 pending submissions' }).length, 1);

  await TestRenderer.act(async () => { resolveFirstRead([staleItem]); await firstRead; });
  assert.equal(renderer.root.findAllByProps({ children: 'Steel Pipe' }).length, 0);
  assert.equal(renderer.root.findAllByProps({ children: '0 pending submissions' }).length, 1);
  await TestRenderer.act(async () => { renderer.unmount(); });
});
