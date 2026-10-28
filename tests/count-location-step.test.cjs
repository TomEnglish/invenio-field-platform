const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const { create } = require('zustand');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const zone = (id, parent_id, name, shape, extra = {}) => ({ id, map_id: 'map-a', parent_id, name, shape, color: null, sort_order: 0, is_active: true, location_id: null, ...extra });
const plan = (id, name) => ({ id, name, storage_path: `p/${id}.png`, image_width: 2000, image_height: 1000, updated_at: null });
const zones = [
  zone('t1', null, 'T1 Pipe Racks', rect(0.05, 0.05, 0.45, 0.45)),
  zone('rack1', 't1', 'Rack 1', rect(0.07, 0.07, 0.17, 0.43)),
  zone('rack2', 't1', 'Rack 2', rect(0.2, 0.07, 0.3, 0.43)),
  zone('staging', null, 'Equipment Staging', rect(0.55, 0.05, 0.95, 0.45), { sort_order: 1 }),
  zone('bayB', 'staging', 'Bay B', rect(0.71, 0.07, 0.83, 0.43)),
  zone('retired', 'staging', 'Old bay', rect(0.84, 0.07, 0.93, 0.43), { is_active: false }),
];
// Plan A has nested areas; plan B is in use but has none.
const reference = {
  categories: [], items: [], images: { 'map-a': 'file:///a.png', 'map-b': 'file:///b.png' }, savedAt: '2026-10-28T09:00:00Z',
  maps: [plan('map-a', 'Training Yard'), plan('map-b', 'Warehouse')], zones,
};

function setup(location = { siteMapId: null, pin: null, zoneId: null, zoneName: '' }, ref = reference) {
  const announced = [];
  const store = create((set) => ({
    location, mapView: null,
    setLocation: (next) => set({ location: next }),
    setMapView: (mapView) => set({ mapView }),
  }));
  const element = (name) => (props) => React.createElement(name, props, props.children);
  const tokens = new Proxy({}, { get: (_, key) => (key === '__esModule' ? false : key === 'touchTarget' ? 44 : new Proxy({}, { get: () => 4 })) });
  const loader = createModuleLoader({ stubs: {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': {
      View: 'View', Text: 'Text', ScrollView: 'ScrollView', Pressable: 'Pressable', KeyboardAvoidingView: 'KeyboardAvoidingView',
      Platform: { OS: 'ios' }, StyleSheet: { create: (styles) => styles },
      AccessibilityInfo: { announceForAccessibility: (message) => announced.push(message) },
    },
    '@expo/vector-icons/FontAwesome': element('Icon'),
    '@/components/ui/Button': { Button: element('Button') },
    '@/components/ui/Input': { Input: element('Input') },
    '@/components/inventory/SiteMapPicker': { SiteMapPicker: element('SiteMapPicker') },
    '@/stores/countStore': { useCountStore: store },
    '@/lib/design/tokens': tokens,
  } });
  const { CountLocationStep } = loader.load('./components/inventory/CountLocationStep.tsx');
  const { locationRule } = loader.load('./lib/inventory/areas.ts');
  // As in CountItemScreen: no rule until a copy has been downloaded.
  const rule = locationRule(ref.maps, ref.zones, !!ref.savedAt);
  const scrolls = [];
  const calls = { next: 0 };
  const render = async () => {
    let renderer;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(CountLocationStep, { reference: ref, rule, onNext: () => { calls.next += 1; }, onBack() {} }),
        { createNodeMock: (node) => (node.type === 'ScrollView' ? { scrollTo: (to) => scrolls.push(to) } : null) },
      );
    });
    return renderer;
  };
  return { store, render, scrolls, calls, announced };
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const texts = (r) => r.root.findAll(node => node.type === 'Text').map(node => node.children.flat(Infinity).filter(c => typeof c === 'string').join(''));
const press = async (r, label) => {
  const [node] = r.root.findAll(n => n.type === 'Pressable' && n.props.accessibilityLabel === label);
  assert.ok(node, `no control labelled "${label}"`);
  await TestRenderer.act(async () => { node.props.onPress(); });
};
const button = (r, title) => r.root.findAll(n => n.type === 'Button' && n.props.title === title)[0];
const tapPlan = (r, pin, area) => TestRenderer.act(async () => { r.root.findByType('SiteMapPicker').props.onChange({ pin, zone: area }); });
const next = (r) => TestRenderer.act(async () => { button(r, 'Next: photo & review').props.onPress(); });

test('the step cannot continue without an area on a plan that has areas', async () => {
  const h = setup();
  const r = await h.render();
  assert.ok(texts(r).includes('Choose a location: pick an area below or tap it on the plan.'));
  await next(r);
  assert.equal(h.calls.next, 0);
  assert.ok(texts(r).some(t => /Choose a location: pick an area from the list/.test(t)));
  assert.equal(button(r, 'Skip location'), undefined, 'no skip when an area is required');
});

test('picking from the list chooses the area, zooms the plan to it and shows the full path', async () => {
  const h = setup();
  const r = await h.render();
  assert.ok(!texts(r).includes('Old bay'), 'retired areas are not listed');
  assert.ok(!texts(r).includes('Rack 2'), 'children start collapsed');
  await press(r, 'Expand T1 Pipe Racks');
  await press(r, 'Choose T1 Pipe Racks › Rack 2');
  assert.deepEqual(plain(h.store.getState().location), { siteMapId: 'map-a', pin: null, zoneId: 'rack2', zoneName: 'T1 Pipe Racks › Rack 2' });
  const picker = r.root.findByType('SiteMapPicker');
  assert.deepEqual(plain(picker.props.focus), { areaId: 'rack2', nonce: 1 }, 'the plan zooms to the area');
  assert.equal(picker.props.zoneId, 'rack2');
  assert.ok(texts(r).includes('T1 Pipe Racks › Rack 2'));
  await next(r);
  assert.equal(h.calls.next, 1);
});

test('tapping the plan chooses the area under the finger and opens the list to it', async () => {
  const h = setup();
  const r = await h.render();
  await tapPlan(r, { x: 0.75, y: 0.2 }, zones.find(z => z.id === 'bayB'));
  assert.equal(h.store.getState().location.zoneName, 'Equipment Staging › Bay B');
  assert.deepEqual(plain(h.store.getState().location.pin), { x: 0.75, y: 0.2 });
  assert.ok(texts(r).includes('Bay B'), 'the parent opened to show the area');
  const rowFor = (name) => r.root.findAll(n => n.type === 'View' && typeof n.props.onLayout === 'function' && n.findAll(c => c.type === 'Text' && c.children.includes(name)).length)[0];
  await TestRenderer.act(async () => { rowFor('Bay B').props.onLayout({ nativeEvent: { layout: { y: 132 } } }); });
  // The row's top, less a small margin (every spacing token is 4 in this test).
  assert.deepEqual(h.scrolls.map(s => s.y), [128], 'the list scrolls to the area');
  // Tapping the same area again scrolls straight away and leaves nothing pending.
  await tapPlan(r, { x: 0.76, y: 0.21 }, zones.find(z => z.id === 'bayB'));
  assert.deepEqual(h.scrolls.map(s => s.y), [128, 128]);
  await press(r, 'Expand T1 Pipe Racks');
  await TestRenderer.act(async () => { rowFor('Bay B').props.onLayout({ nativeEvent: { layout: { y: 220 } } }); });
  assert.equal(h.scrolls.length, 2, 'opening another area does not jump the list back');
  assert.ok(texts(r).includes('Equipment Staging › Bay B · pin placed'));
  // The breadcrumb chooses a parent; the pin stays because it is inside it.
  await press(r, 'Choose Equipment Staging');
  assert.equal(h.store.getState().location.zoneId, 'staging');
  assert.deepEqual(plain(h.store.getState().location.pin), { x: 0.76, y: 0.21 });
});

test('a pin outside every area clears the area; a list pick drops a pin outside it', async () => {
  const h = setup({ siteMapId: 'map-a', pin: { x: 0.75, y: 0.2 }, zoneId: 'bayB', zoneName: 'Equipment Staging › Bay B' });
  const r = await h.render();
  await tapPlan(r, { x: 0.5, y: 0.9 }, null);
  assert.equal(h.store.getState().location.zoneId, null);
  assert.ok(texts(r).includes('The pin is outside the marked areas. Choose an area from the list.'));
  await next(r);
  assert.equal(h.calls.next, 0);
  assert.equal(r.root.findAllByType('Input').length, 0, 'search is behind a button');
  await press(r, 'Search areas');
  await TestRenderer.act(async () => { r.root.findByType('Input').props.onChangeText('rack 1'); });
  await press(r, 'Choose T1 Pipe Racks › Rack 1');
  assert.equal(h.store.getState().location.zoneId, 'rack1');
  assert.equal(h.store.getState().location.pin, null, 'the old pin was not inside Rack 1');
  assert.equal(r.root.findAllByType('Input').length, 0, 'choosing closes the search');
});

test('a plan with no areas takes a pin on its own, and switching plans forgets the zoom', async () => {
  const h = setup();
  const r = await h.render();
  await press(r, 'Expand T1 Pipe Racks');
  await press(r, 'Choose T1 Pipe Racks › Rack 2');
  await TestRenderer.act(async () => { button(r, 'Warehouse').props.onPress(); });
  assert.deepEqual(plain(h.store.getState().location), { siteMapId: 'map-b', pin: null, zoneId: null, zoneName: '' });
  assert.equal(r.root.findByType('SiteMapPicker').props.focus, null, 'no stale zoom on the other plan');
  assert.equal(r.root.findAll(n => n.type === 'Pressable' && /^Choose /.test(n.props.accessibilityLabel ?? '')).length, 0, 'no list for a plan without areas');
  await tapPlan(r, { x: 0.5, y: 0.5 }, null);
  await next(r);
  assert.equal(h.calls.next, 1, 'the server accepts a pin on a plan with no areas');
});

test('with no plan chosen, a plan without areas asks for a pin or another plan', async () => {
  const ref = { ...reference, maps: [plan('map-b', 'Warehouse'), plan('map-a', 'Training Yard')] };
  const h = setup(undefined, ref);
  const r = await h.render();
  assert.ok(texts(r).includes('Drop a pin on this plan, or switch to a plan with areas and pick one.'));
  assert.equal(button(r, 'Skip location'), undefined);
  await next(r);
  assert.equal(h.calls.next, 0);
  assert.ok(texts(r).some(t => /drop a pin on this plan, or switch to a plan with areas/.test(t)));
});

test('an area kept from an earlier count but since retired is cleared so the crew can choose again', async () => {
  const h = setup({ siteMapId: 'map-a', pin: null, zoneId: 'retired', zoneName: 'Equipment Staging › Old bay' });
  const r = await h.render();
  assert.equal(h.store.getState().location.zoneId, null);
  assert.equal(r.root.findByType('SiteMapPicker').props.zoneId, null);
  assert.ok(texts(r).some(t => /retired the area chosen before/.test(t)));
  await tapPlan(r, { x: 0.25, y: 0.2 }, zones.find(z => z.id === 'rack2'));
  await next(r);
  assert.equal(h.calls.next, 1);
});

test('a kept plan the office retired is cleared; with no areas left the location can be skipped', async () => {
  const ref = { ...reference, maps: [plan('map-b', 'Warehouse')], zones: [] };
  const h = setup({ siteMapId: 'map-a', pin: { x: 0.3, y: 0.3 }, zoneId: 'rack2', zoneName: 'Rack 2' }, ref);
  const r = await h.render();
  assert.deepEqual(plain(h.store.getState().location), { siteMapId: null, pin: null, zoneId: null, zoneName: '' });
  assert.ok(texts(r).some(t => /retired the site plan chosen before/.test(t)));
  await TestRenderer.act(async () => { button(r, 'Skip location').props.onPress(); });
  assert.equal(h.calls.next, 1);
});

test('a saved flat area name (from build 5) is replaced by the full path', async () => {
  const h = setup({ siteMapId: 'map-a', pin: null, zoneId: 'rack2', zoneName: 'Rack 2' });
  await h.render();
  assert.equal(h.store.getState().location.zoneName, 'T1 Pipe Racks › Rack 2');
});

test('a location can always be cleared, and plan taps are announced for VoiceOver', async () => {
  const h = setup();
  const r = await h.render();
  assert.equal(button(r, 'Clear location'), undefined, 'nothing to clear yet');
  await tapPlan(r, { x: 0.25, y: 0.2 }, zones.find(z => z.id === 'rack2'));
  assert.deepEqual(h.announced, ['T1 Pipe Racks › Rack 2 chosen']);
  await tapPlan(r, { x: 0.5, y: 0.9 }, null);
  assert.equal(h.announced.at(-1), 'Pin dropped outside the marked areas');
  await TestRenderer.act(async () => { button(r, 'Clear location').props.onPress(); });
  assert.deepEqual(plain(h.store.getState().location), { siteMapId: null, pin: null, zoneId: null, zoneName: '' });
});

test('an area named on a different plan is cleared (the server would refuse it)', async () => {
  const h = setup({ siteMapId: 'map-b', pin: null, zoneId: 'rack2', zoneName: 'T1 Pipe Racks › Rack 2' });
  const r = await h.render();
  assert.deepEqual(plain(h.store.getState().location), { siteMapId: 'map-b', pin: null, zoneId: null, zoneName: '' });
  assert.ok(texts(r).some(t => /on a different site plan/.test(t)));
});

test('with no site plan on the device, a saved location is shown and can be cleared', async () => {
  const ref = { ...reference, maps: [], zones: [], savedAt: null };
  const h = setup({ siteMapId: 'map-a', pin: null, zoneId: 'rack2', zoneName: 'T1 Pipe Racks › Rack 2' }, ref);
  const r = await h.render();
  assert.ok(texts(r).includes('Saved location: T1 Pipe Racks › Rack 2'));
  await TestRenderer.act(async () => { button(r, 'Clear location').props.onPress(); });
  assert.equal(h.store.getState().location.zoneId, null);
});
