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
  const auth = { user: { id: 'worker-a' }, activeProject: { id: 'project-a' } };
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
    '@/stores/authStore': { useAuthStore: { getState: () => auth } },
    'lib/api/inventory.ts': { withTimeout: (work) => Promise.resolve(work) },
  }, globals: { Date } });
  return { api: loader.load('./lib/api/photos.ts'), requests, signing, auth };
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
  assert.deepEqual(plain(found.photos.map(photo => [photo.label, photo.short, photo.uri])), [
    ['Count photo', 'Count', 'https://files.test/inventory-photos/u1/op-9-0.jpg'],
    ['Receiving photo: Damage', 'Damage', `https://files.test/inspection-photos/${RECEIPT}/op-1-0-damage.jpg`],
    ['Receiving photo: Delivery ticket', 'Delivery ticket', `https://files.test/inspection-photos/${RECEIPT}/op-1-1-delivery_ticket.jpg`],
  ]);
  assert.equal(found.missing, 0);
  const asked = h.requests.map(request => [request.table, request.scoped]);
  assert.deepEqual(asked, [['inspection_photos', false], ['inventory_records', true], ['inventory_photos', true]], 'receiving photos have no project; the rest are asked for in the active project');
  assert.deepEqual(plain(h.requests[2].calls.find(([name]) => name === 'in')), ['in', 'inventory_uid', ['u1']]);
  assert.deepEqual(plain(h.signing.map(call => [call.bucket, call.paths.length, call.seconds])), [['inspection-photos', 2, 3600], ['inventory-photos', 1, 3600]]);
  assert.equal(h.api.photoTakenText('2026-10-27T19:05:00Z'), 'Oct 27, 2026, 2:05 PM');
  assert.equal(h.api.photoTakenText(null), '');
});

test('what was found is kept for the same account and project while its links last, and ordered by the moment taken', async () => {
  const h = photosApi({ tables: { ...tables, inspection_photos: [
    { receiving_record_id: RECEIPT, storage_path: `${RECEIPT}/b.jpg`, photo_type: 'general', created_at: '2026-10-27T19:05:00.5+00:00' },
    { receiving_record_id: RECEIPT, storage_path: `${RECEIPT}/a.jpg`, photo_type: 'damage', created_at: '2026-10-27T19:05:00+00:00' },
    { receiving_record_id: RECEIPT, storage_path: '', photo_type: 'general', created_at: '2026-10-27T19:06:00+00:00' },
  ] } });
  assert.equal(h.api.keptItemPhotos(RECEIPT), null, 'nothing kept before the first answer');
  const found = await h.api.fetchItemPhotos(RECEIPT);
  assert.deepEqual(plain(found.photos.map(photo => photo.short)), ['Count', 'Damage', 'General'], 'a whole second sorts before a later fraction of it');
  assert.equal(found.missing, 1, 'a listed photo with no file counts as one that could not be opened');
  assert.equal(h.api.keptItemPhotos(RECEIPT), found);
  h.auth.activeProject = { id: 'project-b' };
  assert.equal(h.api.keptItemPhotos(RECEIPT), null, 'not for another project');
  h.auth.activeProject = { id: 'project-a' };
  h.auth.user = { id: 'worker-b' };
  assert.equal(h.api.keptItemPhotos(RECEIPT), null, 'not for another account');
  h.auth.user = { id: 'worker-a' };
  assert.ok(h.api.PHOTO_KEEP_MS < h.api.PHOTO_LINK_SECONDS * 1000);
});

test('asking again reuses fresh links, so photos already shown don\'t download again; old or failed ones get new links', async () => {
  const h = photosApi({ tables });
  const first = await h.api.fetchItemPhotos(RECEIPT);
  assert.equal(h.signing.length, 2, 'one request per storage area');
  const again = await h.api.fetchItemPhotos(RECEIPT);
  assert.equal(h.signing.length, 2, 'no new links for photos already linked');
  assert.deepEqual(plain(again.photos.map(photo => photo.uri)), plain(first.photos.map(photo => photo.uri)));
  const failed = first.photos[1].id;
  await h.api.fetchItemPhotos(RECEIPT, { resign: [failed] });
  assert.deepEqual(plain(h.signing.slice(2).map(call => call.paths)), [[`${RECEIPT}/op-1-0-damage.jpg`]], 'only the photo that failed');
  const now = Date.now;
  try {
    Date.now = () => now() + h.api.PHOTO_KEEP_MS + 1;
    assert.ok(h.api.keptItemPhotos(RECEIPT), 'what was found still shows, whatever its age');
    await h.api.fetchItemPhotos(RECEIPT);
    assert.equal(h.signing.length, 5, 'links close to their hour are given again');
  } finally { Date.now = now; }
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
function photosSection(answers, { native = {} } = {}) {
  const network = { isOnline: true };
  const calls = [], kept = new Map(), asked = [];
  const element = (name) => (props) => React.createElement(name, props, props.children);
  const loader = createModuleLoader({ stubs: {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { View: 'View', Text: 'Text', Image: 'Image', Pressable: 'Pressable', ScrollView: 'ScrollView', Modal: 'Modal', StyleSheet: { create: (s) => s }, ...native },
    '@expo/vector-icons/FontAwesome': element('Icon'),
    '@/components/ui/Button': { Button: (props) => React.createElement('Button', props) },
    '@/lib/api/photos': {
      fetchItemPhotos: async (receipt, options = {}) => {
        // As lib/api/photos.ts does: offline, the server is not asked.
        if (!network.isOnline) return null;
        calls.push(receipt);
        asked.push(options.resign ?? []);
        const next = await answers.shift();
        if (next instanceof Error) throw next;
        if (next) kept.set(receipt, next);
        return next;
      },
      keptItemPhotos: (receipt) => kept.get(receipt) ?? null,
      photoTakenText: (iso) => iso ? `taken ${iso.slice(0, 10)}` : '',
    },
    '@/lib/inventory/count': { shortDate: (iso) => iso ? `on ${iso.slice(5, 10)}` : '' },
    '@/lib/sync/networkStore': { useNetworkStore: Object.assign((select) => select(network), { getState: () => network }) },
    '@/lib/design/tokens': { colors: new Proxy({}, { get: () => '#000' }), radius: new Proxy({}, { get: () => 4 }), space: new Proxy({}, { get: () => 4 }), fontSize: new Proxy({}, { get: () => 4 }), fontWeight: new Proxy({}, { get: () => '500' }), touchTarget: 44 },
  } });
  return { ItemPhotos: loader.load('./components/photos/ItemPhotos.tsx').ItemPhotos, network, calls, kept, asked };
}
const settle = () => TestRenderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
const textOf = (r) => r.root.findAll(n => n.type === 'Text').map(n => [].concat(n.props.children).join('')).join(' | ');
const photo = (n, label, takenAt) => ({ id: `p${n}`, uri: `https://files.test/p${n}.jpg`, label, short: label === 'Count photo' ? 'Count' : label.replace('Receiving photo: ', ''), takenAt });
const thumbsOf = (r) => r.root.findAll(n => n.type === 'Pressable' && n.props.accessibilityRole === 'imagebutton');
const render = async (h, receipt) => { let r; await TestRenderer.act(async () => { r = TestRenderer.create(React.createElement(h.ItemPhotos, { receivingRecordId: receipt })); }); await settle(); return r; };
const rerender = async (r, h, receipt) => { await TestRenderer.act(async () => { r.update(React.createElement(h.ItemPhotos, { receivingRecordId: receipt })); }); await settle(); };

test('the item screen shows its photos, and one opens full screen and pages to the next', async () => {
  const h = photosSection([{ photos: [photo(1, 'Count photo', '2026-10-26T15:00:00Z'), photo(2, 'Receiving photo: Damage', '2026-10-27T19:05:00Z')], missing: 1 }]);
  let r;
  await TestRenderer.act(async () => { r = TestRenderer.create(React.createElement(h.ItemPhotos, { receivingRecordId: RECEIPT })); });
  await settle();
  assert.deepEqual(h.calls, [RECEIPT]);
  const thumbs = r.root.findAll(n => n.type === 'Pressable' && n.props.accessibilityRole === 'imagebutton');
  assert.deepEqual(thumbs.map(n => n.props.accessibilityLabel), ['Open photo 1 of 2: Count photo · taken 2026-10-26', 'Open photo 2 of 2: Receiving photo: Damage · taken 2026-10-27']);
  assert.match(textOf(r), /1 photo could not be opened\./);
  assert.match(textOf(r), /Count \| on 10-26 \| Damage \| on 10-27/, 'each thumbnail says what it is and when');
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
  const h = photosSection([{ photos: [], missing: 0 }, new Error('down'), { photos: [photo(3, 'Count photo', null)], missing: 0 }]);
  h.network.isOnline = false;
  let r;
  await TestRenderer.act(async () => { r = TestRenderer.create(React.createElement(h.ItemPhotos, { receivingRecordId: RECEIPT })); });
  await settle();
  assert.match(textOf(r), /Photos show when this phone is online\./);
  h.network.isOnline = true;
  await TestRenderer.act(async () => { r.update(React.createElement(h.ItemPhotos, { receivingRecordId: RECEIPT })); });
  await settle();
  assert.equal(h.calls.length, 1, 'asked once online, not before');
  assert.match(textOf(r), /No photos were taken for this item\./);

  await TestRenderer.act(async () => { r.update(React.createElement(h.ItemPhotos, { receivingRecordId: 'another' })); });
  await settle();
  assert.match(textOf(r), /Photos could not be loaded\./);
  await TestRenderer.act(async () => { r.root.findByType('Button').props.onPress(); });
  await settle();
  assert.equal(r.root.findAll(n => n.type === 'Pressable' && n.props.accessibilityRole === 'imagebutton').length, 1);
  assert.deepEqual(h.calls, [RECEIPT, 'another', 'another']);

  const none = photosSection([]);
  let empty;
  await TestRenderer.act(async () => { empty = TestRenderer.create(React.createElement(none.ItemPhotos, { receivingRecordId: null })); });
  assert.equal(empty.toJSON(), null, 'no receipt, no section');
});

test('photos already seen come back at once when the screen reloads, offline too, without asking again', async () => {
  const h = photosSection([{ photos: [photo(1, 'Receiving photo: Damage', '2026-10-27T19:05:00Z')], missing: 0 }]);
  const first = await render(h, RECEIPT);
  assert.equal(thumbsOf(first).length, 1);
  await TestRenderer.act(async () => { first.unmount(); });
  h.network.isOnline = false;
  const again = await render(h, RECEIPT);
  assert.equal(thumbsOf(again).length, 1, 'the reloaded screen shows them');
  assert.doesNotMatch(textOf(again), /Loading|Photos show when/);
  assert.match(textOf(again), /Showing what this phone found earlier\. New photos load when it is online\./);
  assert.deepEqual(h.calls, [RECEIPT], 'and the server is not asked again');
});

test('a thumbnail that fails to download says Unavailable, offers Reload photos, and gets a new link; the viewer says so for itself', async () => {
  const h = photosSection([
    { photos: [photo(1, 'Count photo', '2026-10-26T15:00:00Z'), photo(2, 'Receiving photo: Damage', '2026-10-27T19:05:00Z')], missing: 0 },
    { photos: [photo(5, 'Count photo', '2026-10-26T15:00:00Z'), photo(2, 'Receiving photo: Damage', '2026-10-27T19:05:00Z')], missing: 0 },
  ]);
  const r = await render(h, RECEIPT);
  await TestRenderer.act(async () => { r.root.findAllByType('Image')[0].props.onError(); });
  assert.match(textOf(r), /Unavailable/);
  assert.match(textOf(r), /1 photo did not load\./);
  assert.equal(thumbsOf(r)[0].props.accessibilityLabel, 'Photo 1 of 2, unavailable: Count photo · taken 2026-10-26', 'screen readers hear it too');
  // The second photo opens; its failure in the viewer doesn't mark its thumbnail.
  await TestRenderer.act(async () => { thumbsOf(r)[1].props.onPress(); });
  const big = () => r.root.findAll(n => n.type === 'Image' && n.props.resizeMode === 'contain');
  await TestRenderer.act(async () => { big()[0].props.onError(); });
  assert.match(textOf(r), /This photo could not be opened\./);
  assert.equal(r.root.findAll(n => n.type === 'Image' && n.props.resizeMode !== 'contain').length, 1, 'its thumbnail still shows');
  await TestRenderer.act(async () => { r.root.findByType('Modal').props.onRequestClose(); });
  // Reload photos asks for new links for the one that failed, while the phone stays online.
  await TestRenderer.act(async () => { r.root.findByType('Button').props.onPress(); });
  await settle();
  assert.deepEqual(plain(h.asked), [[], ['p1']]);
  assert.doesNotMatch(textOf(r), /Unavailable|did not load/);
  assert.equal(r.root.findAllByType('Image')[0].props.source.uri, 'https://files.test/p5.jpg');
});
test('a load that fails offline says photos need a connection; one interrupted by a dropped signal tries again by itself', async () => {
  const offline = photosSection([new Error('Network request failed')]);
  offline.network.isOnline = false;
  // The phone thought it was online when the load started, and lost the signal before it failed.
  offline.network.isOnline = true;
  let r;
  await TestRenderer.act(async () => { r = TestRenderer.create(React.createElement(offline.ItemPhotos, { receivingRecordId: RECEIPT })); offline.network.isOnline = false; });
  await settle();
  assert.match(textOf(r), /Photos show when this phone is online\./);
  assert.equal(r.root.findAll(n => n.type === 'Button').length, 0, 'no Try again while offline');

  let fail;
  const dropped = photosSection([new Promise((_, reject) => { fail = reject; }), { photos: [photo(4, 'Count photo', null)], missing: 0 }]);
  const s = await render(dropped, RECEIPT);
  dropped.network.isOnline = false;
  await rerender(s, dropped, RECEIPT);
  dropped.network.isOnline = true;
  await rerender(s, dropped, RECEIPT);
  assert.equal(dropped.calls.length, 1, 'still the first load');
  await TestRenderer.act(async () => { fail(new Error('timed out')); });
  await settle();
  assert.equal(dropped.calls.length, 2, 'it tried again by itself');
  assert.equal(thumbsOf(s).length, 1);
});

test('a different item never shows the last item\'s photos, even for a moment', async () => {
  let release, item = 'receipt-a';
  // What each render draws, and for which item the screen was asking.
  const drawn = [];
  const native = {
    Image: (props) => { drawn.push([item, 'image', props.source.uri]); return React.createElement('Image', props); },
    Modal: (props) => { drawn.push([item, 'viewer', props.visible]); return React.createElement('Modal', props, props.children); },
  };
  const h = photosSection([{ photos: [photo(1, 'Count photo', null)], missing: 0 }, new Promise(resolve => { release = resolve; })], { native });
  const r = await render(h, item);
  await TestRenderer.act(async () => { thumbsOf(r)[0].props.onPress(); });
  assert.ok(drawn.some(([at, what, value]) => at === 'receipt-a' && what === 'viewer' && value === true), 'the first item\'s photo was open');
  item = 'receipt-b';
  await rerender(r, h, item);
  assert.deepEqual(drawn.filter(([at, what, value]) => at === 'receipt-b' && (what === 'image' || value === true)), [], 'no photo of the first item and no open viewer while the second loads');
  assert.match(textOf(r), /Loading photos…/);
  await TestRenderer.act(async () => { release({ photos: [photo(2, 'Count photo', null), photo(3, 'Count photo', null)], missing: 0 }); });
  await settle();
  assert.equal(thumbsOf(r).length, 2);
  assert.deepEqual(drawn.filter(([at, what]) => at === 'receipt-b' && what === 'image').map(([, , uri]) => uri), ['https://files.test/p2.jpg', 'https://files.test/p3.jpg']);
});

test('photos already found show at once and the server is still asked, so a photo added since appears', async () => {
  const h = photosSection([{ photos: [], missing: 0 }, { photos: [photo(7, 'Receiving photo: Damage', '2026-10-27T19:05:00Z')], missing: 0 }]);
  const first = await render(h, RECEIPT);
  assert.match(textOf(first), /No photos were taken for this item\./);
  await TestRenderer.act(async () => { first.unmount(); });
  // The item is scanned again after its photo finished uploading.
  const again = await render(h, RECEIPT);
  assert.equal(h.calls.length, 2, 'asked again');
  assert.equal(thumbsOf(again).length, 1, 'and the new photo shows');
});

test('a refresh never takes photos off the screen, even when the signal drops again before it answers', async () => {
  let answer;
  const h = photosSection([
    { photos: [photo(1, 'Count photo', null), photo(2, 'Receiving photo: Damage', null)], missing: 0 },
    new Promise(resolve => { answer = resolve; }),
  ]);
  const r = await render(h, RECEIPT);
  await TestRenderer.act(async () => { r.root.findAllByType('Image')[1].props.onError(); });
  h.network.isOnline = false;
  await rerender(r, h, RECEIPT);
  h.network.isOnline = true;
  await rerender(r, h, RECEIPT);
  assert.equal(h.calls.length, 2, 'back online, the failed photo is asked for again');
  assert.equal(thumbsOf(r).length, 2, 'while the photos stay');
  assert.doesNotMatch(textOf(r), /Loading photos/);
  h.network.isOnline = false;
  await rerender(r, h, RECEIPT);
  await TestRenderer.act(async () => { answer(null); });
  await settle();
  assert.equal(thumbsOf(r).length, 2, 'the signal dropped again: they still stay');
  assert.doesNotMatch(textOf(r), /Photos show when this phone is online/);
});

test('a thumbnail whose old link failed shows again once the check gives it a new one', async () => {
  let answer;
  const h = photosSection([{ photos: [photo(1, 'Receiving photo: Damage', null)], missing: 0 }, new Promise(resolve => { answer = resolve; })]);
  const first = await render(h, RECEIPT);
  await TestRenderer.act(async () => { first.unmount(); });
  // Reopened after the link's hour: the kept link fails before the check answers.
  const again = await render(h, RECEIPT);
  await TestRenderer.act(async () => { again.root.findByType('Image').props.onError(); });
  assert.match(textOf(again), /Unavailable/);
  await TestRenderer.act(async () => { answer({ photos: [{ ...photo(1, 'Receiving photo: Damage', null), uri: 'https://files.test/p1-new.jpg' }], missing: 0 }); });
  await settle();
  assert.doesNotMatch(textOf(again), /Unavailable|did not load/);
  assert.equal(again.root.findByType('Image').props.source.uri, 'https://files.test/p1-new.jpg');
});

test('a check behind photos already shown says when it fails, offers Check again, and runs again when the signal returns', async () => {
  let cut;
  const h = photosSection([
    { photos: [photo(1, 'Receiving photo: Damage', null)], missing: 0 },
    new Error('server error'),
    { photos: [photo(1, 'Receiving photo: Damage', null), photo(2, 'Count photo', null)], missing: 0 },
    new Promise((_, reject) => { cut = reject; }),
    { photos: [photo(1, 'Receiving photo: Damage', null), photo(2, 'Count photo', null), photo(3, 'Count photo', null)], missing: 0 },
  ]);
  const first = await render(h, RECEIPT);
  await TestRenderer.act(async () => { first.unmount(); });
  const r = await render(h, RECEIPT);
  assert.equal(thumbsOf(r).length, 1, 'what was found stays');
  assert.match(textOf(r), /New photos could not be checked\./);
  await TestRenderer.act(async () => { r.root.findByType('Button').props.onPress(); });
  await settle();
  assert.equal(thumbsOf(r).length, 2, 'Check again finds the new photo');
  assert.doesNotMatch(textOf(r), /could not be checked|Checking/);
  // A check cut off by a dropped signal runs again when it returns.
  await TestRenderer.act(async () => { r.unmount(); });
  const s = await render(h, RECEIPT);
  assert.match(textOf(s), /Checking for new photos…/);
  h.network.isOnline = false;
  await rerender(s, h, RECEIPT);
  await TestRenderer.act(async () => { cut(new Error('Network request failed')); });
  await settle();
  assert.match(textOf(s), /New photos load when it is online\./);
  assert.equal(thumbsOf(s).length, 2);
  h.network.isOnline = true;
  await rerender(s, h, RECEIPT);
  assert.equal(thumbsOf(s).length, 3, 'checked again once back online');
  assert.equal(h.calls.length, 5);
});
