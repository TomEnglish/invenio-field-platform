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
      router: { push() {} },
    },
    '@/stores/countStore': { useCountStore: { getState: () => ({ tag: '' }) } },
    'expo-updates': { runtimeVersion: 'test', channel: 'test', updateId: 'test-update', isEmbeddedLaunch: false },
    'expo-constants': { expoConfig: { version: '1.0.0' } },
    '@/stores/authStore': { useAuthStore },
    '@/lib/sync/networkStore': { useNetworkStore },
    '@/lib/sync/offlineQueue': {
      getQueue: async () => (++reads === 1 ? firstRead : []),
      subscribeQueue: (listener) => { queueListener = listener; return () => {}; },
      retryQueueItem: async () => {},
      removeFromQueue: async () => {},
      belongsToCurrentContext,
    },
    '@/lib/api/licence': { deleteLicencePhotos: async () => {} },
    '@/lib/sync/syncManager': { processQueue: async () => ({ processed: 0, failed: 0 }) },
    '@/components/ui/Button': { Button: (props) => React.createElement('Button', props) },
    '@/components/ui/Input': { Input: (props) => React.createElement('Input', props) },
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

test('022: a piece another load had planned can be moved to this load from Sync: the same step, sent again with move', async () => {
  const auth = { user: { id: 'worker-a', role: 'field_worker' }, activeProject: { id: 'project-a', name: 'Project A', status: 'active' }, accessMode: 'online', loading: false };
  const item = {
    id: 'piece', userId: 'worker-a', projectId: 'project-a', createdAt: '2026-10-31T10:00:00.000Z', refused: true, lastErrorCode: '22023',
    lastError: 'PIPE-2: PIPE-2 is planned on load L-0007; move it to this load or take it off that plan first',
    action: { type: 'load_on', payload: { op: { loadId: 'load-a', pieces: [{ code: 'PIPE-2', dropoffStopId: 'stop-1' }] }, label: 'L-0003' } },
  };
  const calls = [];
  let queue = [item];
  const loader = createModuleLoader({ stubs: {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { View: 'View', Text: 'Text', ScrollView: 'ScrollView', Pressable: 'Pressable', StyleSheet: { create: (styles) => styles } },
    'expo-router': { Stack: { Screen: () => null }, Redirect: () => null, useFocusEffect: (effect) => React.useEffect(effect, [effect]), router: { push() {} } },
    '@/stores/countStore': { useCountStore: { getState: () => ({ tag: '' }) } },
    'expo-updates': { runtimeVersion: 'test', channel: 'test', updateId: 'test-update', isEmbeddedLaunch: false },
    'expo-constants': { expoConfig: { version: '1.0.0' } },
    '@/stores/authStore': { useAuthStore: Object.assign(() => auth, { getState: () => auth }) },
    '@/lib/sync/networkStore': { useNetworkStore: (selector) => selector({ isOnline: true }) },
    '@/lib/sync/offlineQueue': {
      getQueue: async () => queue,
      subscribeQueue: () => () => {},
      replaceQueuedAction: async (id, action) => { calls.push(['replace', id, JSON.parse(JSON.stringify(action.payload.op))]); },
      retryQueueItem: async (id) => { calls.push(['retry', id]); },
      removeFromQueue: async () => {},
      belongsToCurrentContext: () => true,
    },
    '@/lib/api/licence': { deleteLicencePhotos: async () => {} },
    '@/lib/sync/syncManager': { processQueue: async () => { calls.push(['sync']); queue = []; return { processed: 1, failed: 0 }; } },
    '@/components/ui/Button': { Button: (props) => React.createElement('Button', props) },
    '@/components/ui/Input': { Input: (props) => React.createElement('Input', props) },
    '@/lib/design/tokens': { colors: new Proxy({}, { get: () => '#000' }) },
  } });
  const SyncScreen = loader.load('./app/sync.tsx').default;
  let renderer;
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(SyncScreen)); });
  const button = (title) => renderer.root.findAll(node => node.type === 'Button' && node.props.title === title)[0];
  assert.ok(renderer.root.findAll(node => node.type === 'Text').some(node => /Move it to this load, or discard this scan/.test([].concat(node.props.children).join(''))));
  assert.ok(button('Discard change…'), 'it can be left on the other load');
  await TestRenderer.act(async () => { await button('Move it to this load').props.onPress(); });
  assert.deepEqual(calls, [['replace', 'piece', { loadId: 'load-a', pieces: [{ code: 'PIPE-2', dropoffStopId: 'stop-1', move: true }] }], ['retry', 'piece'], ['sync']]);
  await TestRenderer.act(async () => { renderer.unmount(); });
});

test('review fixes: a departure held back for the licence can be sent without it by office staff, with a reason; a crew is told to record it', async () => {
  const setupSync = (role) => {
    const auth = { user: { id: 'worker-a', role }, activeProject: { id: 'project-a', name: 'Project A', status: 'active' }, accessMode: 'online', loading: false };
    const item = { id: 'depart', userId: 'worker-a', projectId: 'project-a', createdAt: '2026-10-31T10:00:00.000Z', refused: true, lastErrorCode: '22023',
      lastError: "Record the driver's licence number and a photo of it before load L-0003 leaves", action: { type: 'load_depart', payload: { op: { loadId: 'load-a' }, label: 'L-0003' } } };
    const calls = [];
    const loader = createModuleLoader({ stubs: {
      react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
      'react-native': { View: 'View', Text: 'Text', ScrollView: 'ScrollView', Pressable: 'Pressable', StyleSheet: { create: (styles) => styles } },
      'expo-router': { Stack: { Screen: () => null }, Redirect: () => null, useFocusEffect: (effect) => React.useEffect(effect, [effect]), router: { push() {} } },
      '@/stores/countStore': { useCountStore: { getState: () => ({ tag: '' }) } },
      'expo-updates': { runtimeVersion: 'test', channel: 'test', updateId: 'test-update', isEmbeddedLaunch: false },
      'expo-constants': { expoConfig: { version: '1.0.0' } },
      '@/stores/authStore': { useAuthStore: Object.assign(() => auth, { getState: () => auth }) },
      '@/lib/sync/networkStore': { useNetworkStore: (selector) => selector({ isOnline: true }) },
      '@/lib/sync/offlineQueue': {
        getQueue: async () => [item], subscribeQueue: () => () => {},
        replaceQueuedAction: async (id, action) => { calls.push(['replace', id, JSON.parse(JSON.stringify(action.payload.op))]); },
        retryQueueItem: async (id) => { calls.push(['retry', id]); }, removeFromQueue: async () => {}, belongsToCurrentContext: () => true,
      },
      '@/lib/api/licence': { deleteLicencePhotos: async () => {} },
      '@/lib/sync/syncManager': { processQueue: async () => { calls.push(['sync']); return { processed: 1, failed: 0 }; } },
      '@/components/ui/Button': { Button: (props) => React.createElement('Button', props) },
      '@/components/ui/Input': { Input: (props) => React.createElement('Input', props) },
      '@/lib/design/tokens': { colors: new Proxy({}, { get: () => '#000' }) },
    } });
    return { SyncScreen: loader.load('./app/sync.tsx').default, calls };
  };
  const crew = setupSync('field_worker');
  let renderer;
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(crew.SyncScreen)); });
  const buttons = () => renderer.root.findAll(node => node.type === 'Button').map(node => node.props.title);
  assert.ok(renderer.root.findAll(node => node.type === 'Text').some(node => /Record the licence again in Driver check-in/.test([].concat(node.props.children).join(''))));
  assert.equal(buttons().includes('Leave without the licence (office)…'), false);
  await TestRenderer.act(async () => { renderer.unmount(); });

  const office = setupSync('office_staff');
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(office.SyncScreen)); });
  const button = (title) => renderer.root.findAll(node => node.type === 'Button' && node.props.title === title)[0];
  await TestRenderer.act(async () => { button('Leave without the licence (office)…').props.onPress(); });
  assert.equal(button('Send without the licence').props.disabled, true, 'a reason first');
  await TestRenderer.act(async () => { renderer.root.findByType('Input').props.onChangeText('Licence checked by phone with the carrier'); });
  await TestRenderer.act(async () => { await button('Send without the licence').props.onPress(); });
  assert.deepEqual(office.calls, [['replace', 'depart', { loadId: 'load-a', overrideReason: 'Licence checked by phone with the carrier' }], ['retry', 'depart'], ['sync']]);
  await TestRenderer.act(async () => { renderer.unmount(); });
});
