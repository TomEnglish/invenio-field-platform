const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const count = {
  tag: 'GT2-LO-001', name: 'Lube oil cooler', partNumber: 'LOC-22', quantity: '2', uom: 'EA', condition: 'good',
  categoryId: 'merged-cat', siteMapId: 'map-a', pin: { x: 0.4, y: 0.6 }, zoneId: 'zone-b', notes: 'Under tarp',
};
const countItem = (id, lastError, extra = {}) => ({
  id, userId: 'worker-a', projectId: 'project-a', createdAt: '2026-10-27T12:00:00.000Z', retryCount: 5, deadLetter: true, lastError,
  action: { type: 'count', payload: { count, photos: [{ uri: 'file:///documents/c.jpg' }], categoryLabel: 'Old › Valve', zoneName: 'Zone B' } },
  ...extra,
});

function syncScreen(queue, { draftTag = '', removeFails = false } = {}) {
  const calls = { removed: [], restored: [], routes: [], countNext: 0 };
  const auth = { user: { id: 'worker-a', role: 'field_worker' }, activeProject: { id: 'project-a', name: 'Training Yard', status: 'active' }, accessMode: 'online', loading: false };
  const countState = {
    tag: draftTag, operationId: 'existing-op',
    restore(draft, step) { calls.restored.push({ draft: JSON.parse(JSON.stringify(draft)), step }); this.tag = draft.tag; this.operationId = 'restored-op'; },
    countNext() { calls.countNext += 1; this.tag = ''; this.operationId = 'next-op'; },
  };
  let listener = () => {};
  const loader = createModuleLoader({ stubs: {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { View: 'View', Text: 'Text', ScrollView: 'ScrollView', Pressable: 'Pressable', StyleSheet: { create: (styles) => styles } },
    'expo-router': {
      Stack: { Screen: () => React.createElement('StackScreen') },
      Redirect: (props) => React.createElement('Redirect', props),
      useFocusEffect: (effect) => React.useEffect(effect, [effect]),
      router: { push: (route) => calls.routes.push(route) },
    },
    'expo-updates': { runtimeVersion: 'test', channel: 'test', updateId: 'test-update', isEmbeddedLaunch: false },
    'expo-constants': { expoConfig: { version: '1.1.0' } },
    '@/stores/authStore': { useAuthStore: Object.assign(() => auth, { getState: () => auth }) },
    '@/stores/countStore': { useCountStore: { getState: () => countState } },
    '@/lib/sync/networkStore': { useNetworkStore: (selector) => selector({ isOnline: true }) },
    '@/lib/sync/offlineQueue': {
      getQueue: async () => queue,
      subscribeQueue: (next) => { listener = next; return () => {}; },
      retryQueueItem: async () => {},
      removeFromQueue: async (id) => {
        if (removeFails) throw new Error('Storage unavailable');
        calls.removed.push(id);
        queue = queue.filter(item => item.id !== id);
        listener();
      },
      belongsToCurrentContext: (item) => item.userId === auth.user.id && item.projectId === auth.activeProject.id,
    },
    '@/lib/sync/syncManager': { processQueue: async () => ({ processed: 0, failed: 0 }) },
    '@/components/ui/Button': { Button: (props) => React.createElement('Button', props) },
    '@/lib/design/tokens': { colors: new Proxy({}, { get: () => '#000' }) },
  } });
  return { SyncScreen: loader.load('./app/sync.tsx').default, calls, countState };
}

const buttons = (renderer, title) => renderer.root.findAll(node => node.type === 'Button' && node.props.title === title);
const texts = (renderer) => renderer.root.findAll(node => node.type === 'Text').map(node => node.children.flat(Infinity).filter(c => typeof c === 'string').join(''));

async function render(h) {
  let renderer;
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(h.SyncScreen)); });
  return renderer;
}

test('a refused count reopens in Count on the step to fix, under a new operation, and leaves the queue', async () => {
  const h = syncScreen([countItem('op-1', 'Category is unavailable in this project')]);
  const renderer = await render(h);
  assert.ok(texts(renderer).some(text => /Fix it in Count to choose again/.test(text)));
  await TestRenderer.act(async () => { await buttons(renderer, 'Fix in Count')[0].props.onPress(); });
  assert.equal(h.calls.restored.length, 1);
  assert.equal(h.calls.restored[0].step, 1, 'opens on the category step');
  assert.deepEqual(h.calls.restored[0].draft.category, { categoryId: 'merged-cat', proposed: null, label: 'Old › Valve' });
  assert.equal(h.calls.restored[0].draft.item.partNumber, 'LOC-22');
  assert.equal(h.calls.restored[0].draft.item.notes, 'Under tarp');
  assert.deepEqual(h.calls.restored[0].draft.location, { siteMapId: 'map-a', pin: { x: 0.4, y: 0.6 }, zoneId: 'zone-b', zoneName: 'Zone B' });
  assert.deepEqual(h.calls.restored[0].draft.photos, [{ uri: 'file:///documents/c.jpg' }]);
  assert.deepEqual(h.calls.removed, ['op-1']);
  assert.deepEqual(h.calls.routes, ['/(field)/count-item']);
  await TestRenderer.act(async () => { renderer.unmount(); });
});

test('a count in progress is never overwritten, and a failed removal keeps only the saved copy', async () => {
  const busy = syncScreen([countItem('op-1', 'Zone is unavailable on this map')], { draftTag: 'OTHER-TAG' });
  let renderer = await render(busy);
  await TestRenderer.act(async () => { await buttons(renderer, 'Fix in Count')[0].props.onPress(); });
  assert.equal(busy.calls.restored.length, 0);
  assert.equal(busy.calls.removed.length, 0);
  assert.ok(texts(renderer).some(text => /Finish or discard the count in progress/.test(text)));
  await TestRenderer.act(async () => { renderer.unmount(); });

  const failing = syncScreen([countItem('op-2', 'Zone is unavailable on this map')], { removeFails: true });
  renderer = await render(failing);
  await TestRenderer.act(async () => { await buttons(renderer, 'Fix in Count')[0].props.onPress(); });
  assert.equal(failing.calls.restored[0].step, 2);
  assert.equal(failing.calls.countNext, 1, 'the reopened draft is cleared again');
  assert.equal(failing.calls.routes.length, 0);
  assert.ok(texts(renderer).some(text => /Could not reopen the count: Storage unavailable/.test(text)));
  await TestRenderer.act(async () => { renderer.unmount(); });
});

test('discarding asks first; a received tag can only be discarded; photo and connection failures just retry', async () => {
  const h = syncScreen([
    countItem('received', 'This tag has already been received'),
    countItem('photo', 'Count saved; photo upload will retry: Bucket unavailable', { deadLetter: false }),
    countItem('offline', 'Network request failed', { deadLetter: false }),
  ]);
  const renderer = await render(h);
  assert.equal(buttons(renderer, 'Fix in Count').length, 0);
  assert.equal(buttons(renderer, 'Discard count…').length, 1, 'only the received tag offers discard');
  assert.equal(buttons(renderer, 'Retry upload').length, 2, 'the received tag has no retry');

  await TestRenderer.act(async () => { buttons(renderer, 'Discard count…')[0].props.onPress(); });
  assert.equal(h.calls.removed.length, 0, 'nothing is removed before confirming');
  await TestRenderer.act(async () => { buttons(renderer, 'Keep it')[0].props.onPress(); });
  assert.equal(buttons(renderer, 'Discard count').length, 0);

  await TestRenderer.act(async () => { buttons(renderer, 'Discard count…')[0].props.onPress(); });
  await TestRenderer.act(async () => { await buttons(renderer, 'Discard count')[0].props.onPress(); });
  assert.deepEqual(h.calls.removed, ['received']);
  assert.ok(texts(renderer).includes('Count discarded. It will not be uploaded.'));
  await TestRenderer.act(async () => { renderer.unmount(); });
});
