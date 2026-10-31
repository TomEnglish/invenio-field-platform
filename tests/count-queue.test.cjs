const test = require('node:test');
const assert = require('node:assert/strict');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

const OPERATION = '20000000-0000-4000-8000-000000000002';
const UID = 'a1111111-1111-4111-8111-111111111111';
const count = {
  tag: 'GT2-LO-001', name: 'Lube oil cooler', partNumber: 'LOC-22', quantity: '1.5', uom: 'EA', condition: 'good',
  categoryId: null, proposedCategory: { parentId: 'oil', name: 'Pressure Valve' }, siteMapId: 'map-a', pin: { x: 0.42, y: 0.61 }, zoneId: 'zone-b',
};

function countApi(options = {}) {
  const calls = { operations: [], uploads: [], references: [], forgotten: [] };
  const auth = { accessMode: 'online', loading: false, user: { id: 'worker-a' }, session: { access_token: 'test' }, activeProject: { id: 'project-a', status: 'active' } };
  const loader = createModuleLoader({
    stubs: {
      '@/stores/authStore': { useAuthStore: { getState: () => auth } },
      'lib/api/inventory.ts': { forgetLocalCount: async (tag, operation) => { calls.forgotten.push([tag, operation]); } },
      '@/lib/supabase': { supabase: {
        rpc: async (name, args) => {
          if (name === 'apply_field_operation' && options.operationError) { calls.operations.push(args); return { data: null, error: options.operationError }; }
          if (name === 'apply_field_operation') { calls.operations.push(args); return { data: options.result ?? { uid: UID, id: 41, created: true, category_id: 'new-cat', count_status: 'counted' }, error: null }; }
          if (name === 'attach_inventory_photo') { calls.references.push(args); return { data: null, error: options.referenceError ? { message: options.referenceError } : null }; }
          throw new Error(`Unexpected RPC ${name}`);
        },
        storage: { from: (bucket) => ({ upload: async (path, bytes, uploadOptions) => {
          calls.uploads.push({ bucket, path, size: bytes.byteLength, options: uploadOptions });
          if (options.afterUpload) await options.afterUpload(auth);
          return { error: options.uploadError ? { message: options.uploadError } : null };
        } }) },
      } },
    },
    globals: {
      fetch: async (uri) => {
        if (!uri.startsWith('data:')) throw new Error('The test forbids network requests');
        return { arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer };
      },
    },
  });
  return { api: loader.load('./lib/api/count.ts'), calls, auth };
}
const context = { operationId: OPERATION, userId: 'worker-a', projectId: 'project-a' };
const photos = [{ uri: 'data:image/jpeg;base64,AQID' }, { uri: 'data:image/jpeg;base64,BAUG' }];

test('a count is sent as apply_field_operation action "count" with the contract payload, then photos attach under the uid', async () => {
  const { api, calls } = countApi();
  const record = await api.submitCount({ count, photos, context });
  assert.equal(record.uid, UID);
  assert.equal(calls.operations.length, 1);
  const [operation] = calls.operations;
  assert.equal(operation.p_action, 'count');
  assert.equal(operation.p_operation_id, OPERATION);
  assert.equal(operation.p_project_id, 'project-a');
  assert.deepEqual(JSON.parse(JSON.stringify(operation.p_payload)), count);
  assert.deepEqual(calls.uploads.map(u => [u.bucket, u.path, u.options.contentType]), [
    ['inventory-photos', `${UID}/${OPERATION}-0.jpg`, 'image/jpeg'],
    ['inventory-photos', `${UID}/${OPERATION}-1.jpg`, 'image/jpeg'],
  ]);
  assert.deepEqual(calls.references.map(r => [r.p_inventory_uid, r.p_path]), [[UID, `${UID}/${OPERATION}-0.jpg`], [UID, `${UID}/${OPERATION}-1.jpg`]]);
});

test('photo upload and reference failures propagate so the queue retries the same operation', async () => {
  const upload = countApi({ uploadError: 'Bucket unavailable' });
  await assert.rejects(() => upload.api.submitCount({ count, photos, context }), /Count saved; photo upload will retry: Bucket unavailable/);
  assert.equal(upload.calls.references.length, 0);
  const reference = countApi({ referenceError: 'Photo access denied' });
  await assert.rejects(() => reference.api.submitCount({ count, photos, context }), /Photo reference will retry/);
});

test('a count stops before writing photos when the account or project changes', async () => {
  const { api, calls } = countApi({ afterUpload: (auth) => { auth.activeProject = { id: 'project-b', status: 'active' }; } });
  await assert.rejects(() => api.submitCount({ count, photos, context }), /account|project/i);
  assert.equal(calls.uploads.length, 1);
  assert.equal(calls.references.length, 0);
});

test('a server reply without a uid is not treated as saved', async () => {
  const { api, calls } = countApi({ result: { id: 41 } });
  await assert.rejects(() => api.submitCount({ count, photos, context }), /not confirmed/);
  assert.equal(calls.uploads.length, 0);
});

test('known limits: a count the server refuses stops showing as counted on the device; other failures keep it', async () => {
  const refused = countApi({ operationError: { message: 'Category is unavailable in this project', code: '22023' } });
  await assert.rejects(() => refused.api.submitCount({ count, photos, context }), (error) => error.code === '22023');
  assert.deepEqual(refused.calls.forgotten, [['GT2-LO-001', OPERATION]], 'this count, not every count of the tag');
  assert.equal(refused.calls.uploads.length, 0);
  const notAllowed = countApi({ operationError: { message: 'Office staff only', code: '42501' } });
  await assert.rejects(() => notAllowed.api.submitCount({ count, photos, context }));
  assert.deepEqual(notAllowed.calls.forgotten, [['GT2-LO-001', OPERATION]], '42501 is a decision too');

  // A dropped connection or a photo still to upload will go through on a retry.
  const offline = countApi({ operationError: { message: 'Network request failed' } });
  await assert.rejects(() => offline.api.submitCount({ count, photos, context }), /Network request failed/);
  const photo = countApi({ uploadError: 'Bucket unavailable' });
  await assert.rejects(() => photo.api.submitCount({ count, photos, context }), /photo upload will retry/);
  assert.deepEqual([...offline.calls.forgotten, ...photo.calls.forgotten], []);
});

function queueSetup() {
  const records = new Map();
  const writes = [];
  const auth = { accessMode: 'online', loading: false, user: { id: 'worker-a' }, session: { access_token: 'test' }, activeProject: { id: 'project-a', status: 'active' } };
  const loader = createModuleLoader({ stubs: {
    '@react-native-async-storage/async-storage': { getItem: async (k) => records.get(k) ?? null, setItem: async (k, v) => { records.set(k, v); } },
    '@/stores/authStore': { useAuthStore: { getState: () => auth, subscribe: () => () => {} } },
    'lib/sync/networkStore.ts': { useNetworkStore: { getState: () => ({ isOnline: true }), subscribe: () => () => {} } },
    'lib/api/receiving.ts': { submitReceivingRecord: async () => { throw new Error('unexpected receiving'); } },
    'lib/api/materials.ts': { transferMaterial: async () => {}, issueMaterial: async () => {} },
    'lib/api/shipments.ts': { createShipment: async () => {} },
    'lib/api/count.ts': { submitCount: async (input) => { writes.push(JSON.parse(JSON.stringify(input))); } },
    'lib/api/licence.ts': { submitLicence: async () => { throw new Error('unexpected licence'); }, deleteLicencePhotos: async () => {} },
    'lib/api/logistics.ts': { submitPack: async () => { throw new Error('unexpected pack'); }, submitUnpack: async () => { throw new Error('unexpected unpack'); } },
  } });
  return { records, writes, auth, queue: loader.load('./lib/sync/offlineQueue.ts'), sync: loader.load('./lib/sync/syncManager.ts') };
}

test('the count queue action is replayed with its saved payload, photos and original context', async () => {
  const h = queueSetup();
  await h.queue.addToQueue({ type: 'count', payload: { count, photos, categoryLabel: 'Oil › Pressure Valve', zoneName: 'Zone B' } }, OPERATION);
  const [saved] = await h.queue.getQueue();
  assert.equal(saved.userId, 'worker-a');
  assert.equal(saved.projectId, 'project-a');
  const result = await h.sync.processQueue();
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { processed: 1, failed: 0 });
  assert.deepEqual(h.writes, [{ count, photos, context }]);
  assert.equal((await h.queue.getQueue()).length, 0);
});

test('the same count operation cannot be queued twice with different contents', async () => {
  const h = queueSetup();
  await h.queue.addToQueue({ type: 'count', payload: { count, photos: [] } }, OPERATION);
  await h.queue.addToQueue({ type: 'count', payload: { count, photos: [] } }, OPERATION);
  await assert.rejects(() => h.queue.addToQueue({ type: 'count', payload: { count: { ...count, quantity: '2' }, photos: [] } }, OPERATION), /already queued/);
  assert.equal((await h.queue.getQueue()).length, 1);
});

test('Sync offers to fix refused counts, only to discard received tags, and retries everything else', () => {
  const { countRecoveryAction } = createModuleLoader().load('./lib/sync/queuePresentation.ts');
  const item = (lastError, type = 'count') => ({ action: { type, payload: { count, photos: [] } }, lastError });
  assert.equal(countRecoveryAction(item('Category is unavailable in this project')), 'fix');
  assert.equal(countRecoveryAction(item('Quantity must be a positive number with up to 3 decimals')), 'fix');
  assert.equal(countRecoveryAction(item('This tag has already been received')), 'discard');
  assert.equal(countRecoveryAction(item('Choose a location')), 'fix', 'counts queued on build 5 before areas were required');
  assert.equal(countRecoveryAction(item('This area is no longer in use; choose another')), 'fix');
  assert.equal(countRecoveryAction(item('This site plan is no longer in use')), 'fix');
  assert.equal(countRecoveryAction(item('Zone is unavailable on this map')), 'fix');
  for (const retry of ['Count saved; photo upload will retry: x', 'Photo reference will retry: x', 'Network request failed', 'Reconnect and verify access before uploading.', 'JWT expired', 'Return to the original account and project to finish photo uploads.', 'The count was not confirmed by the server. It will retry.', '']) {
    assert.equal(countRecoveryAction(item(retry)), null, retry);
  }
  assert.equal(countRecoveryAction(item('Category is unavailable in this project', 'receiving')), null);
});

test('Sync describes queued counts and their recovery', () => {
  const { queueSummary, queueRecoveryMessage } = createModuleLoader().load('./lib/sync/queuePresentation.ts');
  const item = { action: { type: 'count', payload: { count, photos: [], zoneName: 'Zone B' } } };
  const summary = queueSummary(item);
  assert.equal(summary.title, 'Lube oil cooler');
  assert.equal(summary.detail, 'Inventory count · Tag GT2-LO-001 · 1.5 EA · Zone B');
  assert.equal(queueSummary({ action: { type: 'count' } }).title, 'Inventory count');
  assert.match(queueRecoveryMessage({ ...item, lastError: 'Count saved; photo upload will retry: x' }), /count may already be saved/);
  assert.match(queueRecoveryMessage({ ...item, lastError: 'This tag has already been received' }), /received before the count uploaded/);
  assert.match(queueRecoveryMessage({ ...item, lastError: 'Category is unavailable in this project' }), /archived or changed the category/);
  assert.match(queueRecoveryMessage({ ...item, lastError: 'Unit is too long' }), /Fix it in Count, or discard it/);
  assert.match(queueRecoveryMessage({ ...item, lastError: 'Choose a location' }), /needs a location/);
  assert.match(queueRecoveryMessage({ ...item, lastError: 'This area is no longer in use; choose another' }), /retired the site plan or area/);
  assert.match(queueRecoveryMessage({ ...item, lastError: 'This site plan is no longer in use' }), /retired the site plan or area/);
  assert.match(queueRecoveryMessage({ action: { type: 'receiving' }, lastError: 'Material is unavailable in this project' }), /project access/);
  assert.match(queueRecoveryMessage({ action: { type: 'receiving' }, lastError: 'Receipt saved; photo upload will retry' }), /receipt may already be saved/);
});
