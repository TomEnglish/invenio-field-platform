const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const plain = (value) => JSON.parse(JSON.stringify(value));
const ISO_TIME = /^\d{4}-\d\d-\d\dT[\d:.]+Z$/;
// 022's capturedAt is the moment of the scan or save: checked, then set aside so the rest compares exactly.
function untimed(action, captured, id) {
  const saved = plain(action);
  for (const holder of [saved.payload?.op, saved.payload?.move, saved.payload?.relocate, saved.type === 'licence' ? saved.payload : null]) {
    if (holder && 'capturedAt' in holder) { assert.match(holder.capturedAt, ISO_TIME); delete holder.capturedAt; captured.push(id); }
  }
  return saved;
}
const element = (name) => (props) => React.createElement(name, props, props.children);
const four = new Proxy({}, { get: () => 4 });
const tokens = { colors: new Proxy({}, { get: () => '#000' }), radius: four, space: four, fontSize: four, fontWeight: four, touchTarget: 44 };

const unit = (code, extra = {}) => ({ id: `id-${code}`, code, kind: 'crate', description: `Crate ${code}`, is_high_value: false, status: 'sealed', parent_id: null, parent_code: null, top_code: code,
  place_id: 'yard', place_name: 'Training Yard', site_map_id: null, zone_id: null, location: null, item_count: 1, unit_count: 0, ...extra });
const stop = (id, seq, place_id, place_name, kind = 'dropoff') => ({ id, load_id: 'load-a', seq, place_id, place_name, kind, planned_date: null, status: 'pending', due_count: 0, delivered_count: 0, missing_count: 0 });
const line = (tag, extra = {}) => ({ id: `line-${tag}`, load_id: 'load-a', load_number: 'L-0003', load_status: 'loading', tag, piece_kind: tag.startsWith('HU-') ? 'crate' : 'item', name: `Piece ${tag}`,
  is_high_value: false, status: 'planned', flag: null, added_in_field: false, pickup_stop_id: null, dropoff_stop_id: 'stop-1', dropoff_place: 'Gulf Machine', delivered_stop_id: null, delivered_place: null, is_current_position: false, on_at: null, off_at: null, ...extra });
const baseLoad = { id: 'load-a', load_number: 'L-0003', status: 'loading', origin_place_id: 'yard', origin_name: 'Training Yard', planned_date: null, truck_type: null, truck_number: null, trailer_number: null, bol_number: null,
  driver_name: null, driver_phone: null, licence_recorded_at: null, notes: null, stop_count: 2, stops_done: 0, next_stop: 'Gulf Machine', planned_count: 2, on_board_count: 1, delivered_count: 0, missing_count: 0, flagged_count: 0, departed_at: null, updated_at: null };
const reference = (extra = {}) => ({
  units: [unit('HU-AAAA01'), unit('HU-BBBB02')], items: [],
  places: [{ id: 'yard', kind: 'yard', name: 'Training Yard', project_id: 'project-a', city: null, state: null }, { id: 'shop', kind: 'outside_shop', name: 'Gulf Machine', project_id: null, city: null, state: null }, { id: 'site', kind: 'site', name: 'North Site', project_id: 'project-a', city: null, state: null }],
  materials: [{ id: 'm-1', tag: 'GT-1', name: 'Spool', quantity: 1 }], counted: [],
  loads: [baseLoad], stops: [stop('stop-1', 1, 'shop', 'Gulf Machine'), stop('stop-2', 2, 'site', 'North Site', 'both')],
  lines: [line('HU-AAAA01'), line('HU-BBBB02', { status: 'on_board', on_at: '2026-10-31T08:00:00Z' })], companies: [], savedAt: '2026-10-31T08:00:00Z', ...extra,
});

// The device's site plans: one not yet tied to a place, with one area.
const yardPlans = { maps: [{ id: 'map-a', name: 'Yard' }], zones: [{ id: 'z-1', map_id: 'map-a', parent_id: null, name: 'Bay 1', shape: [], is_active: true }] };

function load({ ref = reference(), params = { id: 'load-a' }, online = false, failQueue = null, stuck = [], role = 'field_worker', tagAnswer = null, plans = yardPlans } = {}) {
  const routes = [], queued = [], blur = [], deleted = [], captured = [];
  const records = new Map();
  const auth = { user: { id: 'worker-a', role }, activeProject: { id: 'project-a', status: 'active' } };
  const network = { isOnline: online };
  const loader = createModuleLoader({ stubs: {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'), zustand: require('zustand'), 'zustand/middleware': require('zustand/middleware'),
    'react-native': { View: 'View', Text: 'Text', ScrollView: 'ScrollView', Pressable: 'Pressable', Image: 'Image', KeyboardAvoidingView: 'KeyboardAvoidingView', StyleSheet: { create: (s) => s }, Platform: { OS: 'ios' }, AppState: { addEventListener: () => ({ remove() {} }) } },
    '@react-native-async-storage/async-storage': { getItem: async (k) => records.get(k) ?? null, setItem: async (k, v) => { records.set(k, v); }, removeItem: async (k) => { records.delete(k); } },
    'expo-router': {
      router: { push: (r) => routes.push(r), replace: (r) => routes.push(r), back: () => routes.push('back') },
      Stack: { Screen: () => null }, useLocalSearchParams: () => params,
      useFocusEffect: (effect) => React.useEffect(() => { const cleanup = effect(); blur.push(cleanup); return cleanup; }, [effect]),
    },
    'expo-image-picker': { requestCameraPermissionsAsync: async () => ({ granted: true }), launchCameraAsync: async () => ({ canceled: false, assets: [{ uri: 'file:///tmp/shot.jpg' }] }), launchImageLibraryAsync: async () => ({ canceled: true }) },
    '@expo/vector-icons/FontAwesome': element('Icon'),
    '@/stores/authStore': { useAuthStore: Object.assign((select) => (select ? select(auth) : auth), { getState: () => auth }) },
    '@/lib/sync/networkStore': { useNetworkStore: Object.assign((select) => select(network), { getState: () => network }) },
    '@/lib/sync/offlineQueue': { addToQueue: async (action, id) => { if (failQueue?.on) throw new Error(failQueue.message); if (queued.some(q => q.id === id)) throw new Error('This submission is already queued.'); queued.push({ id, action: untimed(action, captured, id) }); return id; } },
    '@/lib/sync/syncManager': { processQueue: async () => ({ processed: 0, failed: 0 }) },
    '@/lib/utils/persistPhoto': { persistPhoto: async () => `file:///documents/receiving-photos/p${queued.length}-${deleted.length}.jpg` },
    '@/lib/api/licence': { deleteLicencePhotos: async (payload) => { deleted.push(...payload.photos.map(p => p.uri)); } },
    '@/lib/api/tags': { lookupTag: async () => tagAnswer },
    // Like the real hook, saved changes show at once.
    '@/components/logistics/useLoadReference': { useLoadReference: () => build() },
    '@/components/inventory/useCountReference': { useCountReference: () => { const { loading = false, ...plan } = plans; return { data: { ...plan, images: {}, categories: [], items: [], savedAt: 'x' }, loading }; } },
    '@/components/scanning/QRScanner': { QRScanner: element('QRScanner') },
    '@/components/inventory/AreaList': { AreaList: element('AreaList') },
    '@/components/ui/Button': { Button: element('Button') },
    '@/components/ui/Input': { Input: element('Input') },
    '@/components/ui/DatePicker': { DatePicker: element('DatePicker') },
    '@/components/ui/Select': { Select: element('Select') },
    '@/lib/design/tokens': tokens,
  } });
  const loads = loader.load('./lib/logistics/loads.ts');
  const crates = loader.load('./lib/logistics/crates.ts');
  let cached = null;
  const build = () => {
    if (cached?.count === queued.length) return cached.result;
    const data = loads.applyChanges(ref, queued.map(q => q.action));
    cached = { count: queued.length, result: { data, base: ref, pending: [], refused: stuck, loads: loads.indexLoads(data), index: crates.indexLoad(data), known: crates.indexLoad(ref), loading: false, source: 'cache', error: '', reload: async () => {} } };
    return cached.result;
  };
  return { loader, routes, queued, blur, deleted, records, network, params, captured };
}
async function show(h, file, name) {
  const Screen = h.loader.load(file)[name];
  let r;
  await TestRenderer.act(async () => { r = TestRenderer.create(React.createElement(Screen)); });
  const texts = () => r.root.findAll(n => n.type === 'Text').map(n => [].concat(n.props.children).flat().join(''));
  const button = (title) => r.root.findAll(n => n.type === 'Button' && n.props.title === title)[0];
  const press = async (node, ...args) => { await TestRenderer.act(async () => { await node.props.onPress(...args); }); };
  const scan = async (code) => { let out; await TestRenderer.act(async () => { out = await r.root.findByType('QRScanner').props.onScan(code); }); return out; };
  return { r, texts, button, press, scan };
}

test('load out: the checklist ticks scans ("N of M on board"); an unplanned piece asks for its drop-off; tapping takes a piece off; scans save as load_on batches', async () => {
  const h = load();
  const s = await show(h, './components/screens/LoadOutScreen.tsx', 'LoadOutScreenContent');
  assert.equal(s.r.root.findByType('QRScanner').props.countLabel, '1 of 2 on board');
  assert.equal((await s.scan('hu-aaaa01')).tone, 'ok');
  assert.equal(s.r.root.findByType('QRScanner').props.countLabel, '2 of 2 on board', 'unsaved scans count');
  assert.equal(h.queued.length, 0, 'saved in batches, not per scan');

  // Not planned: where does it come off?
  assert.match((await s.scan('GT-1')).message, /isn't planned on this load/);
  assert.ok(s.texts().some(t => /GT-1 isn’t planned on L-0003. Where does it come off\?/.test(t)));
  assert.deepEqual(s.r.root.findAll(n => n.type === 'Button' && /^\d\. /.test(n.props.title)).map(n => n.props.title), ['1. Gulf Machine', '2. North Site']);
  await s.press(s.button('2. North Site'));
  assert.equal(s.r.root.findByType('QRScanner').props.countLabel, '3 of 3 on board');

  // Tap a piece on board (saved before) to take it off; tap an unsaved one to drop it.
  const row = (tag) => s.r.root.findAll(n => n.type === 'Pressable' && n.props.accessibilityLabel?.startsWith(`${tag},`))[0];
  await s.press(row('HU-BBBB02'));
  await s.press(row('HU-AAAA01'));
  assert.equal(s.r.root.findByType('QRScanner').props.countLabel, '1 of 3 on board');
  await s.press(s.button('Done'));
  assert.deepEqual(h.queued.map(q => [q.action.type, q.action.payload.op]), [['load_on', { loadId: 'load-a', pieces: [{ code: 'GT-1', dropoffStopId: 'stop-2' }], undo: ['HU-BBBB02'], partial: true }]]);
  assert.deepEqual(h.captured, h.queued.map(q => q.id), 'every step says when it was scanned');
  assert.equal(h.queued[0].action.payload.label, 'L-0003');
  assert.equal(h.routes.at(-1), 'back');
  await TestRenderer.act(async () => { s.r.unmount(); });
});

test('load out saves a piece this device doesn’t know on its own, so a refusal can’t hold back the rest', async () => {
  const h = load();
  const s = await show(h, './components/screens/LoadOutScreen.tsx', 'LoadOutScreenContent');
  await s.scan('HU-AAAA01');
  await s.scan('NEW-77');
  await s.press(s.button('1. Gulf Machine'));
  assert.deepEqual(h.queued.map(q => q.action.payload.op.pieces), [['HU-AAAA01'], [{ code: 'NEW-77', dropoffStopId: 'stop-1' }]]);
  // A piece on another load or packed in a crate is stopped at the scan.
  await TestRenderer.act(async () => { s.r.unmount(); });
});

test('check-in saves the driver and companies as one load_save and the licence as its own item; the number is never stored in the draft', async () => {
  const h = load();
  const { useCheckInStore, switchCheckInScope } = h.loader.load('./stores/checkInStore.ts');
  await switchCheckInScope('worker-a', 'project-a');
  const s = await show(h, './components/screens/CheckInScreen.tsx', 'CheckInScreenContent');
  const input = (label) => s.r.root.findAll(n => n.type === 'Input' && n.props.label === label)[0];
  const type = async (label, text) => { await TestRenderer.act(async () => { input(label).props.onChangeText(text); }); };
  await s.press(s.button('Next: companies'));
  assert.ok(s.texts().includes('Enter the driver’s name.'));
  await type('Driver’s name', 'Sam Ortiz');
  await type('Driver’s phone', '555 0100');
  await s.press(s.button('Next: companies'));
  await s.press(s.button('Add company'));
  await type('Company 1', 'Gulf Freight');
  await s.press(s.r.root.findAll(n => n.type === 'Button' && n.props.title === 'Broker')[0]);
  await s.press(s.button('Next: licence'));
  await type('Licence number', 'tx 98765-432');
  await type('Issuing state', 'Texas');
  assert.equal(input('Licence number').props.autoComplete, 'off');
  await s.press(s.button('Take photo'));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(h.records.get('checkin-draft-worker-a-project-a')?.includes('98765'), false, 'the draft on disk never has the number');
  assert.equal(/licenceState|licenceExpiry|Texas/.test(h.records.get('checkin-draft-worker-a-project-a')), false, 'nor the issuing state or expiry');
  assert.match(h.records.get('checkin-draft-worker-a-project-a'), /Sam Ortiz/);
  await s.press(s.button('Next: review'));
  assert.ok(s.texts().some(t => /^Number entered · 1 photo$/.test(t)), 'the review never shows the number');
  assert.equal(s.texts().some(t => t.includes('98765')), false);
  const { saveId, licenceId } = useCheckInStore.getState();
  await s.press(s.button('Save check-in'));
  assert.deepEqual(h.queued.map(q => [q.id, q.action.type]), [[saveId, 'load_save'], [licenceId, 'licence']]);
  assert.deepEqual(h.queued[0].action.payload.op, { loadId: 'load-a', driverName: 'Sam Ortiz', driverPhone: '555 0100', companies: [{ name: 'Gulf Freight', role: 'broker' }] });
  assert.equal(JSON.stringify(h.queued).includes('98765'), false, 'the queued items never hold the number');
  assert.deepEqual(plain(h.loader.load('./lib/sync/licenceMemory.ts').recallLicence(licenceId)), { number: 'TX 98765-432', state: 'Texas' }, 'it waits in memory');
  assert.equal(h.queued[1].action.payload.photos.length, 1);
  assert.equal(useCheckInStore.getState().licenceNumber, '', 'the draft lets go of the number');
  assert.notEqual(useCheckInStore.getState().saveId, saveId);
  await TestRenderer.act(async () => { s.r.unmount(); });
});

test('depart lists what stays behind and needs the driver’s name; then one load_depart', async () => {
  const h = load();
  let s = await show(h, './components/screens/DepartScreen.tsx', 'DepartScreenContent');
  assert.ok(s.texts().some(t => /driver's name/.test(t)));
  assert.equal(s.button('Depart').props.disabled, true);
  await TestRenderer.act(async () => { s.r.unmount(); });
  const named = load({ ref: reference({ loads: [{ ...baseLoad, driver_name: 'Sam Ortiz', licence_recorded_at: '2026-10-31T08:00:00Z' }] }) });
  s = await show(named, './components/screens/DepartScreen.tsx', 'DepartScreenContent');
  assert.ok(s.texts().includes('1 planned piece will stay behind:'));
  assert.ok(s.texts().includes('HU-AAAA01 · Piece HU-AAAA01'));
  await s.press(s.button('Depart'));
  assert.deepEqual(named.queued.map(q => [q.action.type, q.action.payload.op]), [['load_depart', { loadId: 'load-a' }]]);
  assert.deepEqual(named.captured, named.queued.map(q => q.id));
  await TestRenderer.act(async () => { s.r.unmount(); });
});

test('unload: scan off against what is due; an area only at our own place; Finish stop warns what will be missing, then stop_complete', async () => {
  const transit = reference({
    loads: [{ ...baseLoad, status: 'in_transit', driver_name: 'Sam' }],
    lines: [line('HU-AAAA01', { status: 'on_board', on_at: 'x' }), line('HU-BBBB02', { status: 'on_board', on_at: 'x' }), line('GT-1', { status: 'on_board', on_at: 'x', dropoff_stop_id: 'stop-2', dropoff_place: 'North Site' })],
  });
  const h = load({ ref: transit, params: { id: 'load-a', stopId: 'stop-1' } });
  const s = await show(h, './components/screens/UnloadScreen.tsx', 'UnloadScreenContent');
  assert.equal(s.r.root.findAll(n => n.type === 'AreaList').length, 0, 'no area at an outside shop');
  assert.equal(s.r.root.findByType('QRScanner').props.countLabel, '0 of 2 off here');
  assert.equal((await s.scan('HU-AAAA01')).tone, 'ok');
  assert.match((await s.scan('GT-1')).message, /due at North Site/);
  assert.equal(s.r.root.findByType('QRScanner').props.countLabel, '1 of 2 off here');
  await s.press(s.button('Finish stop…'));
  assert.deepEqual(h.queued.map(q => q.action.payload.op), [{ loadId: 'load-a', stopId: 'stop-1', pieces: ['HU-AAAA01', 'GT-1'], partial: true }], 'scans are saved before finishing');
  assert.ok(s.texts().some(t => /1 piece due here hasn’t been scanned off and will be marked missing: HU-BBBB02/.test(t)));
  await s.press(s.button('Finish stop'));
  assert.deepEqual(h.queued.at(-1).action, { type: 'stop_complete', payload: { op: { loadId: 'load-a', stopId: 'stop-1' }, label: 'L-0003' } });
  assert.deepEqual(h.captured, h.queued.map(q => q.id));
  await TestRenderer.act(async () => { s.r.unmount(); });

  // At this project's own site, an area can be chosen and goes with the batch.
  const own = load({ ref: transit, params: { id: 'load-a', stopId: 'stop-2' } });
  const o = await show(own, './components/screens/UnloadScreen.tsx', 'UnloadScreenContent');
  await TestRenderer.act(async () => { await o.r.root.findByType('AreaList').props.onSelect({ id: 'z-1', map_id: 'map-a', name: 'Bay 1' }); });
  await o.scan('GT-1');
  await o.press(o.button('Done for now'));
  assert.deepEqual(own.queued.map(q => [q.action.payload.op, q.action.payload.zoneName]), [[{ loadId: 'load-a', stopId: 'stop-2', pieces: ['GT-1'], zoneId: 'z-1', siteMapId: 'map-a', partial: true }, 'Bay 1']]);
  await TestRenderer.act(async () => { o.r.unmount(); });
});

test('known limits: unload offers only the site plans at the stop’s place, as Pack and Move do', async () => {
  const transit = reference({ loads: [{ ...baseLoad, status: 'in_transit', driver_name: 'Sam' }], lines: [line('GT-1', { status: 'on_board', on_at: 'x', dropoff_stop_id: 'stop-2', dropoff_place: 'North Site' })] });
  const area = (id, map_id, name) => ({ id, map_id, parent_id: null, name, shape: [], is_active: true });
  const plans = {
    maps: [{ id: 'yard-plan', name: 'Yard plan', place_id: 'yard' }, { id: 'site-plan', name: 'Site plan', place_id: 'site' }, { id: 'loose', name: 'Loose plan', place_id: null }],
    zones: [area('z-yard', 'yard-plan', 'Yard bay'), area('z-site', 'site-plan', 'Site bay'), area('z-loose', 'loose', 'Loose bay')],
  };
  const h = load({ ref: transit, params: { id: 'load-a', stopId: 'stop-2' }, plans });
  const s = await show(h, './components/screens/UnloadScreen.tsx', 'UnloadScreenContent');
  const chips = () => s.r.root.findAll(n => n.type === 'Button' && / plan$/.test(n.props.title)).map(n => n.props.title);
  const listed = () => s.r.root.findByType('AreaList').props.areas.map(a => a.name);
  assert.deepEqual(chips(), ['Site plan', 'Loose plan'], 'the plan drawn for North Site, and one tied to no place; never the yard’s');
  assert.deepEqual(listed(), ['Site bay']);
  await s.press(s.button('Loose plan'));
  assert.deepEqual(listed(), ['Loose bay']);
  await TestRenderer.act(async () => { await s.r.root.findByType('AreaList').props.onSelect(area('z-loose', 'loose', 'Loose bay')); });
  await s.scan('GT-1');
  await s.press(s.button('Done for now'));
  assert.deepEqual(h.queued.map(q => [q.action.payload.op.zoneId, q.action.payload.op.siteMapId, q.action.payload.zoneName]), [['z-loose', 'loose', 'Loose bay']]);
  await TestRenderer.act(async () => { s.r.unmount(); });

  // Our own site with no plan of its own on the device: no area, and it says why.
  const yardOnly = load({ ref: transit, params: { id: 'load-a', stopId: 'stop-2' }, plans: { maps: [plans.maps[0]], zones: [plans.zones[0]] } });
  const o = await show(yardOnly, './components/screens/UnloadScreen.tsx', 'UnloadScreenContent');
  assert.equal(o.r.root.findAll(n => n.type === 'AreaList').length, 0);
  assert.ok(o.texts().includes('North Site has no site plan on this device, so no area is needed.'));
  await TestRenderer.act(async () => { o.r.unmount(); });

  // Nothing is said about plans before the device's copy has loaded.
  const loading = load({ ref: transit, params: { id: 'load-a', stopId: 'stop-2' }, plans: { maps: [], zones: [], loading: true } });
  const l = await show(loading, './components/screens/UnloadScreen.tsx', 'UnloadScreenContent');
  assert.equal(l.texts().some(t => /no site plan/.test(t)), false);
  await TestRenderer.act(async () => { l.r.unmount(); });
});

const leave = (h) => TestRenderer.act(async () => { h.blur.splice(0).forEach(cleanup => cleanup?.()); });

test('review fixes: each visit to a mounted step screen starts fresh (editor, check-in, depart, unload)', async () => {
  // Editor: a new load after editing another starts empty, with no old stop IDs.
  const h = load();
  const e = await show(h, './components/screens/LoadEditScreen.tsx', 'LoadEditScreenContent');
  assert.equal(e.r.root.findAll(n => n.type === 'Text').some(n => [].concat(n.props.children).join('').includes('Gulf Machine')), true);
  await leave(h);
  Object.assign(h.params, { id: 'load-new', new: '1' });
  await TestRenderer.act(async () => { e.r.update(React.createElement(h.loader.load('./components/screens/LoadEditScreen.tsx').LoadEditScreenContent)); });
  assert.equal(e.texts().some(t => t.includes('Gulf Machine')), false, 'no stops from the other load');
  assert.equal(e.r.root.findAll(n => n.type === 'Select' && n.props.label === 'Starts at')[0].props.value, 'yard', 'the project’s only yard');
  await TestRenderer.act(async () => { e.r.unmount(); });

  // Depart: a second load gets its own operation ID.
  const d = load({ ref: reference({ loads: [{ ...baseLoad, driver_name: 'Sam', licence_recorded_at: 'x' }, { ...baseLoad, id: 'load-b', load_number: 'L-0004', driver_name: 'Ana', licence_recorded_at: 'x' }], lines: [line('HU-BBBB02', { status: 'on_board', on_at: 'x' }), line('GT-1', { load_id: 'load-b', status: 'on_board', on_at: 'x' })] }) });
  const s = await show(d, './components/screens/DepartScreen.tsx', 'DepartScreenContent');
  await s.press(s.button('Depart'));
  await leave(d);
  d.params.id = 'load-b';
  await TestRenderer.act(async () => { s.r.update(React.createElement(d.loader.load('./components/screens/DepartScreen.tsx').DepartScreenContent)); });
  await s.press(s.button('Depart'));
  assert.deepEqual(d.queued.map(q => q.action.payload.op.loadId), ['load-a', 'load-b']);
  assert.notEqual(d.queued[0].id, d.queued[1].id);
  await TestRenderer.act(async () => { s.r.unmount(); });
});

test('review fixes: check-in can be done again after one is saved', async () => {
  const h = load({ ref: reference({ loads: [{ ...baseLoad, licence_recorded_at: '2026-10-30T09:00:00Z' }] }) });
  const { switchCheckInScope } = h.loader.load('./stores/checkInStore.ts');
  await switchCheckInScope('worker-a', 'project-a');
  const s = await show(h, './components/screens/CheckInScreen.tsx', 'CheckInScreenContent');
  await TestRenderer.act(async () => { s.r.root.findAll(n => n.type === 'Input' && n.props.label === 'Driver’s name')[0].props.onChangeText('Sam'); });
  const store = h.loader.load('./stores/checkInStore.ts').useCheckInStore;
  await TestRenderer.act(async () => { store.getState().setStep(3); });
  await s.press(s.button('Save check-in'));
  assert.ok(s.texts().includes('Driver checked in'));
  await leave(h);
  await TestRenderer.act(async () => { s.r.update(React.createElement(h.loader.load('./components/screens/CheckInScreen.tsx').CheckInScreenContent)); });
  assert.ok(s.button('Next: companies'), 'back on the form, not the old confirmation');
  await TestRenderer.act(async () => { s.r.unmount(); });
});

test('review fixes: a finished stop takes late scans but is never finished again; Finish stop and Done wait until every scan is saved', async () => {
  const transit = reference({ loads: [{ ...baseLoad, status: 'in_transit', driver_name: 'Sam' }], lines: [line('HU-AAAA01', { status: 'on_board', on_at: 'x' }), line('HU-BBBB02', { status: 'on_board', on_at: 'x' })] });
  const failQueue = { on: false, message: 'Storage full' };
  const h = load({ ref: transit, failQueue });
  const s = await show(h, './components/screens/UnloadScreen.tsx', 'UnloadScreenContent');
  await s.press(s.button('1. Gulf Machine · Drop-off · 0 due'));
  await s.scan('HU-AAAA01');
  failQueue.on = true;
  await s.press(s.button('Finish stop…'));
  assert.equal(s.texts().some(t => /will be marked missing/.test(t)), false, 'no Finish prompt while scans are unsaved');
  assert.ok(s.texts().some(t => /Could not save the last scans: Storage full/.test(t)));
  await s.press(s.button('Done for now'));
  assert.equal(h.routes.includes('back'), false, 'Done stays while scans are unsaved');
  failQueue.on = false;
  await s.press(s.button('Finish stop…'));
  // A piece scanned while the prompt is up is saved first; if it can't be, the stop isn't finished.
  await s.scan('HU-BBBB02');
  failQueue.on = true;
  await s.press(s.button('Finish stop'));
  assert.deepEqual(h.queued.map(q => q.action.type), ['load_off'], 'not finished while a scan is unsaved');
  failQueue.on = false;
  await s.press(s.button('Finish stop'));
  assert.deepEqual(h.queued.map(q => q.action.type), ['load_off', 'load_off', 'stop_complete']);
  // Reopened (the screen stayed mounted): the finished stop is offered for late scans only (022: until the load is closed).
  await leave(h);
  await TestRenderer.act(async () => { s.r.update(React.createElement(h.loader.load('./components/screens/UnloadScreen.tsx').UnloadScreenContent)); });
  assert.ok(s.texts().includes('Which stop are you at?'));
  assert.deepEqual(s.r.root.findAll(n => n.type === 'Button' && /Gulf Machine/.test(n.props.title)).map(n => n.props.title), ['1. Gulf Machine · Drop-off · Done: late scans only']);
  // Opened for that stop by name: pieces can come off, but it isn't finished again.
  h.params.stopId = 'stop-1';
  await TestRenderer.act(async () => { s.r.update(React.createElement(h.loader.load('./components/screens/UnloadScreen.tsx').UnloadScreenContent)); });
  assert.ok(s.texts().some(t => /This stop is finished/.test(t)));
  assert.equal(s.r.root.findAll(n => n.type === 'Button' && n.props.title === 'Finish stop…').length, 0, 'a finished stop is never finished again');
  await TestRenderer.act(async () => { s.r.unmount(); });
});

test('review fixes: a double tap on a piece takes it off once', async () => {
  const h = load();
  const s = await show(h, './components/screens/LoadOutScreen.tsx', 'LoadOutScreenContent');
  const row = s.r.root.findAll(n => n.type === 'Pressable' && n.props.accessibilityLabel?.startsWith('HU-BBBB02,'))[0];
  await TestRenderer.act(async () => { row.props.onPress(); row.props.onPress(); });
  await s.press(s.button('Done'));
  assert.deepEqual(h.queued.map(q => q.action.payload.op.undo), [['HU-BBBB02']]);
  await TestRenderer.act(async () => { s.r.unmount(); });
});

test('review fixes: a licence photo leaves no other copy on the device', async () => {
  const deleted = [], copied = [];
  const loader = createModuleLoader({ stubs: {
    'react-native': { Platform: { OS: 'ios' } },
    './compressPhoto': { compressPhoto: async () => 'file:///cache/ImageManipulator/small.jpg' },
    'lib/utils/compressPhoto.ts': { compressPhoto: async () => 'file:///cache/ImageManipulator/small.jpg' },
    'expo-file-system/legacy': { documentDirectory: 'file:///documents/', cacheDirectory: 'file:///cache/', makeDirectoryAsync: async () => {}, copyAsync: async ({ to }) => { copied.push(to); }, deleteAsync: async (uri) => { deleted.push(uri); } },
  } });
  const { persistPhoto } = loader.load('./lib/utils/persistPhoto.ts');
  const kept = await persistPhoto('file:///cache/ImagePicker/original.jpg', { directory: 'licence-photos', temporary: true, discardSources: true });
  assert.match(kept, /^file:\/\/\/cache\/licence-photos\/.+\.jpg$/, 'a temporary file, not in backed-up Documents');
  assert.deepEqual(deleted.sort(), ['file:///cache/ImageManipulator/small.jpg', 'file:///cache/ImagePicker/original.jpg']);
  deleted.length = 0;
  await persistPhoto('file:///cache/ImagePicker/receipt.jpg');
  assert.deepEqual(deleted, [], 'other photos are left as before');
});

test('the user’s rules: no Finish stop at a shop or vendor; Depart and Finish wait behind an unresolved step', async () => {
  const shopStops = [{ ...stop('stop-1', 1, 'shop', 'Gulf Machine'), place_kind: 'outside_shop' }, { ...stop('stop-2', 2, 'site', 'North Site', 'both'), place_kind: 'site' }];
  const transit = reference({ loads: [{ ...baseLoad, status: 'in_transit', driver_name: 'Sam', licence_recorded_at: 'x' }], stops: shopStops,
    lines: [line('HU-AAAA01', { status: 'on_board', on_at: 'x' }), line('GT-1', { status: 'on_board', on_at: 'x', dropoff_stop_id: 'stop-2' })] });
  const shop = load({ ref: transit, params: { id: 'load-a', stopId: 'stop-1' } });
  let s = await show(shop, './components/screens/UnloadScreen.tsx', 'UnloadScreenContent');
  assert.equal(s.button('Finish stop…'), undefined, 'the office confirms shops and vendors');
  assert.ok(s.texts().some(t => /outside shop or vendor: scan off what you hand over, and the office confirms the stop/.test(t)));
  assert.equal((await s.scan('HU-AAAA01')).tone, 'ok', 'scanning off still works');
  await TestRenderer.act(async () => { s.r.unmount(); });

  const stuck = [{ id: 'op-x', userId: 'worker-a', projectId: 'project-a', lastError: 'PIPE-9 is packed in HU-BOX001; unload the crate instead', lastErrorCode: '22023', refused: true,
    action: { type: 'load_off', payload: { op: { loadId: 'load-a', stopId: 'stop-2', pieces: ['PIPE-9'] }, label: 'L-0003' } } }];
  const site = load({ ref: transit, params: { id: 'load-a', stopId: 'stop-2' }, stuck });
  s = await show(site, './components/screens/UnloadScreen.tsx', 'UnloadScreenContent');
  assert.equal(s.button('Finish stop…').props.disabled, true);
  assert.ok(s.texts().some(t => /An earlier step for L-0003 hasn't uploaded/.test(t)));
  await TestRenderer.act(async () => { s.r.unmount(); });

  const loading = reference({ loads: [{ ...baseLoad, driver_name: 'Sam', licence_recorded_at: 'x' }] });
  const depart = load({ ref: loading, stuck: [{ ...stuck[0], action: { type: 'load_on', payload: { op: { loadId: 'load-a', pieces: ['PIPE-9'] }, label: 'L-0003' } } }] });
  s = await show(depart, './components/screens/DepartScreen.tsx', 'DepartScreenContent');
  assert.equal(s.button('Depart').props.disabled, true);
  assert.ok(s.button('View Sync'));
  await TestRenderer.act(async () => { s.r.unmount(); });

  // No licence on file: no departure, with a way to record it.
  const noLicence = load({ ref: reference({ loads: [{ ...baseLoad, driver_name: 'Sam' }] }) });
  s = await show(noLicence, './components/screens/DepartScreen.tsx', 'DepartScreenContent');
  assert.equal(s.button('Depart').props.disabled, true);
  assert.ok(s.texts().some(t => /Record the driver's licence/.test(t)));
  assert.ok(s.button('Driver check-in'));
  await TestRenderer.act(async () => { s.r.unmount(); });
});

const typeInto = (s, label, text) => TestRenderer.act(async () => { s.r.root.findAll(n => n.type === 'Input' && n.props.label === label)[0].props.onChangeText(text); });
const choose = (s, label, value) => TestRenderer.act(async () => { s.r.root.findAll(n => n.type === 'Select' && n.props.label === label)[0].props.onChange(value); });

test('022: office staff can let a load leave without the licence, giving a reason; a crew can’t', async () => {
  const ref = reference({ loads: [{ ...baseLoad, driver_name: 'Sam Ortiz' }] });
  const crew = load({ ref });
  let s = await show(crew, './components/screens/DepartScreen.tsx', 'DepartScreenContent');
  assert.ok(s.texts().some(t => /Record the driver's licence/.test(t)));
  assert.equal(s.button('Leave without the licence (office)…'), undefined, 'not offered to a crew');
  assert.ok(s.button('Driver check-in'));
  await TestRenderer.act(async () => { s.r.unmount(); });

  const office = load({ ref, role: 'office_staff' });
  s = await show(office, './components/screens/DepartScreen.tsx', 'DepartScreenContent');
  await s.press(s.button('Leave without the licence (office)…'));
  assert.equal(s.button('Depart without the licence').props.disabled, true);
  assert.ok(s.texts().some(t => /at least 5 characters/.test(t)));
  await typeInto(s, 'Reason', 'Checked with the carrier by phone');
  await s.press(s.button('Depart without the licence'));
  assert.deepEqual(office.queued.map(q => q.action.payload.op), [{ loadId: 'load-a', overrideReason: 'Checked with the carrier by phone' }]);
  assert.deepEqual(office.captured, office.queued.map(q => q.id));
  await TestRenderer.act(async () => { s.r.unmount(); });
});

test('022: a crew can’t change the stops of the office’s load; office staff change only the stops not yet reached after it leaves', async () => {
  const crew = load({ ref: reference({ loads: [{ ...baseLoad, started_in_field: false }] }) });
  let s = await show(crew, './components/screens/LoadEditScreen.tsx', 'LoadEditScreenContent');
  assert.ok(s.texts().some(t => /The office plans this load’s stops/.test(t)));
  assert.equal(s.r.root.findAll(n => n.type === 'Select' && n.props.label === 'Add a stop').length, 0);
  assert.equal(s.r.root.findAll(n => n.type === 'Button' && n.props.title === 'Remove').length, 0);
  await typeInto(s, 'Truck number', 'T-9');
  await s.press(s.button('Save changes'));
  assert.deepEqual(crew.queued.map(q => q.action.payload.op), [{ loadId: 'load-a', truckNumber: 'T-9' }], 'the truck changes; the stops aren’t sent');
  assert.deepEqual(crew.captured, crew.queued.map(q => q.id));
  await TestRenderer.act(async () => { s.r.unmount(); });

  const own = load({ ref: reference({ loads: [{ ...baseLoad, started_in_field: true }] }) });
  s = await show(own, './components/screens/LoadEditScreen.tsx', 'LoadEditScreenContent');
  assert.equal(s.r.root.findAll(n => n.type === 'Button' && n.props.title === 'Remove').length, 2, 'a crew plans the load it started');
  await TestRenderer.act(async () => { s.r.unmount(); });

  const transit = reference({ loads: [{ ...baseLoad, status: 'in_transit' }], stops: [{ ...stop('stop-1', 1, 'shop', 'Gulf Machine'), status: 'done' }, stop('stop-2', 2, 'site', 'North Site', 'both')] });
  const office = load({ ref: transit, role: 'office_staff' });
  s = await show(office, './components/screens/LoadEditScreen.tsx', 'LoadEditScreenContent');
  assert.ok(s.texts().includes('1. Gulf Machine · Reached'));
  assert.equal(s.r.root.findAll(n => n.type === 'Button' && n.props.title === 'Remove').length, 1, 'only the stop still to come');
  assert.equal(s.r.root.findAll(n => n.type === 'Button' && n.props.accessibilityLabel === 'Move stop 2 up')[0].props.disabled, true, 'nothing moves ahead of a reached stop');
  await choose(s, 'Add a stop', 'yard');
  await s.press(s.button('Save changes'));
  assert.deepEqual(office.queued[0].action.payload.op.stops.map(stop => stop.placeId), ['shop', 'site', 'yard']);
  await TestRenderer.act(async () => { s.r.unmount(); });
});

test('022: loading a piece another load has planned asks where it comes off, then moves it to this load', async () => {
  const ref = reference({
    loads: [baseLoad, { ...baseLoad, id: 'load-b', load_number: 'L-0007', status: 'planning' }],
    lines: [...reference().lines, line('GT-1', { id: 'line-b', load_id: 'load-b', load_number: 'L-0007', load_status: 'planning', dropoff_stop_id: 'stop-b' })],
  });
  const h = load({ ref });
  const s = await show(h, './components/screens/LoadOutScreen.tsx', 'LoadOutScreenContent');
  assert.match((await s.scan('gt-1')).message, /GT-1 is planned on load L-0007/);
  assert.ok(s.texts().includes('GT-1 is planned on load L-0007. Choose where it comes off to move it to L-0003.'));
  assert.ok(s.button('Leave it on L-0007'));
  await s.press(s.button('2. North Site'));
  await s.press(s.button('Done'));
  assert.deepEqual(h.queued.map(q => q.action.payload.op.pieces), [[{ code: 'GT-1', dropoffStopId: 'stop-2', move: true }]]);
  await TestRenderer.act(async () => { s.r.unmount(); });
});

test('022: at an outside shop or vendor only office staff finish the stop', async () => {
  const transit = reference({
    loads: [{ ...baseLoad, status: 'in_transit', driver_name: 'Sam' }],
    stops: [{ ...stop('stop-1', 1, 'shop', 'Gulf Machine'), place_kind: 'outside_shop' }, stop('stop-2', 2, 'site', 'North Site', 'both')],
    lines: [line('HU-AAAA01', { status: 'on_board', on_at: 'x' })],
  });
  const crew = load({ ref: transit, params: { id: 'load-a', stopId: 'stop-1' } });
  let s = await show(crew, './components/screens/UnloadScreen.tsx', 'UnloadScreenContent');
  assert.equal(s.button('Finish stop…'), undefined);
  assert.ok(s.texts().some(t => /the office confirms the stop/.test(t)));
  await TestRenderer.act(async () => { s.r.unmount(); });
  const office = load({ ref: transit, params: { id: 'load-a', stopId: 'stop-1' }, role: 'office_staff' });
  s = await show(office, './components/screens/UnloadScreen.tsx', 'UnloadScreenContent');
  await s.press(s.button('Finish stop…'));
  await s.press(s.button('Finish stop'));
  assert.deepEqual(office.queued.map(q => q.action.type), ['stop_complete']);
  await TestRenderer.act(async () => { s.r.unmount(); });
});

test('022: a crate moves as it is to a place and an area of a plan there; a loose item’s place is corrected with a reason; a packed one can’t be', async () => {
  const h = load({ params: { code: 'hu-aaaa01' } });
  let s = await show(h, './components/screens/RelocateScreen.tsx', 'RelocateScreenContent');
  assert.ok(s.texts().includes('Now: Training Yard'));
  await s.press(s.button('Save the move'));
  assert.ok(s.texts().includes('Choose where the crate is now.'));
  await choose(s, 'Place', 'site');
  await s.press(s.button('Save the move'));
  assert.ok(s.texts().includes('HU-AAAA01 is sealed: choose the area where it is now.'), 'a sealed crate keeps its seal only with an area where the place has a plan');
  await choose(s, 'Place', 'shop');
  assert.equal(s.r.root.findAll(n => n.type === 'AreaList').length, 0, 'no areas at an outside shop');
  await choose(s, 'Place', 'site');
  await TestRenderer.act(async () => { s.r.root.findByType('AreaList').props.onSelect({ id: 'z-1', map_id: 'map-a' }); });
  await s.press(s.button('Save the move'));
  assert.deepEqual(h.queued.map(q => q.action), [{ type: 'move', payload: { move: { unitCode: 'HU-AAAA01', placeId: 'site', zoneId: 'z-1', siteMapId: 'map-a' }, placeName: 'North Site', zoneName: 'Bay 1' } }]);
  assert.deepEqual(h.captured, h.queued.map(q => q.id));
  assert.equal(h.routes.at(-1), 'back');
  await TestRenderer.act(async () => { s.r.unmount(); });

  const item = load({ params: { tag: 'GT-1' }, tagAnswer: { kind: 'received', code: 'GT-1', can_receive: false, name: 'Spool', position: 'at_place', status: 'in_yard', place_id: 'yard', place_name: 'Training Yard', area: 'Bay 1' } });
  s = await show(item, './components/screens/RelocateScreen.tsx', 'RelocateScreenContent');
  assert.ok(s.texts().includes('Now: Training Yard · Bay 1'));
  await choose(s, 'Place', 'site');
  await typeInto(s, 'Reason (optional)', 'Found at North Site');
  await s.press(s.button('Save the location'));
  assert.deepEqual(item.queued.map(q => q.action), [{ type: 'relocate', payload: { relocate: { tag: 'GT-1', placeId: 'site', reason: 'Found at North Site' }, name: 'Spool', placeName: 'North Site' } }]);
  await TestRenderer.act(async () => { s.r.unmount(); });

  const packed = load({ params: { tag: 'GT-1' }, tagAnswer: { kind: 'received', code: 'GT-1', can_receive: false, position: 'in_crate', status: 'in_yard', crate_code: 'HU-BBBB02' } });
  s = await show(packed, './components/screens/RelocateScreen.tsx', 'RelocateScreenContent');
  assert.ok(s.texts().some(t => /packed in HU-BBBB02; move the crate instead/.test(t)));
  assert.equal(s.button('Save the location').props.disabled, true);
  await TestRenderer.act(async () => { s.r.unmount(); });
});
