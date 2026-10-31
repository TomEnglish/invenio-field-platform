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
    '@/lib/api/licence': { deleteLicencePhotos: async () => {} }, '@/lib/api/inventory': { forgetLocalCount: async () => {} },
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
    '@/lib/api/licence': { deleteLicencePhotos: async () => {} }, '@/lib/api/inventory': { forgetLocalCount: async () => {} },
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
  assert.ok(button('Discard load change…'), 'it can be left on the other load');
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
      '@/lib/api/licence': { deleteLicencePhotos: async () => {} }, '@/lib/api/inventory': { forgetLocalCount: async () => {} },
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

// One Sync screen over a fixed queue, recording what it removes, forgets and syncs.
function syncSetup(queue, { role = 'field_worker' } = {}) {
  const auth = { user: { id: 'worker-a', role }, activeProject: { id: 'project-a', name: 'Project A', status: 'active' }, accessMode: 'online', loading: false };
  const calls = { removed: [], retried: [], deletedPhotos: [], forgotten: [] };
  let items = queue;
  let listener = () => {};
  const loader = createModuleLoader({ stubs: {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { View: 'View', Text: 'Text', ScrollView: 'ScrollView', Pressable: 'Pressable', StyleSheet: { create: (styles) => styles } },
    'expo-router': { Stack: { Screen: () => null }, Redirect: () => null, useFocusEffect: (effect) => React.useEffect(effect, [effect]), router: { push() {} } },
    '@/stores/countStore': { useCountStore: { getState: () => ({ tag: '' }) } },
    'expo-updates': { runtimeVersion: 'test', channel: 'test', updateId: 'test-update', isEmbeddedLaunch: false },
    'expo-constants': { expoConfig: { version: '1.1.0' } },
    '@/stores/authStore': { useAuthStore: Object.assign(() => auth, { getState: () => auth }) },
    '@/lib/sync/networkStore': { useNetworkStore: (selector) => selector({ isOnline: true }) },
    '@/lib/sync/offlineQueue': {
      getQueue: async () => items, subscribeQueue: (next) => { listener = next; return () => {}; },
      replaceQueuedAction: async () => {}, retryQueueItem: async (id) => { calls.retried.push(id); },
      removeFromQueue: async (id) => { calls.removed.push(id); items = items.filter(item => item.id !== id); listener(); },
      belongsToCurrentContext: () => true,
    },
    '@/lib/api/licence': { deleteLicencePhotos: async (payload) => { calls.deletedPhotos.push(...payload.photos.map(photo => photo.uri)); } },
    '@/lib/api/inventory': { forgetLocalCount: async (tag, operation) => { calls.forgotten.push([tag, operation]); } },
    '@/lib/sync/syncManager': { processQueue: async () => ({ processed: 0, failed: 0 }) },
    '@/components/ui/Button': { Button: (props) => React.createElement('Button', props) },
    '@/components/ui/Input': { Input: (props) => React.createElement('Input', props) },
    '@/lib/design/tokens': { colors: new Proxy({}, { get: () => '#000' }) },
  } });
  return { SyncScreen: loader.load('./app/sync.tsx').default, calls };
}
async function showSync(h) {
  let r;
  await TestRenderer.act(async () => { r = TestRenderer.create(React.createElement(h.SyncScreen)); });
  const buttons = () => r.root.findAll(node => node.type === 'Button');
  const titles = () => buttons().map(node => node.props.title);
  const byLabel = (label) => buttons().filter(node => node.props.accessibilityLabel === label);
  const button = (title) => buttons().find(node => node.props.title === title);
  const texts = () => r.root.findAll(node => node.type === 'Text').map(node => [].concat(node.props.children).flat().join(''));
  const press = async (node) => { await TestRenderer.act(async () => { await node.props.onPress(); }); };
  return { r, titles, byLabel, button, texts, press };
}
const saved = (id, action, extra = {}) => ({ id, userId: 'worker-a', projectId: 'project-a', createdAt: '2026-10-31T10:00:00.000Z', retryCount: 0, deadLetter: false, action, ...extra });
const licence = (id, label, extra) => saved(id, { type: 'licence', payload: { loadId: `load-${id}`, label, photos: [{ uri: `file:///cache/licence-photos/${id}.jpg` }], ...extra.payload } }, { refused: true, ...extra.item });

test('known limits: a licence the server or the device refused has no Retry upload; each card says to discard it', async () => {
  const h = syncSetup([
    licence('forgotten', 'L-0001', { item: { lastErrorCode: 'LICENCE_FORGOTTEN', lastError: 'The licence number is no longer on this device; record the licence again.' } }),
    licence('gone', 'L-0002', { payload: { recorded: true }, item: { lastErrorCode: 'PHOTO_GONE', lastError: 'The licence photos are no longer on this device; record the licence again.' } }),
    licence('server', 'L-0003', { item: { lastErrorCode: '22023', lastError: 'The licence expiry must be a real date' } }),
    licence('storage', 'L-0004', { payload: { recorded: true }, item: { lastErrorCode: 'PHOTO_REFUSED', lastError: 'Licence recorded; storage refused the photo: new row violates row-level security policy' } }),
    licence('full', 'L-0005', { payload: { recorded: true }, item: { lastErrorCode: '22023', lastError: 'Licence recorded; photo will retry: A load keeps at most 4 licence photos' } }),
  ]);
  const s = await showSync(h);
  for (const label of ['L-0001', 'L-0002', 'L-0003', 'L-0004', 'L-0005']) {
    assert.equal(s.byLabel(`Upload ${label}`).length, 0, `${label}: retrying can't help`);
    assert.equal(s.byLabel(`Discard ${label}`)[0].props.title, 'Discard licence…');
  }
  assert.equal(s.texts().filter(text => /record the licence again in Driver check-in/.test(text)).length, 3);
  assert.equal(s.texts().filter(text => /^The licence( number)? is on file, but .*Discard this; the office can remove old photos/.test(text)).length, 2);
  // A licence whose number is on file loses only its photos.
  await s.press(s.byLabel('Discard L-0002')[0]);
  assert.ok(s.texts().includes("Discard this licence? The licence is on file, but its photos will not be uploaded, and this can't be undone."));
  await s.press(s.button('Discard licence'));
  assert.deepEqual(h.calls.removed, ['gone']);
  assert.deepEqual(h.calls.deletedPhotos, ['file:///cache/licence-photos/gone.jpg']);
  assert.ok(s.texts().includes('Licence discarded. Its photos will not be uploaded.'));
  await TestRenderer.act(async () => { s.r.unmount(); });
});

test('known limits: a licence card tells one story: the number on file, and its photos still to go or refused', async () => {
  const h = syncSetup([
    // Retries gave up at the photo upload: the number is on file, so it is a licence, not a receipt.
    licence('photo', 'L-0006', { payload: { recorded: true }, item: { refused: false, retryCount: 5, deadLetter: true, lastError: 'Licence recorded; photo upload will retry: Network request failed' } }),
    licence('closed', 'L-0007', { payload: { recorded: true }, item: { lastErrorCode: '42501', lastError: 'Licence recorded; photo will retry: That load is closed' } }),
  ]);
  const s = await showSync(h);
  assert.ok(s.texts().includes('The licence number is on file. Retry to finish uploading its photos.'));
  assert.equal(s.texts().some(text => /receipt/.test(text)), false);
  assert.equal(s.byLabel('Upload L-0006')[0].props.title, 'Retry upload', 'not refused: it goes when retried');
  assert.ok(s.texts().includes('The licence number is on file, but the server refused its photo: “That load is closed”. Discard this and record the licence again in Driver check-in.'));
  assert.equal(s.byLabel('Upload L-0007').length, 0);
  await s.press(s.byLabel('Discard L-0007')[0]);
  assert.ok(s.texts().includes("Discard this licence? The licence is on file, but its photos will not be uploaded, and this can't be undone."));
  await TestRenderer.act(async () => { s.r.unmount(); });
});

const receipt = { type: 'receiving', payload: { material: { material_type: 'Steel Pipe', qty: 4 }, po: { po_number: 'PO-1042' } } };
test('known limits: a receipt is called a receipt on its Discard button, in the confirmation and after', async () => {
  const h = syncSetup([saved('receipt', receipt, { refused: true, lastErrorCode: '22023', lastError: 'Material is unavailable in this project' })]);
  const s = await showSync(h);
  assert.equal(s.titles().some(title => /change/.test(title)), false, s.titles().join(', '));
  await s.press(s.button('Discard receipt…'));
  assert.ok(s.texts().includes("Discard this receipt? It will not be uploaded, and this can't be undone."));
  assert.equal(h.calls.removed.length, 0, 'nothing goes before confirming');
  await s.press(s.button('Discard receipt'));
  assert.deepEqual(h.calls.removed, ['receipt']);
  assert.ok(s.texts().includes('Receipt discarded. It will not be uploaded.'));
  assert.deepEqual(h.calls.forgotten, []);
  await TestRenderer.act(async () => { s.r.unmount(); });
});

test('known limits: receipts, transfers and issues that automatic retries gave up on can be discarded as well as retried', async () => {
  const dead = { retryCount: 5, deadLetter: true, lastError: 'Network request failed' };
  const h = syncSetup([
    saved('receipt', receipt, dead),
    saved('transfer', { type: 'transfer', payload: { materialId: 'm-1', fromLocationId: null, toLocationId: 'rack-2', movedBy: 'worker-a', reason: 'Rack full' } }, dead),
    saved('issue', { type: 'issue', payload: { materialId: 'm-1', jobNumber: 'J-17', quantity: 2, issuedBy: 'worker-a' } }, dead),
    // Still retrying by itself: nothing to discard yet.
    saved('retrying', { type: 'transfer', payload: { materialId: 'm-2', fromLocationId: null, toLocationId: 'rack-3', movedBy: 'worker-a', reason: 'Moved' } }, { retryCount: 2, lastError: 'Network request failed' }),
    // Not asked for: a shipment (office work) and a count keep retry only; a kind this build doesn't know is kept for an administrator.
    saved('shipment', { type: 'shipment', payload: { materialId: 'm-3', destination: 'Gulf Machine', quantity: 1 } }, dead),
    saved('count', { type: 'count', payload: { count: { tag: 'T-1', name: 'Cooler' }, photos: [] } }, dead),
    saved('newer', { type: 'from_a_newer_build', payload: {} }, { ...dead, lastError: 'Unsupported saved submission type. Ask your administrator to review this device.' }),
  ]);
  const s = await showSync(h);
  assert.deepEqual(s.titles().filter(title => title.startsWith('Discard')), ['Discard receipt…', 'Discard material transfer…', 'Discard material issue…']);
  assert.equal(s.titles().filter(title => title === 'Retry upload').length, 7);
  assert.ok(s.texts().some(text => /Automatic retries have stopped.*retrying or discarding it/.test(text)));
  assert.ok(s.texts().includes('Ask an administrator to review this saved submission. Keep it on this device.'));
  await s.press(s.button('Discard material issue…'));
  assert.ok(s.texts().includes("Discard this material issue? It will not be uploaded, and this can't be undone."));
  await s.press(s.button('Discard material issue'));
  assert.deepEqual(h.calls.removed, ['issue']);
  assert.ok(s.texts().includes('Material issue discarded. It will not be uploaded.'));
  await TestRenderer.act(async () => { s.r.unmount(); });

  // Stopped at its photos, a receipt may already be saved: only the photos go.
  const photos = syncSetup([saved('receipt', receipt, { ...dead, lastError: 'Receipt saved; photo upload will retry: Bucket unavailable' })]);
  const p = await showSync(photos);
  await p.press(p.button('Discard receipt…'));
  assert.ok(p.texts().includes("Discard this receipt? It may already be saved, but its photos will not be uploaded, and this can't be undone."));
  await p.press(p.button('Discard receipt'));
  assert.ok(p.texts().includes('Receipt discarded. Its photos will not be uploaded.'));
  await TestRenderer.act(async () => { p.r.unmount(); });
});

test('known limits: the header banner tells refusals from failed retries', async () => {
  const auth = { user: { id: 'worker-a' }, session: { access_token: 'test' }, activeProject: { id: 'project-a', status: 'active' }, accessMode: 'online', loading: false };
  const queue = [
    saved('waiting', receipt),
    saved('refused', receipt, { refused: true, lastErrorCode: '22023', lastError: 'Material is unavailable in this project' }),
    // Saved before refusals were flagged: the code alone says it.
    saved('not-allowed', receipt, { lastErrorCode: '42501', lastError: 'Office staff only' }),
    saved('dead', receipt, { retryCount: 5, deadLetter: true, lastError: 'Network request failed' }),
    { ...saved('other-project', receipt, { refused: true, lastErrorCode: '22023' }), projectId: 'project-b' },
  ];
  const loader = createModuleLoader({ stubs: {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { View: 'View', Text: 'Text', StyleSheet: { create: (styles) => styles } },
    'expo-router': { Link: (props) => React.createElement('Link', props), useFocusEffect: (effect) => React.useEffect(effect, [effect]) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0 }) },
    '@react-native-async-storage/async-storage': { getItem: async () => JSON.stringify(queue), setItem: async () => {} },
    '@/stores/authStore': { useAuthStore: Object.assign(() => auth, { getState: () => auth }) },
    '@/lib/sync/networkStore': { useNetworkStore: (selector) => selector({ isOnline: true }) },
    '@/lib/design/tokens': { colors: new Proxy({}, { get: () => '#000' }), fontSize: new Proxy({}, { get: () => 12 }), fontWeight: new Proxy({}, { get: () => '600' }), space: new Proxy({}, { get: () => 4 }) },
  } });
  const offlineQueue = loader.load('./lib/sync/offlineQueue.ts');
  assert.deepEqual(JSON.parse(JSON.stringify(await offlineQueue.getQueueStats())), { pending: 1, deadLetters: 1, refused: 2 });
  const { OfflineIndicator } = loader.load('./components/ui/OfflineIndicator.tsx');
  let r;
  await TestRenderer.act(async () => { r = TestRenderer.create(React.createElement(OfflineIndicator)); });
  const shown = r.root.findAll(node => node.type === 'Text').map(node => [].concat(node.props.children).flat().join(''));
  assert.deepEqual(shown, ['1 queued action waiting to sync', '2 queued actions refused: open Sync to decide', '1 queued action failed after multiple retries']);
  assert.equal([].concat(r.root.findByType('Link').props.children).join(''), 'Sync & recovery (4)');
  await TestRenderer.act(async () => { r.unmount(); });
});
