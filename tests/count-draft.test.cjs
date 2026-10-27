const test = require('node:test');
const assert = require('node:assert/strict');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

function stores(records = new Map()) {
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
  return {
    ...loader.load('./stores/countStore.ts'),
    ...loader.load('./stores/receivingStore.ts'),
    ...loader.load('./stores/fieldScopes.ts'),
    records,
  };
}

const category = { categoryId: 'valve', proposed: null, label: 'Generator 1 › Oil System › Control Valve' };
const location = { siteMapId: 'map-a', pin: { x: 0.4, y: 0.6 }, zoneId: 'zone-b', zoneName: 'Zone B' };

test('count drafts are kept per account and project, with photos, step and operation ID', async () => {
  const { useCountStore: store, switchCountScope } = stores();
  await switchCountScope('worker-a', 'project-a');
  store.getState().start('TAG-A', { match: null, item: { name: 'Cooler' } });
  store.getState().addPhoto({ uri: 'file:///documents/a.jpg' });
  store.getState().setStep(2);
  const operation = store.getState().operationId;
  assert.ok(operation);
  await switchCountScope('worker-a', 'project-b');
  assert.equal(store.getState().tag, '');
  assert.equal(store.getState().photos.length, 0);
  assert.notEqual(store.getState().operationId, operation);
  store.getState().start('TAG-B', { match: null });
  await switchCountScope('worker-b', 'project-a');
  assert.equal(store.getState().tag, '', 'another account on the same project starts blank');
  await switchCountScope('worker-a', 'project-a');
  assert.equal(store.getState().tag, 'TAG-A');
  assert.equal(store.getState().item.name, 'Cooler');
  assert.equal(store.getState().photos[0].uri, 'file:///documents/a.jpg');
  assert.equal(store.getState().step, 2);
  assert.equal(store.getState().operationId, operation);
  await switchCountScope('worker-a', 'project-b');
  assert.equal(store.getState().tag, 'TAG-B');
});

test('signing out shows a blank count while keeping the saved draft, and a restart restores it', async () => {
  const records = new Map();
  const first = stores(records);
  await first.switchCountScope('worker-a', 'project-a');
  first.useCountStore.getState().start('KEEP', { match: null });
  const operation = first.useCountStore.getState().operationId;
  await first.switchCountScope(null, null);
  assert.equal(first.useCountStore.getState().tag, '');
  const restarted = stores(records);
  await restarted.switchCountScope('worker-a', 'project-a');
  assert.equal(restarted.useCountStore.getState().tag, 'KEEP');
  assert.equal(restarted.useCountStore.getState().operationId, operation);
});

test('Count next keeps the category, plan view and zone but starts a new item and operation', async () => {
  const { useCountStore: store, switchCountScope } = stores();
  await switchCountScope('worker-a', 'project-a');
  store.getState().start('TAG-1', { match: { status: 'expected', name: 'Cooler', countedAt: null }, item: { name: 'Cooler', quantity: '2' } });
  store.getState().setCategory(category);
  store.getState().setLocation(location);
  store.getState().setMapView({ mapId: 'map-a', view: { scale: 3, x: -100, y: -50 } });
  store.getState().addPhoto({ uri: 'file:///documents/1.jpg' });
  store.getState().setStep(3);
  const operation = store.getState().operationId;
  store.getState().countNext();
  const next = store.getState();
  assert.equal(next.tag, '');
  assert.equal(next.match, null);
  assert.equal(next.item.name, '');
  assert.equal(next.item.quantity, '1');
  assert.equal(next.photos.length, 0);
  assert.equal(next.step, 0);
  assert.notEqual(next.operationId, operation);
  assert.equal(next.category.categoryId, 'valve');
  assert.equal(next.location.zoneId, 'zone-b');
  assert.equal(next.location.siteMapId, 'map-a');
  assert.equal(next.location.pin, null, 'each item gets its own pin');
  assert.equal(next.mapView.view.scale, 3);
  // A new tag without its own record inherits them; a matched record's own category wins.
  store.getState().start('TAG-2', { match: null });
  assert.equal(store.getState().category.categoryId, 'valve');
  assert.equal(store.getState().location.zoneName, 'Zone B');
  store.getState().start('TAG-3', { match: null, category: { categoryId: 'pump', proposed: null, label: 'Pump' } });
  assert.equal(store.getState().category.categoryId, 'pump');
  store.getState().reset();
  assert.equal(store.getState().category.categoryId, null, 'discarding everything clears the kept values');
});

test('switchFieldScopes moves the receiving and count drafts together', async () => {
  const { useCountStore, useReceivingStore, switchFieldScopes } = stores();
  await switchFieldScopes('worker-a', 'project-a');
  useCountStore.getState().start('COUNT-A', { match: null });
  useReceivingStore.getState().setQRCode('RECEIVE-A', null);
  await switchFieldScopes('worker-a', 'project-b');
  assert.equal(useCountStore.getState().tag, '');
  assert.equal(useReceivingStore.getState().qrCodeValue, '');
  await switchFieldScopes('worker-a', 'project-a');
  assert.equal(useCountStore.getState().tag, 'COUNT-A');
  assert.equal(useReceivingStore.getState().qrCodeValue, 'RECEIVE-A');
});

test('a count draft that cannot be restored reports it after the receiving draft has switched', async () => {
  const records = new Map([['count-draft-worker-a-project-a', '{not json']]);
  const { useReceivingStore, switchFieldScopes } = stores(records);
  await assert.rejects(switchFieldScopes('worker-a', 'project-a'), /count draft could not be restored/);
  assert.equal(records.get('count-draft-worker-a-project-a'), '{not json', 'the stored draft is preserved for recovery');
  useReceivingStore.getState().setQRCode('STILL-SCOPED', null);
  assert.ok(records.get('receiving-wizard-worker-a-project-a')?.includes('STILL-SCOPED'));
});
