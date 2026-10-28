const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const { create } = require('zustand');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The real SiteMapPicker (and, in the second test, the real Location step and
// area list). Only the native gesture and SVG libraries are faked; gesture
// builders record their handlers so a test can "tap" the plan.
function load({ store } = {}) {
  const gestures = [];
  const builder = (kind) => () => {
    const b = { kind, handlers: {} };
    for (const name of ['runOnJS', 'maxPointers', 'minDistance', 'maxDistance']) b[name] = () => b;
    for (const name of ['onStart', 'onUpdate', 'onEnd', 'onFinalize']) b[name] = (fn) => { b.handlers[name] = fn; return b; };
    gestures.push(b);
    return b;
  };
  const element = (name) => (props) => React.createElement(name, props, props.children);
  const four = new Proxy({}, { get: () => 4 });
  const stubs = {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': {
      View: 'View', Text: 'Text', ScrollView: 'ScrollView', Pressable: 'Pressable', KeyboardAvoidingView: 'KeyboardAvoidingView',
      Image: Object.assign(element('Image'), { getSize: (_uri, ok) => ok(2000, 1000) }),
      Platform: { OS: 'ios' }, StyleSheet: { create: (styles) => styles, absoluteFill: {} },
      AccessibilityInfo: { announceForAccessibility() {} },
    },
    'react-native-gesture-handler': {
      Gesture: { Pinch: builder('pinch'), Pan: builder('pan'), Tap: builder('tap'), Race: (...g) => ({ race: g }), Simultaneous: (...g) => ({ simultaneous: g }) },
      GestureDetector: ({ children }) => children,
    },
    'react-native-svg': { __esModule: true, default: element('Svg'), Polygon: element('SvgPolygon') },
    '@expo/vector-icons/FontAwesome': element('Icon'),
    '@/components/ui/Button': { Button: element('Button') },
    '@/components/ui/Input': { Input: element('Input') },
    '@/lib/design/tokens': { colors: new Proxy({}, { get: () => '#000' }), radius: four, space: four, fontSize: four, fontWeight: four, touchTarget: 44, tint: (color, alpha) => `${color}/${alpha}` },
  };
  if (store) stubs['@/stores/countStore'] = { useCountStore: store };
  return { loader: createModuleLoader({ stubs }), gestures };
}

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const zone = (id, parent_id, name, shape) => ({ id, map_id: 'map-a', parent_id, name, shape, color: '#2563EB', sort_order: 0, is_active: true, location_id: null });
const zones = [
  zone('t1', null, 'T1 Pipe Racks', rect(0.05, 0.05, 0.45, 0.45)),
  zone('rack2', 't1', 'Rack 2', rect(0.2, 0.07, 0.3, 0.43)),
  zone('bayB', null, 'Bay B', rect(0.71, 0.07, 0.83, 0.43)),
];
const plan = (id, name) => ({ id, name, storage_path: `p/${id}.png`, image_width: 2000, image_height: 1000, updated_at: null });
const image = { width: 2000, height: 1000 }, frame = { width: 400, height: 400 };
const FITTED = { x: 0, y: 100, scale: 1 };

// Lay out the plan's frame (the View that measures itself) at 400 × 400.
async function layOut(renderer) {
  const frames = renderer.root.findAll(n => n.type === 'View' && typeof n.props.onLayout === 'function' && n.props.accessibilityLabel?.startsWith('Site plan'));
  for (const node of frames) await TestRenderer.act(async () => { node.props.onLayout({ nativeEvent: { layout: frame } }); });
}
// The image + outlines layer: its position and size are the current view.
function shownView(renderer) {
  const [content] = renderer.root.findAll(n => n.type === 'View' && Array.isArray(n.props.style) && n.props.style.some(s => s && 'left' in s));
  const box = content.props.style.find(s => s && 'left' in s);
  return { x: box.left, y: box.top, scale: box.width / 400 };
}
const close = (a, b) => Math.abs(a - b) < 1e-6;

test('the real plan fits first, zooms to an area picked from the list, and a tap names the area under it', async () => {
  const { loader, gestures } = load();
  const { SiteMapPicker } = loader.load('./components/inventory/SiteMapPicker.tsx');
  const geometry = loader.load('./lib/inventory/siteMap.ts');
  const { areaBounds } = loader.load('./lib/inventory/areas.ts');
  const views = [], changes = [];
  const props = { map: plan('map-a', 'Yard'), imageUri: 'file:///a.png', zones, pin: null, zoneId: null, focus: null,
    onChange: (value) => changes.push(value), onViewChange: (view) => views.push(view) };
  let r;
  await TestRenderer.act(async () => { r = TestRenderer.create(React.createElement(SiteMapPicker, props)); });
  await layOut(r);
  assert.deepEqual(shownView(r), FITTED, 'fitted and centred');

  await TestRenderer.act(async () => { r.update(React.createElement(SiteMapPicker, { ...props, zoneId: 'rack2', focus: { areaId: 'rack2', nonce: 1 } })); });
  const expected = geometry.viewForBounds(areaBounds(zones[1].shape), image, frame);
  const shown = shownView(r);
  assert.ok(expected.scale > 1);
  assert.ok(close(shown.x, expected.x) && close(shown.y, expected.y) && close(shown.scale, expected.scale), JSON.stringify({ shown, expected }));
  assert.ok(close(views.at(-1).scale, expected.scale), 'the zoom is reported so Count next can keep it');
  // The chosen area strong, its parent dashed, the rest faint.
  const tiers = r.root.findAll(n => n.type === 'SvgPolygon').map(n => `${n.props.strokeWidth}${n.props.strokeDasharray ? ' dashed' : ''}`).sort();
  assert.deepEqual(tiers, ['1', '2 dashed', '3']);

  // Fit again, then tap the middle of Bay B on screen: the tap reports Bay B.
  await TestRenderer.act(async () => { r.root.findAll(n => n.type === 'Button' && n.props.title === 'Fit')[0].props.onPress(); });
  assert.deepEqual(shownView(r), FITTED);
  const tap = gestures.find(g => g.kind === 'tap');
  const middle = geometry.pinToScreen({ x: 0.77, y: 0.25 }, FITTED, image, frame);
  await TestRenderer.act(async () => { tap.handlers.onEnd({ x: middle.x, y: middle.y }, true); });
  assert.equal(changes.at(-1).zone.id, 'bayB');
  assert.ok(close(changes.at(-1).pin.x, 0.77) && close(changes.at(-1).pin.y, 0.25));
  await TestRenderer.act(async () => { tap.handlers.onEnd({ x: 200, y: 20 }, true); });
  assert.equal(changes.length, 1, 'a tap off the image places nothing');
  await TestRenderer.act(async () => { r.unmount(); });
});

test('switching plans and back starts fitted, not zoomed to an area no longer chosen', async () => {
  const store = create((set) => ({
    location: { siteMapId: null, pin: null, zoneId: null, zoneName: '' }, mapView: null,
    setLocation: (location) => set({ location }), setMapView: (mapView) => set({ mapView }),
  }));
  const { loader } = load({ store });
  const { CountLocationStep } = loader.load('./components/inventory/CountLocationStep.tsx');
  const { locationRule } = loader.load('./lib/inventory/areas.ts');
  const reference = {
    categories: [], items: [], savedAt: '2026-10-28T09:00:00Z', images: { 'map-a': 'file:///a.png', 'map-b': 'file:///b.png' },
    maps: [plan('map-a', 'Training Yard'), plan('map-b', 'Warehouse')], zones,
  };
  let r;
  await TestRenderer.act(async () => {
    r = TestRenderer.create(React.createElement(CountLocationStep, { reference, rule: locationRule(reference.maps, zones, true), onNext() {}, onBack() {} }),
      { createNodeMock: () => ({ scrollTo() {} }) });
  });
  await layOut(r);
  assert.deepEqual(shownView(r), FITTED);
  const press = async (label) => {
    const [node] = r.root.findAll(n => n.type === 'Pressable' && n.props.accessibilityLabel === label);
    await TestRenderer.act(async () => { node.props.onPress(); });
  };
  await press('Expand T1 Pipe Racks');
  await press('Choose T1 Pipe Racks › Rack 2');
  assert.ok(shownView(r).scale > 1, 'picking from the list zooms the real plan');
  const chip = (title) => r.root.findAll(n => n.type === 'Button' && n.props.title === title)[0];
  await TestRenderer.act(async () => { chip('Warehouse').props.onPress(); });
  await layOut(r);
  assert.deepEqual(shownView(r), FITTED, 'the other plan starts fitted');
  await TestRenderer.act(async () => { chip('Training Yard').props.onPress(); });
  await layOut(r);
  assert.deepEqual(shownView(r), FITTED, 'back on the first plan: fitted, not zoomed to Rack 2');
  assert.equal(store.getState().mapView, null);
  await TestRenderer.act(async () => { r.unmount(); });
});
