const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function scanScreen({ material = null, counted = null, area = { path: 'T1 Pipe Racks › Rack 2', locationId: 'rack-t1-1-2' }, areaLater = null } = {}) {
  const routes = [];
  const records = new Map();
  const loader = createModuleLoader({ stubs: {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    zustand: require('zustand'),
    'zustand/middleware': require('zustand/middleware'),
    'react-native': { Platform: { OS: 'ios' } },
    '@react-native-async-storage/async-storage': {
      getItem: async (key) => records.get(key) ?? null,
      setItem: async (key, value) => { records.set(key, value); },
      removeItem: async (key) => { records.delete(key); },
    },
    'expo-router': { router: { push: (route) => routes.push(route) } },
    '@/components/scanning/QRScanner': { QRScanner: (props) => React.createElement('QRScanner', props) },
    '@/components/ui/Button': { Button: (props) => React.createElement('Button', props) },
    '@/lib/api/qrcodes': { lookupMaterialByQR: async () => { if (material === 'offline') throw new Error('Network request failed'); return material; } },
    '@/lib/api/inventory': {
      findInventoryByTag: async (tag) => (counted && counted.qr_code === tag ? counted : null),
      countedAreaInfo: async () => (areaLater ? areaLater : area),
    },
  } });
  const { ScanScreenContent } = loader.load('./components/screens/ScanScreen.tsx');
  const { useReceivingStore } = loader.load('./stores/receivingStore.ts');
  return { ScanScreenContent, useReceivingStore, routes };
}

async function scan(h, code) {
  let renderer;
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(h.ScanScreenContent, { materialDetailRoute: '/(field)/material-detail', receivingRoute: '/(field)/receiving' })); });
  await TestRenderer.act(async () => { await renderer.root.findByType('QRScanner').props.onScan(code); });
  await TestRenderer.act(async () => { renderer.unmount(); });
}

const countedRecord = {
  qr_code: 'GT2-LO-001', inventory_item: 'Lube oil cooler', item_description: 'Shell and tube', part_number: 'LOC-22',
  quantity: '3.000', count_status: 'counted', counted_at: '2026-10-30T15:00:00Z', zone_id: 'zone-b', location: 'Zone B',
};

test('a counted tag that is not yet received opens receiving pre-filled from the count', async () => {
  const h = scanScreen({ counted: countedRecord });
  await scan(h, 'GT2-LO-001');
  const draft = h.useReceivingStore.getState();
  assert.deepEqual(h.routes, ['/(field)/receiving']);
  assert.equal(draft.qrCodeValue, 'GT2-LO-001');
  assert.equal(draft.material.material_type, '', 'material type stays a receiving choice');
  assert.equal(draft.material.qty, 3);
  assert.equal(draft.material.description, 'Lube oil cooler — Shell and tube');
  assert.equal(draft.material.spec, 'LOC-22');
  assert.equal(draft.countedFrom.countedAt, '2026-10-30T15:00:00Z');
  assert.equal(draft.countedFrom.zoneName, 'T1 Pipe Racks › Rack 2');
  assert.equal(draft.location.location_id, 'rack-t1-1-2', 'receiving starts at the rack linked to the area');
  assert.equal(draft.locationLabel, 'T1 Pipe Racks › Rack 2');
});

test('offline scans still use the cached count; unknown and expected tags start a blank receipt', async () => {
  const offline = scanScreen({ material: 'offline', counted: countedRecord });
  await scan(offline, 'GT2-LO-001');
  assert.equal(offline.useReceivingStore.getState().material.spec, 'LOC-22');

  const unknown = scanScreen({ counted: countedRecord });
  await scan(unknown, 'OTHER-TAG');
  assert.equal(unknown.useReceivingStore.getState().material.description, undefined);
  assert.equal(unknown.useReceivingStore.getState().countedFrom, null);

  const expected = scanScreen({ counted: { ...countedRecord, count_status: 'expected' } });
  await scan(expected, 'GT2-LO-001');
  assert.equal(expected.useReceivingStore.getState().countedFrom, null, 'only counted items hand off');
});

test('a received material still opens its detail page', async () => {
  const h = scanScreen({ material: { materialId: 'material-1' }, counted: countedRecord });
  await scan(h, 'GT2-LO-001');
  assert.equal(h.routes[0].params.id, 'material-1');
  assert.equal(h.useReceivingStore.getState().countedFrom, null);
});

test('an area with no linked rack (and none above it) leaves the receiving location to choose', async () => {
  const h = scanScreen({ counted: countedRecord, area: { path: 'T2 Laydown › Bay 4', locationId: null } });
  await scan(h, 'GT2-LO-001');
  const draft = h.useReceivingStore.getState();
  assert.equal(draft.countedFrom.zoneName, 'T2 Laydown › Bay 4');
  assert.equal(draft.location.location_id, '');
});

test('receiving opens at once; the area path and rack fill in after, without overriding a chosen location', async () => {
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  const h = scanScreen({ counted: { ...countedRecord, location: 'Stored path' }, areaLater: slow });
  await scan(h, 'GT2-LO-001');
  assert.deepEqual(h.routes, ['/(field)/receiving'], 'no wait for the area lookup');
  assert.equal(h.useReceivingStore.getState().countedFrom.zoneName, 'Stored path');
  h.useReceivingStore.getState().setLocation({ location_id: 'chosen-by-hand' }, 'Hand-picked');
  await TestRenderer.act(async () => { release({ path: 'T1 Pipe Racks › Rack 2', locationId: 'rack-t1-1-2' }); await slow; });
  const draft = h.useReceivingStore.getState();
  assert.equal(draft.countedFrom.zoneName, 'T1 Pipe Racks › Rack 2');
  assert.equal(draft.location.location_id, 'chosen-by-hand');
});

test('the receiving location is labelled with the area that holds the rack link', async () => {
  const h = scanScreen({ counted: countedRecord, area: { path: 'T1 Pipe Racks › Rack 3', locationId: 'rack-t1', locationLabel: 'T1 Pipe Racks' } });
  await scan(h, 'GT2-LO-001');
  const draft = h.useReceivingStore.getState();
  assert.equal(draft.location.location_id, 'rack-t1');
  assert.equal(draft.locationLabel, 'T1 Pipe Racks', 'the parent that owns the link, not the child');
  assert.equal(draft.countedFrom.zoneName, 'T1 Pipe Racks › Rack 3');
});
