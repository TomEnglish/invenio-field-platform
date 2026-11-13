process.env.TZ = 'America/Chicago';
const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const RECEIPT = 'c1111111-1111-4111-8111-111111111111';
const plain = (value) => JSON.parse(JSON.stringify(value));

// lib/api/photos.ts against a fake Supabase that records each request: the
// photos stored for an item's receipt and its count, and their links.
function photosApi({ online = true, tables = {}, failing = [], unsigned = [] } = {}) {
  const requests = [], signing = [];
  const query = (table, scoped) => {
    const request = { table, scoped, calls: [] };
    requests.push(request);
    const chain = {
      then(resolve, reject) {
        if (failing.includes(table)) return Promise.resolve({ data: null, error: { message: `${table} is unavailable` } }).then(resolve, reject);
        let rows = (tables[table] ?? []).map(row => ({ ...row }));
        for (const [name, key, value] of request.calls) {
          if (name === 'eq') rows = rows.filter(row => row[key] === value);
          if (name === 'in') rows = rows.filter(row => value.includes(row[key]));
        }
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    for (const name of ['select', 'eq', 'in', 'order']) chain[name] = (...args) => { request.calls.push([name, ...args]); return chain; };
    return chain;
  };
  const storage = { from: (bucket) => ({ createSignedUrls: async (paths, seconds) => {
    signing.push({ bucket, paths, seconds });
    // In reverse, so links are matched by path and not by order.
    return { data: [...paths].reverse().map(path => unsigned.includes(path) ? { path, signedUrl: null, error: 'Object not found' } : { path, signedUrl: `https://files.test/${bucket}/${path}`, error: null }), error: null };
  } }) };
  const loader = createModuleLoader({ stubs: {
    '@/lib/supabase': { supabase: { from: (table) => query(table, false), storage } },
    '@/lib/supabaseProject': { getProjectClient: () => ({ from: (table) => query(table, true) }) },
    '@/lib/sync/networkStore': { useNetworkStore: { getState: () => ({ isOnline: online }) } },
    'lib/api/inventory.ts': { withTimeout: (work) => Promise.resolve(work) },
  } });
  return { api: loader.load('./lib/api/photos.ts'), requests, signing };
}

const tables = {
  inspection_photos: [
    { receiving_record_id: RECEIPT, storage_path: `${RECEIPT}/op-1-1-delivery_ticket.jpg`, photo_type: 'delivery_ticket', created_at: '2026-10-27T19:06:00Z' },
    { receiving_record_id: RECEIPT, storage_path: `${RECEIPT}/op-1-0-damage.jpg`, photo_type: 'damage', created_at: '2026-10-27T19:05:00Z' },
    { receiving_record_id: 'another', storage_path: 'another/op-0-general.jpg', photo_type: 'general', created_at: '2026-10-01T12:00:00Z' },
  ],
  inventory_records: [{ uid: 'u1', receiving_record_id: RECEIPT }, { uid: 'u2', receiving_record_id: 'another' }],
  inventory_photos: [{ inventory_uid: 'u1', storage_path: 'u1/op-9-0.jpg', created_at: '2026-10-26T15:00:00Z' }, { inventory_uid: 'u2', storage_path: 'u2/op-1-0.jpg', created_at: '2026-10-26T16:00:00Z' }],
};

test('an item\'s photos come from its receipt and its count, oldest first, each with a link that lasts an hour', async () => {
  const h = photosApi({ tables });
  const found = await h.api.fetchItemPhotos(RECEIPT);
  assert.deepEqual(plain(found.photos.map(photo => [photo.label, photo.uri])), [
    ['Count photo', 'https://files.test/inventory-photos/u1/op-9-0.jpg'],
    ['Receiving photo: Damage', `https://files.test/inspection-photos/${RECEIPT}/op-1-0-damage.jpg`],
    ['Receiving photo: Delivery ticket', `https://files.test/inspection-photos/${RECEIPT}/op-1-1-delivery_ticket.jpg`],
  ]);
  assert.equal(found.missing, 0);
  const asked = h.requests.map(request => [request.table, request.scoped]);
  assert.deepEqual(asked, [['inspection_photos', false], ['inventory_records', true], ['inventory_photos', true]], 'receiving photos have no project; the rest are asked for in the active project');
  assert.deepEqual(plain(h.requests[2].calls.find(([name]) => name === 'in')), ['in', 'inventory_uid', ['u1']]);
  assert.deepEqual(plain(h.signing.map(call => [call.bucket, call.paths.length, call.seconds])), [['inspection-photos', 2, 3600], ['inventory-photos', 1, 3600]]);
  assert.equal(h.api.photoTakenText('2026-10-27T19:05:00Z'), 'Oct 27, 2026, 2:05 PM');
  assert.equal(h.api.photoTakenText(null), '');
});

test('offline, with no receipt, or with a photo the server can\'t link, it says so instead of guessing', async () => {
  const offline = photosApi({ online: false, tables });
  assert.equal(await offline.api.fetchItemPhotos(RECEIPT), null);
  assert.equal(offline.requests.length, 0, 'nothing is asked offline');
  const none = photosApi({ tables });
  assert.deepEqual(plain(await none.api.fetchItemPhotos(null)), { photos: [], missing: 0 });
  assert.equal(none.requests.length, 0);
  const gone = photosApi({ tables, unsigned: [`${RECEIPT}/op-1-0-damage.jpg`] });
  const found = await gone.api.fetchItemPhotos(RECEIPT);
  assert.deepEqual(plain(found.photos.map(photo => photo.label)), ['Count photo', 'Receiving photo: Delivery ticket']);
  assert.equal(found.missing, 1);
  const broken = photosApi({ tables, failing: ['inspection_photos'] });
  await assert.rejects(broken.api.fetchItemPhotos(RECEIPT), /inspection_photos is unavailable/);
  const noCount = photosApi({ tables: { ...tables, inventory_records: [] } });
  assert.equal((await noCount.api.fetchItemPhotos(RECEIPT)).photos.length, 2);
  assert.equal(noCount.requests.some(request => request.table === 'inventory_photos'), false, 'no count, no count photos asked for');
});

// components/photos/ItemPhotos.tsx with the photo API and network faked.
function photosSection(answers) {
  const network = { isOnline: true };
  const calls = [];
  const element = (name) => (props) => React.createElement(name, props, props.children);
  const loader = createModuleLoader({ stubs: {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { View: 'View', Text: 'Text', Image: 'Image', Pressable: 'Pressable', ScrollView: 'ScrollView', Modal: 'Modal', StyleSheet: { create: (s) => s } },
    '@expo/vector-icons/FontAwesome': element('Icon'),
    '@/components/ui/Button': { Button: (props) => React.createElement('Button', props) },
    '@/lib/api/photos': {
      fetchItemPhotos: async (receipt) => { calls.push(receipt); const next = answers.shift(); if (next instanceof Error) throw next; return next; },
      photoTakenText: (iso) => iso ? `taken ${iso.slice(0, 10)}` : '',
    },
    '@/lib/sync/networkStore': { useNetworkStore: (select) => select(network) },
    '@/lib/design/tokens': { colors: new Proxy({}, { get: () => '#000' }), radius: new Proxy({}, { get: () => 4 }), space: new Proxy({}, { get: () => 4 }), fontSize: new Proxy({}, { get: () => 4 }), fontWeight: new Proxy({}, { get: () => '500' }), touchTarget: 44 },
  } });
  return { ItemPhotos: loader.load('./components/photos/ItemPhotos.tsx').ItemPhotos, network, calls };
}
const settle = () => TestRenderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
const textOf = (r) => r.root.findAll(n => n.type === 'Text').map(n => [].concat(n.props.children).join('')).join(' | ');
const photo = (n, label, takenAt) => ({ id: `p${n}`, uri: `https://files.test/p${n}.jpg`, label, takenAt });

test('the item screen shows its photos, and one opens full screen and pages to the next', async () => {
  const h = photosSection([{ photos: [photo(1, 'Count photo', '2026-10-26T15:00:00Z'), photo(2, 'Receiving photo: Damage', '2026-10-27T19:05:00Z')], missing: 1 }]);
  let r;
  await TestRenderer.act(async () => { r = TestRenderer.create(React.createElement(h.ItemPhotos, { receivingRecordId: RECEIPT })); });
  await settle();
  assert.deepEqual(h.calls, [RECEIPT]);
  const thumbs = r.root.findAll(n => n.type === 'Pressable' && n.props.accessibilityRole === 'imagebutton');
  assert.deepEqual(thumbs.map(n => n.props.accessibilityLabel), ['Open photo 1 of 2: Count photo · taken 2026-10-26', 'Open photo 2 of 2: Receiving photo: Damage · taken 2026-10-27']);
  assert.match(textOf(r), /1 photo could not be opened\./);
  const modal = () => r.root.findByType('Modal');
  assert.equal(modal().props.visible, false);
  await TestRenderer.act(async () => { thumbs[1].props.onPress(); });
  assert.equal(modal().props.visible, true);
  assert.match(textOf(r), /Receiving photo: Damage · taken 2026-10-27 · 2 of 2/);
  const button = (label) => r.root.find(n => n.type === 'Pressable' && n.props.accessibilityLabel === label);
  await TestRenderer.act(async () => { button('Next photo').props.onPress(); });
  assert.match(textOf(r), /Count photo · taken 2026-10-26 · 1 of 2/, 'Next wraps around');
  assert.equal(r.root.findAll(n => n.type === 'Image' && n.props.resizeMode === 'contain')[0].props.source.uri, 'https://files.test/p1.jpg');
  await TestRenderer.act(async () => { button('Close photos').props.onPress(); });
  assert.equal(modal().props.visible, false);
  // Android's back button closes it too.
  await TestRenderer.act(async () => { thumbs[0].props.onPress(); });
  await TestRenderer.act(async () => { modal().props.onRequestClose(); });
  assert.equal(modal().props.visible, false);
});

test('offline it says photos need a connection and loads them once back online; a failure offers to try again', async () => {
  const h = photosSection([null, { photos: [], missing: 0 }, new Error('down'), { photos: [photo(3, 'Count photo', null)], missing: 0 }]);
  h.network.isOnline = false;
  let r;
  await TestRenderer.act(async () => { r = TestRenderer.create(React.createElement(h.ItemPhotos, { receivingRecordId: RECEIPT })); });
  await settle();
  assert.match(textOf(r), /Photos show when this phone is online\./);
  h.network.isOnline = true;
  await TestRenderer.act(async () => { r.update(React.createElement(h.ItemPhotos, { receivingRecordId: RECEIPT })); });
  await settle();
  assert.equal(h.calls.length, 2, 'asked again once online');
  assert.match(textOf(r), /No photos were taken for this item\./);

  await TestRenderer.act(async () => { r.update(React.createElement(h.ItemPhotos, { receivingRecordId: 'another' })); });
  await settle();
  assert.match(textOf(r), /Photos could not be loaded\./);
  await TestRenderer.act(async () => { r.root.findByType('Button').props.onPress(); });
  await settle();
  assert.equal(r.root.findAll(n => n.type === 'Pressable' && n.props.accessibilityRole === 'imagebutton').length, 1);
  assert.deepEqual(h.calls, [RECEIPT, RECEIPT, 'another', 'another']);

  const none = photosSection([]);
  let empty;
  await TestRenderer.act(async () => { empty = TestRenderer.create(React.createElement(none.ItemPhotos, { receivingRecordId: null })); });
  assert.equal(empty.toJSON(), null, 'no receipt, no section');
});
