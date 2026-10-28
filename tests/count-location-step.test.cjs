const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const { create } = require('zustand');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const zone = (id, parent_id, name, shape, extra = {}) => ({ id, map_id: 'map-a', parent_id, name, shape, color: null, sort_order: 0, is_active: true, location_id: null, ...extra });
const reference = {
  categories: [], items: [], images: { 'map-a': 'file:///plan.png' }, savedAt: '2026-10-28T09:00:00Z',
  maps: [{ id: 'map-a', name: 'Training Yard', storage_path: 'p/map-a.png', image_width: 2000, image_height: 1000, updated_at: null }],
  zones: [
    zone('t1', null, 'T1 Pipe Racks', rect(0.05, 0.05, 0.45, 0.45)),
    zone('rack1', 't1', 'Rack 1', rect(0.07, 0.07, 0.17, 0.43)),
    zone('rack2', 't1', 'Rack 2', rect(0.2, 0.07, 0.3, 0.43)),
    zone('staging', null, 'Equipment Staging', rect(0.55, 0.05, 0.95, 0.45), { sort_order: 1 }),
    zone('bayB', 'staging', 'Bay B', rect(0.71, 0.07, 0.83, 0.43)),
    zone('retired', 'staging', 'Old bay', rect(0.84, 0.07, 0.93, 0.43), { is_active: false }),
  ],
};
const rule = { required: true, activeIds: new Set(['t1', 'rack1', 'rack2', 'staging', 'bayB']) };

function setup(location = { siteMapId: null, pin: null, zoneId: null, zoneName: '' }) {
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
    },
    '@expo/vector-icons/FontAwesome': element('Icon'),
    '@/components/ui/Button': { Button: element('Button') },
    '@/components/ui/Input': { Input: element('Input') },
    '@/components/inventory/SiteMapPicker': { SiteMapPicker: element('SiteMapPicker') },
    '@/stores/countStore': { useCountStore: store },
    '@/lib/design/tokens': tokens,
  } });
  const { CountLocationStep } = loader.load('./components/inventory/CountLocationStep.tsx');
  const scrolls = [];
  const calls = { next: 0 };
  let renderer;
  const render = async () => {
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(CountLocationStep, { reference, areaRule: rule, onNext: () => { calls.next += 1; }, onBack() {} }),
        { createNodeMock: (node) => (node.type === 'ScrollView' ? { scrollTo: (to) => scrolls.push(to) } : null) },
      );
    });
    return renderer;
  };
  return { store, render, scrolls, calls };
}

const texts = (r) => r.root.findAll(node => node.type === 'Text').map(node => node.children.flat(Infinity).filter(c => typeof c === 'string').join(''));
const press = async (r, label) => {
  const [node] = r.root.findAll(n => n.type === 'Pressable' && n.props.accessibilityLabel === label);
  assert.ok(node, `no control labelled "${label}"`);
  await TestRenderer.act(async () => { node.props.onPress(); });
};
const button = (r, title) => r.root.findAll(n => n.type === 'Button' && n.props.title === title)[0];

test('the step cannot continue without an area while the plan has areas', async () => {
  const h = setup();
  const r = await h.render();
  assert.ok(texts(r).includes('Choose a location: pick an area below or tap it on the plan.'));
  await TestRenderer.act(async () => { button(r, 'Next: photo & review').props.onPress(); });
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
  const { location } = h.store.getState();
  assert.deepEqual({ ...location }, { siteMapId: 'map-a', pin: null, zoneId: 'rack2', zoneName: 'T1 Pipe Racks › Rack 2' });
  const picker = r.root.findByType('SiteMapPicker');
  assert.deepEqual(JSON.parse(JSON.stringify(picker.props.focus)), { areaId: 'rack2', nonce: 1 }, 'the plan zooms to the area');
  assert.equal(picker.props.zoneId, 'rack2');
  assert.ok(texts(r).includes('T1 Pipe Racks › Rack 2'));
  await TestRenderer.act(async () => { button(r, 'Next: photo & review').props.onPress(); });
  assert.equal(h.calls.next, 1);
});

test('tapping the plan chooses the area under the finger and opens the list to it', async () => {
  const h = setup();
  const r = await h.render();
  const bayB = reference.zones.find(z => z.id === 'bayB');
  await TestRenderer.act(async () => { r.root.findByType('SiteMapPicker').props.onChange({ pin: { x: 0.75, y: 0.2 }, zone: bayB }); });
  assert.equal(h.store.getState().location.zoneName, 'Equipment Staging › Bay B');
  assert.deepEqual({ ...h.store.getState().location.pin }, { x: 0.75, y: 0.2 });
  assert.ok(texts(r).includes('Bay B'), 'the parent opened to show the area');
  const row = r.root.findAll(n => n.type === 'View' && typeof n.props.onLayout === 'function' && n.findAll(c => c.type === 'Text' && c.children.includes('Bay B')).length)[0];
  await TestRenderer.act(async () => { row.props.onLayout({ nativeEvent: { layout: { y: 132 } } }); });
  // The row's top, less a small margin (every spacing token is 4 in this test).
  assert.equal(h.scrolls.at(-1).y, 132 - 4, 'the list scrolls to the area');
  assert.ok(texts(r).includes('Equipment Staging › Bay B · pin placed'));
  // The breadcrumb chooses a parent; the pin stays because it is inside it.
  await press(r, 'Choose Equipment Staging');
  assert.equal(h.store.getState().location.zoneId, 'staging');
  assert.deepEqual({ ...h.store.getState().location.pin }, { x: 0.75, y: 0.2 });
});

test('a pin outside every area clears the area; a list pick drops a pin outside it', async () => {
  const h = setup({ siteMapId: 'map-a', pin: { x: 0.75, y: 0.2 }, zoneId: 'bayB', zoneName: 'Equipment Staging › Bay B' });
  const r = await h.render();
  await TestRenderer.act(async () => { r.root.findByType('SiteMapPicker').props.onChange({ pin: { x: 0.5, y: 0.9 }, zone: null }); });
  assert.equal(h.store.getState().location.zoneId, null);
  assert.ok(texts(r).includes('The pin is outside the marked areas. Choose an area from the list.'));
  await TestRenderer.act(async () => { button(r, 'Next: photo & review').props.onPress(); });
  assert.equal(h.calls.next, 0);
  await TestRenderer.act(async () => { r.root.findByType('Input').props.onChangeText('rack 1'); });
  await press(r, 'Choose T1 Pipe Racks › Rack 1');
  assert.equal(h.store.getState().location.zoneId, 'rack1');
  assert.equal(h.store.getState().location.pin, null, 'the old pin was not inside Rack 1');
});

test('an area kept from an earlier count but since retired is not shown as chosen', async () => {
  const h = setup({ siteMapId: 'map-a', pin: null, zoneId: 'retired', zoneName: 'Equipment Staging › Old bay' });
  const r = await h.render();
  assert.equal(r.root.findByType('SiteMapPicker').props.zoneId, null);
  await TestRenderer.act(async () => { button(r, 'Next: photo & review').props.onPress(); });
  assert.equal(h.calls.next, 0);
  assert.ok(texts(r).some(t => /retired this area/.test(t)));
});
