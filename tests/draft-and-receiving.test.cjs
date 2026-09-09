const test = require('node:test');
const assert = require('node:assert/strict');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

function draftStore(records = new Map()) {
  const loader = createModuleLoader({ stubs: {
    zustand: require('zustand'),
    'zustand/middleware': require('zustand/middleware'),
    'react-native': { Platform: { OS: 'ios' } },
    '@react-native-async-storage/async-storage': {
      getItem: async (key) => records.get(key) ?? null,
      setItem: async (key, value) => { records.set(key, value); },
      removeItem: async (key) => { records.delete(key); },
    },
  } });
  return { ...loader.load('./stores/receivingStore.ts'), records };
}

test('receiving drafts preserve independent project data, photos, step and operation identity', async () => {
  const { useReceivingStore: store, switchReceivingScope } = draftStore();
  await switchReceivingScope('worker-a', 'project-a');
  store.getState().setQRCode('PROJECT-A-QR', null);
  store.getState().setMaterial({ material_type: 'Steel', qty: 12 });
  store.getState().addPhoto({ uri: 'data:image/jpeg;base64,AQID', photo_type: 'damage' });
  store.getState().setStep(3);
  const originalOperation = store.getState().operationId;
  assert.ok(originalOperation);
  await switchReceivingScope('worker-a', 'project-b');
  assert.equal(store.getState().qrCodeValue, '');
  assert.equal(store.getState().photos.length, 0);
  assert.notEqual(store.getState().operationId, originalOperation);
  store.getState().setQRCode('PROJECT-B-QR', null);
  await switchReceivingScope('worker-a', 'project-a');
  assert.equal(store.getState().qrCodeValue, 'PROJECT-A-QR');
  assert.equal(store.getState().material.qty, 12);
  assert.equal(store.getState().photos[0].uri, 'data:image/jpeg;base64,AQID');
  assert.equal(store.getState().step, 3);
  assert.equal(store.getState().operationId, originalOperation);
  await switchReceivingScope('worker-a', 'project-b');
  assert.equal(store.getState().qrCodeValue, 'PROJECT-B-QR');
});

test('receiving drafts are isolated between accounts sharing the same project', async () => {
  const { useReceivingStore: store, switchReceivingScope } = draftStore();
  await switchReceivingScope('worker-a', 'project-a');
  store.getState().setQRCode('PRIVATE-A', null);
  await switchReceivingScope('worker-b', 'project-a');
  assert.equal(store.getState().qrCodeValue, '');
  store.getState().setQRCode('PRIVATE-B', null);
  await switchReceivingScope('worker-a', 'project-a');
  assert.equal(store.getState().qrCodeValue, 'PRIVATE-A');
  await switchReceivingScope('worker-b', 'project-a');
  assert.equal(store.getState().qrCodeValue, 'PRIVATE-B');
});

test('signout shows a blank receiving form while preserving the original account draft', async () => {
  const { useReceivingStore: store, switchReceivingScope } = draftStore();
  await switchReceivingScope('worker-a', 'project-a');
  store.getState().setQRCode('SAVED-A', null);
  store.getState().setMaterial({ material_type: 'Private Material', qty: 4 });
  store.getState().addPhoto({ uri: 'file:///documents/private.jpg', photo_type: 'general' });
  const originalOperation = store.getState().operationId;
  await switchReceivingScope(null, null);
  assert.equal(store.getState().qrCodeValue, '');
  assert.equal(store.getState().material.material_type, '');
  assert.equal(store.getState().photos.length, 0);
  assert.equal(store.getState().step, 0);
  await switchReceivingScope('worker-a', 'project-a');
  assert.equal(store.getState().qrCodeValue, 'SAVED-A');
  assert.equal(store.getState().photos.length, 1);
  assert.equal(store.getState().operationId, originalOperation);
});

test('legacy unscoped receiving-wizard data is retained without assigning it to a new user', async () => {
  const legacy = JSON.stringify({ state: { qrCodeValue: 'LEGACY-PRIVATE', photos: [{ uri: 'file:///legacy.jpg' }] }, version: 0 });
  const records = new Map([['receiving-wizard', legacy]]);
  const { useReceivingStore: store, switchReceivingScope } = draftStore(records);
  await switchReceivingScope('worker-a', 'project-a');
  assert.equal(store.getState().qrCodeValue, '');
  assert.equal(store.getState().photos.length, 0);
  await switchReceivingScope(null, null);
  assert.equal(records.get('receiving-wizard'), legacy);
});

test('a restarted store restores its scoped draft and stable operation ID from persistence', async () => {
  const records = new Map();
  const original = draftStore(records);
  await original.switchReceivingScope('worker-a', 'project-a');
  original.useReceivingStore.getState().setQRCode('AFTER-RESTART', null);
  const operationId = original.useReceivingStore.getState().operationId;
  const restarted = draftStore(records);
  await restarted.switchReceivingScope('worker-a', 'project-a');
  assert.equal(restarted.useReceivingStore.getState().qrCodeValue, 'AFTER-RESTART');
  assert.equal(restarted.useReceivingStore.getState().operationId, operationId);
});

const OPERATION = '10000000-0000-4000-8000-000000000001';
const RECEIPT = 'e1111111-1111-4111-8111-111111111111';

function receivingSetup(options = {}) {
  const calls = { operations: [], uploads: [], references: [], reads: [] };
  const auth = {
    user: { id: 'worker-a' }, session: { access_token: 'test-session' },
    activeProject: { id: 'project-a', status: 'active' },
  };
  const loader = createModuleLoader({
    stubs: {
      '@/stores/authStore': { useAuthStore: { getState: () => auth } },
      '@/lib/supabase': { supabase: {
        rpc: async (name, args) => {
          if (name === 'apply_field_operation') {
            calls.operations.push(args);
            if (options.afterReceipt) await options.afterReceipt(auth);
            return { data: { id: RECEIPT }, error: null };
          }
          if (name === 'attach_inspection_photo') {
            calls.references.push(args);
            return { data: null, error: options.referenceError ? { message: options.referenceError } : null };
          }
          throw new Error(`Unexpected RPC ${name}`);
        },
        storage: { from: (bucket) => ({ upload: async (path, bytes, uploadOptions) => {
          calls.uploads.push({ bucket, path, bytes: [...new Uint8Array(bytes)], options: uploadOptions });
          if (options.afterUpload) await options.afterUpload(auth);
          return { error: options.uploadError ? { message: options.uploadError } : null };
        } }) },
      } },
    },
    globals: {
      fetch: async (uri) => {
        if (!uri.startsWith('data:')) throw new Error('The test forbids network requests');
        calls.reads.push(uri);
        return { arrayBuffer: async () => {
          if (options.afterPhotoRead) await options.afterPhotoRead(auth);
          return Uint8Array.from([1, 2, 3]).buffer;
        } };
      },
    },
  });
  const api = loader.load('./lib/api/receiving.ts');
  const input = {
    qrCodeValue: 'RECEIVING-QR', material: { material_type: 'Steel', qty: 10 }, po: {},
    inspection: { condition: 'good', inspection_pass: true }, location: { location_id: 'yard-a' },
    decision: { status: 'accepted', has_exception: false },
    photos: [{ uri: 'data:image/jpeg;base64,AQID', photo_type: 'damage' }],
    userId: 'worker-a', context: { operationId: OPERATION, userId: 'worker-a', projectId: 'project-a' },
  };
  return { api, input, calls, auth };
}

test('receiving retries retain the operation ID and deterministic photo path', async () => {
  const { api, input, calls } = receivingSetup();
  const first = await api.submitReceivingRecord(input);
  const second = await api.submitReceivingRecord(input);
  assert.equal(first.id, RECEIPT);
  assert.equal(second.id, RECEIPT);
  assert.equal(calls.operations.length, 2);
  for (const operation of calls.operations) {
    assert.equal(operation.p_operation_id, OPERATION);
    assert.equal(operation.p_project_id, 'project-a');
    assert.equal(operation.p_action, 'receiving');
    assert.equal(operation.p_payload.qrCodeValue, input.qrCodeValue);
    assert.equal(operation.p_payload.photos, undefined);
  }
  const expectedPath = `${RECEIPT}/${OPERATION}-0-damage.jpg`;
  assert.equal(calls.uploads.length, 2);
  for (const upload of calls.uploads) {
    assert.equal(upload.bucket, 'inspection-photos');
    assert.equal(upload.path, expectedPath);
    assert.deepEqual(upload.bytes, [1, 2, 3]);
    assert.equal(upload.options.upsert, true);
  }
  assert.equal(calls.references.length, 2);
  for (const reference of calls.references) {
    assert.equal(reference.p_record_id, RECEIPT);
    assert.equal(reference.p_path, expectedPath);
    assert.equal(reference.p_type, 'damage');
  }
});

test('photo upload failure rejects submission so the saved receipt can be retried', async () => {
  const { api, input, calls } = receivingSetup({ uploadError: 'Storage unavailable' });
  await assert.rejects(() => api.submitReceivingRecord(input), /Storage unavailable/);
  assert.equal(calls.operations.length, 1);
  assert.equal(calls.uploads.length, 1);
  assert.equal(calls.references.length, 0);
});

test('photo reference failure rejects submission instead of silently losing the attachment', async () => {
  const { api, input, calls } = receivingSetup({ referenceError: 'Reference unavailable' });
  await assert.rejects(() => api.submitReceivingRecord(input), /Reference unavailable/);
  assert.equal(calls.operations.length, 1);
  assert.equal(calls.uploads.length, 1);
  assert.equal(calls.references.length, 1);
});

for (const changed of ['account', 'project']) {
  test(`a receiving receipt cannot be replayed after switching ${changed}`, async () => {
    const { api, input, calls, auth } = receivingSetup();
    if (changed === 'account') auth.user = { id: 'worker-b' };
    else auth.activeProject = { id: 'project-b', status: 'active' };
    await assert.rejects(() => api.submitReceivingRecord(input), /context|account|project/i);
    assert.equal(calls.operations.length, 0);
    assert.equal(calls.uploads.length, 0);
    assert.equal(calls.references.length, 0);
  });
}

test('an account switch while the receipt saves stops its pending photo uploads', async () => {
  const { api, input, calls } = receivingSetup({ afterReceipt: (auth) => { auth.user = { id: 'worker-b' }; } });
  await assert.rejects(() => api.submitReceivingRecord(input), /account|project/i);
  assert.equal(calls.operations.length, 1);
  assert.equal(calls.uploads.length, 0);
  assert.equal(calls.references.length, 0);
});

test('an account switch during photo reading prevents upload under the changed session', async () => {
  const { api, input, calls } = receivingSetup({ afterPhotoRead: (auth) => { auth.user = { id: 'worker-b' }; } });
  await assert.rejects(() => api.submitReceivingRecord(input), /account|project/i);
  assert.equal(calls.uploads.length, 0);
  assert.equal(calls.references.length, 0);
});

test('an account switch during photo upload prevents attachment under the changed session', async () => {
  const { api, input, calls } = receivingSetup({ afterUpload: (auth) => { auth.user = { id: 'worker-b' }; } });
  await assert.rejects(() => api.submitReceivingRecord(input), /account|project/i);
  assert.equal(calls.uploads.length, 1);
  assert.equal(calls.references.length, 0);
});
