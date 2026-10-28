const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const OPERATION = 'c3333333-3333-4333-8333-333333333333';
const auth = {
  user: { id: 'worker-a' },
  session: { access_token: 'fixture-only' },
  activeProject: { id: 'project-a', name: 'Training Yard', status: 'active' },
  loading: false,
};
const useAuthStore = Object.assign((select) => (select ? select(auth) : auth), { getState: () => auth });
const element = (name) => (props) => React.createElement(name, props);
const texts = (renderer) => renderer.root.findAll(node => typeof node.type === 'string' && node.type === 'Text')
  .map(node => node.children.flat(Infinity).filter(child => typeof child === 'string' || typeof child === 'number').join(''));

function countDraft(overrides = {}) {
  const draft = {
    operationId: OPERATION,
    step: 3,
    tag: 'GT2-LO-001',
    match: null,
    item: { name: 'Lube oil cooler', description: '', partNumber: 'LOC-22', quantity: '2', uom: 'EA', condition: 'good', notes: '' },
    category: { categoryId: 'valve', proposed: null, label: 'Generator 1 › Oil System › Control Valve' },
    location: { siteMapId: 'map-a', pin: { x: 0.4, y: 0.6 }, zoneId: 'zone-b', zoneName: 'Zone B' },
    photos: [{ uri: 'file:///documents/count-1.jpg' }],
    nextCount: 0,
    setStep(step) { this.step = step; },
    countNext() { this.nextCount += 1; this.tag = ''; this.step = 0; this.photos = []; this.operationId = 'next-operation'; },
    ...overrides,
  };
  return draft;
}

function screenLoader({ draft, queueStorage, reference, beginCount = async () => ({ started: true }), routes = [], localCounts = [], params = {}, online = false, useReference }) {
  const useCountStore = Object.assign(() => draft, { getState: () => draft });
  return createModuleLoader({ stubs: {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': {
      View: 'View', Text: 'Text', ScrollView: 'ScrollView', Pressable: 'Pressable', RefreshControl: 'RefreshControl',
      StyleSheet: { create: (styles) => styles },
    },
    'expo-router': {
      router: { replace: (route) => routes.push(['replace', route]), push: (route) => routes.push(['push', route]), back() {} },
      Stack: { Screen: () => React.createElement('StackScreen') },
      useFocusEffect: (effect) => React.useEffect(effect, [effect]),
      useLocalSearchParams: () => params,
    },
    '@/stores/countStore': { useCountStore },
    '@/stores/authStore': { useAuthStore },
    '@/lib/sync/networkStore': { useNetworkStore: Object.assign((select) => select({ isOnline: online }), { getState: () => ({ isOnline: online }) }) },
    '@react-native-async-storage/async-storage': queueStorage,
    '@/lib/sync/syncManager': { processQueue: async () => ({ processed: 0, failed: 0 }) },
    '@/lib/api/inventory': { recordCountLocally: async (count, zoneName) => { localCounts.push({ count, zoneName }); } },
    '@/components/inventory/useCountReference': { useCountReference: (options) => (useReference ? useReference(options)
      : { data: reference, loading: false, source: 'cache', error: '', reload: async () => {}, checked: null }) },
    '@/components/inventory/beginCount': { beginCount },
    '@/components/scanning/QRScanner': { QRScanner: element('QRScanner') },
    '@/components/inventory/CountItemStep': { CountItemStep: element('CountItemStep') },
    '@/components/inventory/CountCategoryStep': { CountCategoryStep: element('CountCategoryStep') },
    '@/components/inventory/CountLocationStep': { CountLocationStep: element('CountLocationStep') },
    '@/components/inventory/CountReviewStep': { CountReviewStep: element('CountReviewStep') },
    '@/components/ui/Button': { Button: element('Button') },
    '@/components/ui/Card': { Card: (props) => React.createElement('Card', props, props.children) },
    '@/components/ui/Input': { Input: element('Input') },
    '@/components/ui/Toast': { Toast: (props) => (props.visible ? React.createElement('Toast', props) : null) },
    '@/lib/design/tokens': new Proxy({}, { get: (_, key) => (key === '__esModule' ? false : new Proxy({}, { get: () => 1 })) }),
  } });
}

const emptyReference = { categories: [], maps: [], zones: [], items: [], images: {}, savedAt: null };

test('saving a count queues the contract payload and keeps the draft when the save fails', async () => {
  const draft = countDraft();
  let saves = 0, bytes = null;
  const localCounts = [];
  const queueStorage = {
    getItem: async () => bytes,
    setItem: async (_key, value) => { saves += 1; if (saves === 1) throw new Error('Storage unavailable'); bytes = value; },
  };
  const loader = screenLoader({ draft, queueStorage, reference: emptyReference, localCounts });
  const { CountItemScreenContent } = loader.load('./components/screens/CountItemScreen.tsx');

  let renderer;
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(CountItemScreenContent, { homeRoute: '/(field)/count' })); });
  await TestRenderer.act(async () => { await renderer.root.findByType('CountReviewStep').props.onSubmit(); });
  assert.equal(draft.nextCount, 0, 'the draft stays when the queue could not be written');
  assert.match(renderer.root.findByType('CountReviewStep').props.error, /Could not save: Storage unavailable/);
  assert.equal(localCounts.length, 0);

  await TestRenderer.act(async () => { await renderer.root.findByType('CountReviewStep').props.onSubmit(); });
  const [queued] = JSON.parse(bytes);
  assert.equal(queued.id, OPERATION);
  assert.equal(queued.action.type, 'count');
  assert.deepEqual(queued.action.payload, {
    count: { tag: 'GT2-LO-001', name: 'Lube oil cooler', quantity: '2', uom: 'EA', condition: 'good', categoryId: 'valve', siteMapId: 'map-a', zoneId: 'zone-b', partNumber: 'LOC-22', pin: { x: 0.4, y: 0.6 } },
    photos: [{ uri: 'file:///documents/count-1.jpg' }],
    categoryLabel: 'Generator 1 › Oil System › Control Valve',
    zoneName: 'Zone B',
  });
  assert.equal(draft.nextCount, 1, 'Count next keeps the category and zone after a successful save');
  assert.equal(localCounts[0].count.tag, 'GT2-LO-001');
  assert.ok(texts(renderer).includes('Count saved'));

  // "Count next" returns to the scanner for the next tag.
  await TestRenderer.act(async () => { renderer.root.findAll(node => node.type === 'Button' && node.props.title === 'Count next')[0].props.onPress(); });
  assert.equal(renderer.root.findAllByType('QRScanner').length, 1);
  await TestRenderer.act(async () => { renderer.unmount(); });
});

test('the count screen refuses an incomplete draft and a received tag', async () => {
  const draft = countDraft({ category: { categoryId: null, proposed: null, label: '' } });
  const loader = screenLoader({ draft, queueStorage: { getItem: async () => null, setItem: async () => { throw new Error('must not save'); } }, reference: emptyReference,
    beginCount: async (tag) => ({ started: false, message: `Tag ${tag} was already received` }) });
  const { CountItemScreenContent } = loader.load('./components/screens/CountItemScreen.tsx');
  let renderer;
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(CountItemScreenContent, { homeRoute: '/(field)/count' })); });
  await TestRenderer.act(async () => { await renderer.root.findByType('CountReviewStep').props.onSubmit(); });
  assert.match(renderer.root.findByType('CountReviewStep').props.error, /category/i);

  draft.tag = '';
  await TestRenderer.act(async () => { renderer.update(React.createElement(CountItemScreenContent, { homeRoute: '/(field)/count' })); });
  await TestRenderer.act(async () => { await renderer.root.findByType('QRScanner').props.onScan('RECEIVED-1'); });
  assert.match(renderer.root.findByType('Toast').props.message, /RECEIVED-1 was already received/);
  await TestRenderer.act(async () => { renderer.unmount(); });
});

test('Count home shows progress, the outstanding tags and Continue for a saved draft', async () => {
  const reference = {
    ...emptyReference,
    savedAt: '2026-10-27T09:00:00Z',
    zones: [{ id: 'zone-b', map_id: 'map-a', name: 'Zone B', shape: [], color: null, sort_order: 0 }],
    items: [
      { qr_code: 'T-1', inventory_item: 'Cooler', part_number: 'P-9', count_status: 'expected', counted_at: null, quantity: 1, uom: 'EA', zone_id: null, location: null },
      { qr_code: 'T-2', inventory_item: 'Valve', part_number: null, count_status: 'expected', counted_at: null, quantity: 1, uom: 'EA', zone_id: null, location: null },
      { qr_code: 'T-3', inventory_item: 'Pump', part_number: null, count_status: 'counted', counted_at: '2026-10-26T10:00:00Z', quantity: '2.000', uom: 'EA', zone_id: 'zone-b', location: 'Zone B' },
      { qr_code: 'T-4', inventory_item: 'Motor', part_number: null, count_status: 'received', counted_at: '2026-10-25T10:00:00Z', quantity: 1, uom: 'EA', zone_id: null, location: null },
    ],
  };
  const queue = [{ id: 'q1', userId: 'worker-a', projectId: 'project-a', action: { type: 'count', payload: { count: { tag: 'T-2', name: 'Valve' }, photos: [], zoneName: 'Zone A' } } }];
  const routes = [];
  const opened = [];
  const draft = countDraft({ tag: '' });
  const loader = screenLoader({ draft, reference, routes,
    queueStorage: { getItem: async () => JSON.stringify(queue), setItem: async () => {} },
    beginCount: async (tag) => { opened.push(tag); return { started: true }; } });
  const { CountHomeScreenContent } = loader.load('./components/screens/CountHomeScreen.tsx');
  let renderer;
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(CountHomeScreenContent, { countItemRoute: '/(field)/count-item' })); });
  const shown = texts(renderer);
  assert.ok(shown.includes('3 of 4 tags found · 1 waiting to sync'), shown.join('\n'));
  assert.ok(shown.includes('Not found yet (1)'), 'the pending tag is no longer outstanding');
  assert.ok(shown.includes('Waiting to sync'));
  assert.ok(shown.includes('T-3 · 2 EA · Zone B · Oct 26'));

  await TestRenderer.act(async () => { renderer.root.findAll(node => node.type === 'Pressable' && node.props.accessibilityLabel === 'Count T-1 Cooler')[0].props.onPress(); });
  assert.deepEqual(opened, ['T-1']);
  assert.deepEqual(routes.at(-1), ['push', '/(field)/count-item']);

  await TestRenderer.act(async () => { renderer.root.findByType('Input').props.onChangeText('nothing-matches'); });
  assert.ok(texts(renderer).includes('No expected tag matches.'));

  draft.tag = 'T-9';
  draft.item.name = 'Spare valve';
  await TestRenderer.act(async () => { renderer.update(React.createElement(CountHomeScreenContent, { countItemRoute: '/(field)/count-item' })); });
  assert.ok(texts(renderer).includes('T-9 · Spare valve'));
  assert.equal(renderer.root.findAll(node => node.type === 'Button' && node.props.title === 'Continue').length, 1);
  assert.equal(renderer.root.findAll(node => node.type === 'Button' && node.props.title === 'Scan a tag').length, 0);
  await TestRenderer.act(async () => { renderer.unmount(); });
});

// Plan map-a with Zone B, as on the device before the office retired it.
const plan = (id) => ({ id, name: id, storage_path: null, image_width: 2000, image_height: 1000, updated_at: null });
const deviceCopy = { ...emptyReference, savedAt: '2026-10-27T09:00:00Z', maps: [plan('map-a')],
  zones: [{ id: 'zone-b', map_id: 'map-a', parent_id: null, name: 'Zone B', shape: [], color: null, sort_order: 0, is_active: true, location_id: null }] };

test('a count reopened from Sync waits for a fresh download before its location is judged again', async () => {
  const draft = countDraft({ step: 2 });
  const asked = [];
  // The hook: loading until the download for the asked location comes back.
  let answer = { data: deviceCopy, loading: true, error: '', checked: null };
  const loader = screenLoader({ draft, queueStorage: { getItem: async () => null, setItem: async () => {} }, reference: deviceCopy,
    params: { fix: OPERATION }, online: true, useReference: (options) => { asked.push(options.check); return { source: 'cache', reload: async () => {}, ...answer }; } });
  const { CountItemScreenContent } = loader.load('./components/screens/CountItemScreen.tsx');
  const { staleLocation } = loader.load('./lib/inventory/areas.ts');
  const screen = () => React.createElement(CountItemScreenContent, { homeRoute: '/(field)/count' });
  let renderer;
  await TestRenderer.act(async () => { renderer = TestRenderer.create(screen()); });
  assert.equal(asked[0], 'map-a|zone-b', 'asks for the reopened location from the first render');
  assert.equal(renderer.root.findAllByType('CountLocationStep').length, 0, 'not judged against the old copy');
  assert.ok(texts(renderer).some(t => /Getting the office's latest site plans/.test(t)));

  // The office has since retired map-a: the fresh copy no longer has it.
  answer = { data: { ...deviceCopy, maps: [plan('map-b')], zones: [] }, loading: false, error: '', checked: 'map-a|zone-b' };
  await TestRenderer.act(async () => { renderer.update(screen()); });
  const step = renderer.root.findByType('CountLocationStep');
  assert.equal(step.props.rule.confirmedFor, 'map-a|zone-b');
  assert.equal(staleLocation(draft.location, step.props.rule), 'plan', 'now known retired, so the step clears it');
  await TestRenderer.act(async () => { renderer.unmount(); });
});

test('the wait for a fresh download can be skipped, and is not asked for offline or for an ordinary count', async () => {
  const run = async ({ params = {}, online = true, location } = {}) => {
    const draft = countDraft({ step: 2, ...(location ? { location } : {}) });
    const asked = [];
    const loader = screenLoader({ draft, queueStorage: { getItem: async () => null, setItem: async () => {} }, reference: deviceCopy, params, online,
      useReference: (options) => { asked.push(options.check); return { data: deviceCopy, loading: true, source: 'cache', error: '', reload: async () => {}, checked: null }; } });
    const { CountItemScreenContent } = loader.load('./components/screens/CountItemScreen.tsx');
    let renderer;
    await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(CountItemScreenContent, { homeRoute: '/(field)/count' })); });
    return { renderer, asked };
  };
  const fixing = await run({ params: { fix: OPERATION } });
  await TestRenderer.act(async () => { fixing.renderer.root.findAll(n => n.type === 'Button' && n.props.title === "Use this device's copy")[0].props.onPress(); });
  assert.equal(fixing.renderer.root.findAllByType('CountLocationStep').length, 1, 'the crew can carry on with the copy');

  const offline = await run({ params: { fix: OPERATION }, online: false });
  assert.equal(offline.renderer.root.findAllByType('CountLocationStep').length, 1);
  assert.ok(offline.asked.every(check => check === null), 'nothing to ask offline');

  const ordinary = await run();
  assert.equal(ordinary.renderer.root.findAllByType('CountLocationStep').length, 1);
  assert.ok(ordinary.asked.every(check => check === null), 'a location in the copy needs no download');

  // A plan the copy doesn't have may be newer than it: ask, without holding the crew up.
  const newer = await run({ location: { siteMapId: 'map-new', pin: null, zoneId: null, zoneName: '' } });
  assert.equal(newer.asked.at(-1), 'map-new|');
  assert.equal(newer.renderer.root.findAllByType('CountLocationStep').length, 1);
  for (const { renderer } of [fixing, offline, ordinary, newer]) await TestRenderer.act(async () => { renderer.unmount(); });
});

test('a count reopened while Count is still mounted (tabs keep it) is checked too', async () => {
  const draft = countDraft({ step: 2 });
  const params = {};
  const asked = [];
  const loader = screenLoader({ draft, queueStorage: { getItem: async () => null, setItem: async () => {} }, reference: deviceCopy, params, online: true,
    useReference: (options) => { asked.push(options.check); return { data: deviceCopy, loading: true, source: 'cache', error: '', reload: async () => {}, checked: null }; } });
  const { CountItemScreenContent } = loader.load('./components/screens/CountItemScreen.tsx');
  const screen = () => React.createElement(CountItemScreenContent, { homeRoute: '/(field)/count' });
  let renderer;
  await TestRenderer.act(async () => { renderer = TestRenderer.create(screen()); });
  assert.equal(asked.at(-1), null);
  params.fix = OPERATION;
  await TestRenderer.act(async () => { renderer.update(screen()); });
  assert.equal(asked.at(-1), 'map-a|zone-b');
  assert.equal(renderer.root.findAllByType('CountLocationStep').length, 0);
  await TestRenderer.act(async () => { renderer.unmount(); });
});
