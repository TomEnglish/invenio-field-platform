const test = require('node:test');
const assert = require('node:assert/strict');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

function setup({ afterWrite } = {}) {
  const records = new Map();
  const writes = [];
  const auth = { accessMode: 'online', loading: false,
    user: { id: 'worker-a', role: 'field_worker', is_active: true },
    activeProject: { id: 'project-a', status: 'active' },
    session: { access_token: 'test-session' },
    availableProjects: [{ id: 'project-a' }, { id: 'project-b' }],
  };
  const storage = {
    getItem: async (key) => records.get(key) ?? null,
    setItem: async (key, value) => { records.set(key, value); },
    removeItem: async (key) => { records.delete(key); },
    getAllKeys: async () => [...records.keys()],
  };
  const recordWrite = async (...args) => {
    writes.push({ userId: auth.user?.id, projectId: auth.activeProject?.id, args });
    if (afterWrite) await afterWrite(auth, writes);
  };
  const loader = createModuleLoader({ stubs: {
    '@react-native-async-storage/async-storage': storage,
    '@/stores/authStore': { useAuthStore: { getState: () => auth } },
    'react-native': { Alert: { alert() {} } },
    'lib/sync/networkStore.ts': { useNetworkStore: { getState: () => ({ isOnline: true }), subscribe: () => () => {} } },
    'lib/api/materials.ts': { transferMaterial: recordWrite, issueMaterial: recordWrite },
    'lib/api/shipments.ts': { createShipment: recordWrite },
    'lib/api/receiving.ts': { lookupOrCreateQRCode: async () => ({ id: 'qr-a' }), submitReceivingRecord: recordWrite },
  } });
  return {
    records, writes, auth,
    queue: loader.load('./lib/sync/offlineQueue.ts'),
    cache: loader.load('./lib/sync/readCache.ts'),
    sync: loader.load('./lib/sync/syncManager.ts'),
  };
}

const issue = {
  type: 'issue',
  payload: { materialId: 'material-a', jobNumber: 'JOB-1', quantity: 3, issuedBy: 'worker-a' },
};

test('queued work retains the user and project that created it', async () => {
  const { queue } = setup();
  await queue.addToQueue(issue);
  const [item] = await queue.getQueue();
  assert.equal(item.userId, 'worker-a');
  assert.equal(item.projectId, 'project-a');
});

test('work cannot enter the offline queue without an authenticated user and project', async () => {
  const { queue, auth } = setup();
  auth.user = null;
  auth.activeProject = null;
  auth.session = null;
  await assert.rejects(() => queue.addToQueue(issue));
  assert.equal((await queue.getQueue()).length, 0);
});

test('queued work keeps one UUID operation identifier across retries', async () => {
  const { queue } = setup();
  await queue.addToQueue(issue);
  const [original] = await queue.getQueue();
  assert.match(original.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  await queue.markFailed(original.id, 'Request outcome unknown');
  const [retry] = await queue.getQueue();
  assert.equal(retry.id, original.id);
  assert.equal(retry.retryCount, 1);
});

for (const changedField of ['user', 'project']) {
  test(`inventory cached by one ${changedField} cannot appear for another ${changedField}`, async () => {
    const { cache, auth } = setup();
    const key = 'materials_in_yard_steel';
    await cache.setCache(key, [{ id: 'private-material-a' }]);
    if (changedField === 'user') auth.user = { ...auth.user, id: 'worker-b' };
    else auth.activeProject = { ...auth.activeProject, id: 'project-b' };
    assert.equal(await cache.getCached(key), null);
    assert.equal(await cache.isCacheFresh(key), false);
  });

  test(`sync preserves work when the active ${changedField} differs from its original context`, async () => {
    const { queue, sync, auth, writes } = setup();
    await queue.addToQueue(issue);
    if (changedField === 'user') auth.user = { ...auth.user, id: 'worker-b' };
    else auth.activeProject = { ...auth.activeProject, id: 'project-b' };
    const result = await sync.processQueue();
    assert.equal(writes.length, 0, 'No business mutation may run using a different user or project');
    assert.equal(result.processed, 0);
    assert.equal(result.failed, 0, 'Waiting for the original context must not consume retries');
    auth.user = { ...auth.user, id: 'worker-a' };
    auth.activeProject = { ...auth.activeProject, id: 'project-a' };
    const remaining = await queue.getQueue();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].retryCount ?? 0, 0);
    await sync.processQueue();
    assert.equal(writes.length, 1, 'The original context can still replay its work');
  });
}

test('legacy queued work without original context is preserved without guessing its project', async () => {
  const { queue, sync, records, writes } = setup();
  records.set('offline_queue', JSON.stringify([{
    id: 'legacy-action', action: issue, createdAt: '2026-09-01T10:00:00.000Z', retryCount: 0,
  }]));
  await sync.processQueue();
  assert.equal(writes.length, 0);
  const remaining = await queue.getQueue();
  assert.equal(remaining.length, 1, 'Unscoped work must remain recoverable');
  assert.equal(remaining[0].id, 'legacy-action');
});

test('sync rechecks context before each action if the user switches projects during replay', async () => {
  const { queue, sync, writes, auth } = setup({
    afterWrite: (state) => { state.activeProject = { ...state.activeProject, id: 'project-b' }; },
  });
  await queue.addToQueue(issue);
  await queue.addToQueue({ ...issue, payload: { ...issue.payload, materialId: 'material-b' } });
  await sync.processQueue();
  assert.equal(writes.length, 1, 'A project switch must stop the next action from using the new project');
  auth.activeProject = { ...auth.activeProject, id: 'project-a' };
  const remaining = await queue.getQueue();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].action.payload.materialId, 'material-b');
});

test('sync executes valid work once and removes it after success', async () => {
  const { queue, sync, writes } = setup();
  await queue.addToQueue(issue);
  const result = await sync.processQueue();
  assert.equal(result.processed, 1);
  assert.equal(result.failed, 0);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].userId, 'worker-a');
  assert.equal(writes[0].projectId, 'project-a');
  assert.equal((await queue.getQueue()).length, 0);
});

test('the same user and project can retrieve their own inventory cache', async () => {
  const { cache } = setup();
  await cache.setCache('materials__', [{ id: 'material-a' }]);
  assert.equal(JSON.stringify(await cache.getCached('materials__')), '[{"id":"material-a"}]');
  assert.equal(await cache.isCacheFresh('materials__'), true);
});
