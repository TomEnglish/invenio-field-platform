const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const plain = (value) => JSON.parse(JSON.stringify(value));
const element = (name) => (props) => React.createElement(name, props, props.children);
const four = new Proxy({}, { get: () => 4 });
const tokens = { colors: new Proxy({}, { get: () => '#000' }), radius: four, space: four, fontSize: four, fontWeight: four, touchTarget: 44 };

const unit = (code, extra = {}) => ({
  id: `id-${code}`, code, kind: 'crate', description: null, is_high_value: false, status: 'open', parent_id: null, parent_code: null, top_code: code,
  place_id: 'yard', place_name: 'Training Yard', site_map_id: 'map-a', zone_id: 'bay-1', location: 'T2 Laydown › Bay 1', item_count: 0, unit_count: 0, ...extra,
});
const reference = {
  units: [
    unit('HU-AAAA01', { item_count: 1, unit_count: 1, is_high_value: true, description: 'Pump spares' }),
    unit('HU-BBBB02', { parent_id: 'id-HU-AAAA01', parent_code: 'HU-AAAA01', top_code: 'HU-AAAA01' }),
  ],
  items: [{ unit_code: 'HU-AAAA01', tag: 'PIPE-1', name: '6" pipe', quantity: 1, uom: 'EA', material_id: 'm-1', inventory_uid: null }],
  places: [{ id: 'yard', kind: 'yard', name: 'Training Yard', project_id: 'project-a', city: null, state: null }],
  materials: [{ id: 'm-2', tag: 'PIPE-2', name: 'Pipe 4"', quantity: 3 }, { id: 'm-1', tag: 'PIPE-1', name: '6" pipe', quantity: 1 }],
  counted: [], savedAt: '2026-10-29T08:00:00Z',
};
const countReference = {
  categories: [], items: [], images: {}, savedAt: '2026-10-29T08:00:00Z',
  maps: [{ id: 'map-a', name: 'Training Yard', storage_path: null, image_width: null, image_height: null, updated_at: null }],
  zones: [{ id: 'bay-3', map_id: 'map-a', parent_id: null, name: 'Bay 3', shape: [[0, 0], [1, 0], [1, 1]], color: null, sort_order: 0, is_active: true, location_id: null }],
};

// `fresh`: what the server answers per tag (crate lookups are keyed "crates:<code>");
// `gates`: a promise a lookup waits on, to hold it open.
function load({ online = true, fresh = {}, gates = {}, queue = [], refused = [] } = {}) {
  const routes = [], queued = [], lookups = [], announced = [], blur = [], options = [];
  const records = new Map();
  const params = { code: 'hu-aaaa01' };
  const auth = { user: { id: 'worker-a', role: 'field_worker' }, activeProject: { id: 'project-a', status: 'active' } };
  const network = { isOnline: online };
  const answer = async (key) => {
    lookups.push(key);
    if (gates[key]) await gates[key];
    if (!fresh[key]) throw new Error('The server took too long to answer.');
    return fresh[key];
  };
  const loader = createModuleLoader({ stubs: {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    zustand: require('zustand'),
    'zustand/middleware': require('zustand/middleware'),
    'react-native': {
      View: 'View', Text: 'Text', ScrollView: 'ScrollView', Pressable: 'Pressable', RefreshControl: 'RefreshControl', StyleSheet: { create: (s) => s }, Platform: { OS: 'ios' },
      AccessibilityInfo: { announceForAccessibility: (text) => announced.push(text) },
    },
    '@react-native-async-storage/async-storage': { getItem: async (k) => records.get(k) ?? null, setItem: async (k, v) => { records.set(k, v); }, removeItem: async (k) => { records.delete(k); } },
    'expo-router': {
      router: { push: (route) => routes.push(route), replace: (route) => routes.push(route) },
      Stack: { Screen: () => null },
      useLocalSearchParams: () => ({ ...params }),
      useFocusEffect: (effect) => React.useEffect(() => { const cleanup = effect(); blur.push(cleanup); return cleanup; }, [effect]),
    },
    '@expo/vector-icons/FontAwesome': element('Icon'),
    '@/stores/authStore': { useAuthStore: Object.assign((select) => (select ? select(auth) : auth), { getState: () => auth }) },
    '@/lib/sync/networkStore': { useNetworkStore: Object.assign((select) => select(network), { getState: () => network }) },
    '@/lib/sync/offlineQueue': { addToQueue: async (action, id) => { queued.push({ id, action: plain(action) }); return id; }, getQueue: async () => queue },
    '@/lib/sync/syncManager': { processQueue: async () => ({ processed: 0, failed: 0 }) },
    '@/lib/api/logistics': {
      lookupTagOnline: (tag, also = []) => answer(/^hu-/i.test(tag) ? `crates:${[tag, ...also].join(',')}` : tag),
      lookupCratesOnline: async (codes) => (await answer(`crates:${codes.join(',')}`)).units,
    },
    '@/components/logistics/useLoadReference': { useLoadReference: (opts) => { options.push(opts); return loadResult; } },
    '@/components/inventory/useCountReference': { useCountReference: () => ({ data: countReference }) },
    '@/components/scanning/QRScanner': { QRScanner: element('QRScanner') },
    '@/components/logistics/PackDetailsStep': { PackDetailsStep: element('PackDetailsStep') },
    '@/components/logistics/PackContentsStep': { PackContentsStep: element('PackContentsStep') },
    '@/components/logistics/CrateLocationStep': { CrateLocationStep: element('CrateLocationStep') },
    '@/components/logistics/PackReviewStep': { PackReviewStep: element('PackReviewStep') },
    '@/components/ui/Button': { Button: element('Button') },
    '@/components/ui/Toast': { Toast: (props) => (props.visible ? React.createElement('Toast', props) : null) },
    '@/lib/design/tokens': tokens,
  } });
  const crates = loader.load('./lib/logistics/crates.ts');
  const index = crates.indexLoad(reference);
  // One object across renders, as the real hook keeps its state.
  const loadResult = { base: reference, pending: [], refused, data: reference, index, known: index, loading: false, source: 'cache', error: '', reload: async () => {} };
  const { usePackStore, switchPackScope } = loader.load('./stores/packStore.ts');
  return { loader, crates, usePackStore, switchPackScope, routes, queued, lookups, announced, blur, options, params, network, records };
}
const none = { units: [], items: [], materials: [], counted: [] };
const free = (tag, name = tag) => ({ ...none, materials: [{ id: `m-${tag}`, tag, name, quantity: 1 }] });
async function packScreen(h) {
  await h.switchPackScope('worker-a', 'project-a');
  const { PackScreenContent } = h.loader.load('./components/screens/PackScreen.tsx');
  let r;
  await TestRenderer.act(async () => { r = TestRenderer.create(React.createElement(PackScreenContent, { crateRoute: '/(field)/crate', homeRoute: '/(field)/scan' })); });
  const scan = async (type, code) => { let result; await TestRenderer.act(async () => { result = await r.root.findByType(type).props.onScan(code); }); return result; };
  const press = async (type, prop, ...args) => { await TestRenderer.act(async () => { await r.root.findByType(type).props[prop](...args); }); };
  const settle = () => TestRenderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  return { r, scan, press, settle };
}

test('packing: label, details, items scanned in and checked with the server, location, then one queued pack', async () => {
  const h = load({ fresh: {
    'crates:hu-new123': none,
    'PIPE-2': free('PIPE-2', 'Pipe 4"'),
    // Taken out of HU-AAAA01 since the copy was saved.
    'PIPE-1': free('PIPE-1', '6" pipe'),
    'PIPE-9': none,
    'PIPE-8': { ...none, counted: [{ uid: 'u-8', tag: 'PIPE-8', name: 'Spool 8', quantity: 1, uom: 'EA', status: 'counted' }] },
  } });
  const { r, scan, press, settle } = await packScreen(h);
  assert.deepEqual(plain(h.options), plain(h.options.map(() => ({ refresh: true }))), 'Pack refreshes an old copy when online');

  assert.match((await scan('QRScanner', 'GT2-LO-001')).message, /item tag/);
  assert.equal(h.usePackStore.getState().code, '');
  assert.equal((await scan('QRScanner', 'hu-new123')).tone, 'ok');
  const operationId = h.usePackStore.getState().operationId;
  assert.equal(h.usePackStore.getState().code, 'HU-NEW123');
  assert.equal(h.usePackStore.getState().before, null, 'the server has no such crate');
  await press('PackDetailsStep', 'onNext');

  assert.equal((await scan('PackContentsStep', 'PIPE-2')).tone, 'ok', 'accepted at once from the copy…');
  await settle();
  assert.deepEqual(plain(await scan('PackContentsStep', 'PIPE-2')), { tone: 'info', message: 'PIPE-2 is already on the list.' });
  assert.deepEqual(plain(await scan('PackContentsStep', 'PIPE-1')), { tone: 'ok', message: 'PIPE-1 added.' }, 'the server says it is free now');
  assert.deepEqual(plain(await scan('PackContentsStep', 'PIPE-9')), { tone: 'warn', message: "PIPE-9 isn't a received or counted item in this project." });
  assert.equal((await scan('PackContentsStep', 'hu-bbbb02')).tone, 'warn', 'already inside HU-AAAA01 (the server could not be asked)');
  h.network.isOnline = false;
  const offline = await scan('PackContentsStep', 'PIPE-8');
  assert.equal(offline.tone, 'info');
  assert.match(offline.message, /checks it when this uploads/);
  assert.deepEqual(h.lookups, ['crates:hu-new123', 'PIPE-2', 'PIPE-1', 'PIPE-9', 'crates:hu-bbbb02,HU-NEW123'], '…and checked in the background; nothing is asked offline');
  assert.deepEqual(plain(h.usePackStore.getState().add.map(e => [e.tag, !!e.unchecked, e.problem ?? null])), [['PIPE-2', false, null], ['PIPE-1', false, null], ['PIPE-8', true, null]]);

  h.network.isOnline = true;
  await press('PackContentsStep', 'onNext');
  assert.ok(r.root.findByType('CrateLocationStep'));
  await press('CrateLocationStep', 'onNext');
  // Online, a tag scanned offline is checked before saving. The project has
  // areas: sealing a crate that isn't inside another needs one.
  await press('PackReviewStep', 'onSave', true);
  assert.equal(h.lookups.at(-1), 'PIPE-8');
  assert.equal(h.usePackStore.getState().add[2].unchecked, false);
  assert.match(r.root.findByType('PackReviewStep').props.error, /Choose a location/);
  assert.equal(h.queued.length, 0);

  await TestRenderer.act(async () => { h.usePackStore.getState().setLocation({ placeId: 'yard', placeName: 'Training Yard', siteMapId: 'map-a', zoneId: 'bay-3', zoneName: 'Bay 3' }); });
  await press('PackReviewStep', 'onSave', true);
  assert.deepEqual(h.queued, [{ id: operationId, action: { type: 'pack', payload: {
    pack: { unitCode: 'HU-NEW123', seal: true, placeId: 'yard', zoneId: 'bay-3', siteMapId: 'map-a', add: ['PIPE-2', 'PIPE-1', 'PIPE-8'] },
    zoneName: 'Bay 3', placeName: 'Training Yard',
  } } }], 'the whole session is one pack under the draft’s operation ID');
  assert.equal(h.usePackStore.getState().code, '', 'the saved draft is cleared');
  assert.notEqual(h.usePackStore.getState().operationId, operationId);
  const shown = r.root.findAll(n => n.type === 'Text').map(n => [].concat(n.props.children).join(''));
  assert.ok(shown.includes('HU-NEW123 sealed'));
  assert.ok(shown.includes('3 inside'));
  assert.deepEqual(h.announced, ['HU-NEW123 sealed. Saved on this device. It uploads when online; Sync shows anything waiting.', 'HU-NEW123 sealed. Uploaded.'], 'VoiceOver is told, and told again when it uploads');

  // Leaving by the tab bar ends the confirmation; Pack starts at the label next time.
  await TestRenderer.act(async () => { h.blur.forEach(cleanup => cleanup?.()); });
  await TestRenderer.act(async () => { r.update(React.createElement(h.loader.load('./components/screens/PackScreen.tsx').PackScreenContent, { crateRoute: '/(field)/crate', homeRoute: '/(field)/scan' })); });
  assert.ok(r.root.findByType('QRScanner'));
  await TestRenderer.act(async () => { r.unmount(); });
});

test('a crate packed on another device is looked up by its label, so its type and details are not overwritten', async () => {
  const skid = { id: 'id-HU-SKID01', code: 'HU-SKID01', kind: 'skid', description: 'Valves', is_high_value: true, status: 'sealed', parent_id: null, parent_code: null, top_code: 'HU-SKID01',
    place_id: 'yard', place_name: 'Training Yard', site_map_id: 'map-a', zone_id: 'bay-1', location: 'T2 Laydown › Bay 1', item_count: 4, unit_count: 0 };
  const h = load({ fresh: { 'crates:HU-SKID01': { ...none, units: [skid] }, 'PIPE-2': free('PIPE-2') } });
  const { scan, press } = await packScreen(h);
  await scan('QRScanner', 'HU-SKID01');
  const draft = h.usePackStore.getState();
  assert.equal(draft.before.kind, 'skid');
  assert.equal(draft.kind, 'skid');
  assert.equal(draft.description, 'Valves');
  await press('PackDetailsStep', 'onNext');
  await scan('PackContentsStep', 'PIPE-2');
  await press('PackContentsStep', 'onNext');
  await press('CrateLocationStep', 'onNext');
  await press('PackReviewStep', 'onSave', false);
  assert.deepEqual(h.queued[0].action.payload.pack, { unitCode: 'HU-SKID01', seal: false, add: ['PIPE-2'] }, 'only the new item goes');
});

test('a tag the copy accepted but the server refuses is marked, and saving waits for checks still running', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = load({ fresh: {
    'crates:hu-new123': none,
    // A colleague packed it yesterday; the copy doesn't know.
    'PIPE-2': { ...none, items: [{ unit_code: 'HU-YYYY09', tag: 'PIPE-2', name: 'Pipe', quantity: 1, uom: 'EA', material_id: 'm-2', inventory_uid: null }], materials: [{ id: 'm-2', tag: 'PIPE-2', name: 'Pipe', quantity: 3 }] },
    'PIPE-5': { ...none, counted: [{ uid: 'u-5', tag: 'PIPE-5', name: 'Spool 5', quantity: 1, uom: 'EA', status: 'counted' }] },
  }, gates: { 'PIPE-5': gate } });
  const { r, scan, press, settle } = await packScreen(h);
  await scan('QRScanner', 'hu-new123');
  await press('PackDetailsStep', 'onNext');
  assert.equal((await scan('PackContentsStep', 'PIPE-2')).tone, 'ok');
  await settle();
  const [entry] = h.usePackStore.getState().add;
  assert.equal(entry.problem, 'PIPE-2 is already in crate HU-YYYY09; take it out of that crate first.');
  const scanItem = r.root.findByType('PackContentsStep').props.onScan;
  await press('PackContentsStep', 'onNext');
  await press('CrateLocationStep', 'onNext');
  await press('PackReviewStep', 'onSave', false);
  assert.match(r.root.findByType('PackReviewStep').props.error, /already in crate HU-YYYY09.*Remove PIPE-2 from the list/);
  assert.equal(h.queued.length, 0, 'nothing goes while the server says no');

  await TestRenderer.act(async () => { h.usePackStore.getState().dropEntry('PIPE-2'); });
  // The last scan is still being checked (a weak signal) when Save is tapped.
  let scanning, saving;
  await TestRenderer.act(async () => { scanning = scanItem('PIPE-5'); });
  await TestRenderer.act(async () => { saving = r.root.findByType('PackReviewStep').props.onSave(false); });
  assert.equal(h.queued.length, 0, 'save waits for the check');
  await TestRenderer.act(async () => { release(); await scanning; await saving; });
  assert.deepEqual(h.queued.map(q => q.action.payload.pack.add), [['PIPE-5']], 'the last item is in the pack');
});

test('a draft whose pack was already queued (the project changed while saving) starts over', async () => {
  const first = load();
  await first.switchPackScope('worker-a', 'project-a');
  first.usePackStore.getState().begin('HU-NEW123', null);
  const operationId = first.usePackStore.getState().operationId;
  const h = load({ queue: [{ id: operationId }] });
  for (const [key, value] of first.records) h.records.set(key, value);
  await h.switchPackScope('worker-a', 'project-a');
  assert.equal(h.usePackStore.getState().operationId, operationId);
  const { r, settle } = await packScreen(h);
  await settle();
  assert.equal(h.usePackStore.getState().code, '');
  assert.notEqual(h.usePackStore.getState().operationId, operationId);
  await TestRenderer.act(async () => { r.unmount(); });
});

test('the pack draft survives a restart and is kept per account and project', async () => {
  const first = load();
  await first.switchPackScope('worker-a', 'project-a');
  first.usePackStore.getState().begin('HU-NEW123', null);
  first.usePackStore.getState().addEntry({ tag: 'PIPE-2', name: 'Pipe', crate: false });
  first.usePackStore.getState().addEntry({ tag: 'PIPE-2', name: 'Pipe', crate: false });
  const operationId = first.usePackStore.getState().operationId;
  await new Promise(resolve => setTimeout(resolve, 0));
  // Signing in and switching projects move every field draft, this one included.
  const { switchFieldScopes } = first.loader.load('./stores/fieldScopes.ts');
  await switchFieldScopes('worker-a', 'project-b');
  assert.equal(first.usePackStore.getState().code, '', 'another project starts clean');
  await switchFieldScopes('worker-b', 'project-a');
  assert.equal(first.usePackStore.getState().code, '', 'another account starts clean');
  await switchFieldScopes('worker-a', 'project-a');
  assert.equal(first.usePackStore.getState().code, 'HU-NEW123');
  assert.equal(first.usePackStore.getState().add.length, 1, 'a tag goes on the list once');
  assert.equal(first.usePackStore.getState().operationId, operationId);

  // A restarted app (a new store over the same storage) finds the draft.
  const restarted = load();
  for (const [key, value] of first.records) restarted.records.set(key, value);
  await restarted.switchPackScope('worker-a', 'project-a');
  assert.equal(restarted.usePackStore.getState().code, 'HU-NEW123');
  assert.equal(restarted.usePackStore.getState().operationId, operationId);
});

test('the Crate screen shows a crate from the device copy: details, contents, nested crates, Pack, and one queued unpack', async () => {
  const refusedPack = { id: 'op-x', userId: 'worker-a', projectId: 'project-a', lastError: 'PIPE-9 is already in crate HU-ZZZZ01; take it out of that crate first',
    action: { type: 'pack', payload: { pack: { unitCode: 'HU-AAAA01', add: ['PIPE-9'], seal: true } } } };
  const h = load({ online: false, refused: [refusedPack] });
  await h.switchPackScope('worker-a', 'project-a');
  const { CrateScreenContent } = h.loader.load('./components/screens/CrateScreen.tsx');
  const view = () => React.createElement(CrateScreenContent, { crateRoute: '/(field)/crate', packRoute: '/(field)/pack' });
  let r;
  await TestRenderer.act(async () => { r = TestRenderer.create(view()); });
  const shown = () => r.root.findAll(n => n.type === 'Text').map(n => [].concat(n.props.children).join(''));
  for (const text of ['HU-AAAA01', 'Open', 'High value', 'Crate · Pump spares', 'Training Yard · T2 Laydown › Bay 1', 'Contents · 1 item, 1 crate', 'HU-BBBB02', '6" pipe']) assert.ok(shown().includes(text), `${text} in ${JSON.stringify(shown())}`);
  assert.ok(shown().some(text => /Offline: this device's copy/.test(text)));
  assert.ok(shown().some(text => /The server refused a change to this crate, so it isn’t shown here/.test(text)), 'a refused change is named, not shown as done');

  const button = (title) => r.root.findAll(n => n.type === 'Button' && n.props.title === title)[0];
  await TestRenderer.act(async () => { r.root.findAll(n => n.type === 'Pressable' && /HU-BBBB02/.test(n.props.accessibilityLabel))[0].props.onPress(); });
  assert.deepEqual(plain(h.routes.at(-1)), { pathname: '/(field)/crate', params: { code: 'HU-BBBB02' } });

  // The tab screen stays mounted: a confirmation doesn't follow to the next crate.
  await TestRenderer.act(async () => { button('Unpack…').props.onPress(); });
  assert.ok(button('Unpack crate'));
  h.params.code = 'HU-BBBB02';
  await TestRenderer.act(async () => { r.update(view()); });
  assert.equal(button('Unpack crate'), undefined);
  assert.ok(shown().includes('Inside HU-AAAA01'));
  h.params.code = 'hu-aaaa01';
  await TestRenderer.act(async () => { r.update(view()); });

  await TestRenderer.act(async () => { button('Pack / add items').props.onPress(); });
  assert.equal(h.usePackStore.getState().code, 'HU-AAAA01');
  assert.equal(h.usePackStore.getState().before.description, 'Pump spares', 'packing starts from what the crate has');
  assert.equal(h.routes.at(-1), '/(field)/pack');
  // While it is being packed, it can't be unpacked from under the draft.
  await TestRenderer.act(async () => { button('Unpack…').props.onPress(); });
  assert.equal(button('Unpack crate'), undefined);
  assert.equal(r.root.findByType('Toast').props.title, "You're packing HU-AAAA01");
  assert.equal(h.announced.at(-1), "You're packing HU-AAAA01. Finish or discard that pack first, then unpack the crate.");

  await TestRenderer.act(async () => { h.usePackStore.getState().reset(); });
  await TestRenderer.act(async () => { button('Unpack…').props.onPress(); });
  assert.ok(shown().some(text => /Unpack HU-AAAA01\? Its 1 item and 1 crate come out where it stands/.test(text)));
  await TestRenderer.act(async () => { await button('Unpack crate').props.onPress(); });
  assert.deepEqual(h.queued.map(q => q.action), [{ type: 'unpack', payload: { unitCode: 'HU-AAAA01' } }]);
  await TestRenderer.act(async () => { r.unmount(); });
});
