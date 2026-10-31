const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const plain = (value) => JSON.parse(JSON.stringify(value));
const element = (name) => (props) => React.createElement(name, props, props.children);
const tokens = { colors: new Proxy({}, { get: () => '#000' }), radius: new Proxy({}, { get: () => 4 }), space: new Proxy({}, { get: () => 4 }), fontSize: new Proxy({}, { get: () => 14 }), fontWeight: new Proxy({}, { get: () => '600' }) };

test('the repeat filter passes each code once, until it has been out of view for 2 s', () => {
  const { createRepeatFilter } = createModuleLoader().load('./components/scanning/repeatFilter.ts');
  const fresh = createRepeatFilter();
  assert.equal(fresh('PIPE-1', 0), true);
  assert.equal(fresh('PIPE-1', 100), false, 'the camera reports a code many times a second');
  assert.equal(fresh(' PIPE-1 ', 1500), false, 'still in view');
  assert.equal(fresh('PIPE-2', 1600), true, 'another code passes at once');
  assert.equal(fresh('PIPE-1', 1700), false, 'two labels in view do not take turns');
  assert.equal(fresh('PIPE-1', 3800), true, 'out of view for over 2 s: scanned again');
  assert.equal(fresh('', 3900), false);
});

// The real QRScanner with the camera faked: the test plays the camera's reports.
function scanner({ granted = true } = {}) {
  const loader = createModuleLoader({ stubs: {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': {
      View: 'View', Text: 'Text', Modal: element('Modal'), StyleSheet: { create: (styles) => styles }, Platform: { OS: 'android' },
      AccessibilityInfo: { announceForAccessibility() {} },
    },
    'expo-camera': { CameraView: element('CameraView'), useCameraPermissions: () => [{ granted }, () => {}] },
    '@expo/vector-icons/FontAwesome': element('Icon'),
    '@/components/ui/Button': { Button: element('Button') },
    '@/components/ui/Input': { Input: element('Input') },
    '@/lib/design/tokens': tokens,
  } });
  vm.runInContext('Date.now = () => globalThis.__now', loader.context);
  loader.context.__now = 0;
  return { QRScanner: loader.load('./components/scanning/QRScanner.tsx').QRScanner, clock: loader.context };
}
const texts = (renderer) => renderer.root.findAll(n => n.type === 'Text').map(n => [].concat(n.props.children).join(''));

test('continuous scanning keeps the camera live, ignores repeats, shows a tick and the running count', async () => {
  const { QRScanner, clock } = scanner();
  const scans = [];
  const onScan = async (code) => { scans.push(code); return { tone: 'ok', message: `${code} added.` }; };
  let r;
  await TestRenderer.act(async () => { r = TestRenderer.create(React.createElement(QRScanner, { continuous: true, onScan, countLabel: '3 in HU-AB12CD' })); });
  const report = async (data, at) => { clock.__now = at; await TestRenderer.act(async () => { r.root.findByType('CameraView').props.onBarcodeScanned({ data }); }); };
  await report('PIPE-1', 0);
  await report('PIPE-1', 50);
  await report('PIPE-1', 900);
  await report('PIPE-2', 1000);
  await report('PIPE-1', 3500);
  assert.deepEqual(scans, ['PIPE-1', 'PIPE-2', 'PIPE-1']);
  assert.ok(texts(r).includes('3 in HU-AB12CD'));
  assert.ok(texts(r).includes('PIPE-1 added.'));
  assert.equal(r.root.findAll(n => n.type === 'Icon' && n.props.name === 'check-circle').length, 1, 'a tick for the scan taken');
  assert.equal(r.root.findAll(n => n.type === 'Button' && n.props.title === 'Scan Again').length, 0, 'no need to tap between scans');

  // Manual entry still works, and a typed code is never treated as a repeat.
  await TestRenderer.act(async () => { r.root.findAll(n => n.type === 'Button' && n.props.title === 'Enter Code Manually')[0].props.onPress(); });
  await TestRenderer.act(async () => { r.root.findByType('Input').props.onChangeText(' PIPE-1 '); });
  await TestRenderer.act(async () => { r.root.findAll(n => n.type === 'Button' && n.props.title === 'Submit')[0].props.onPress(); });
  assert.deepEqual(scans, ['PIPE-1', 'PIPE-2', 'PIPE-1', 'PIPE-1']);

  // A refusal shows as a warning, not a tick.
  const refuse = async () => ({ tone: 'warn', message: 'PIPE-9 isn’t a received or counted item in this project.' });
  await TestRenderer.act(async () => { r.update(React.createElement(QRScanner, { continuous: true, onScan: refuse })); });
  await report('PIPE-9', 9000);
  assert.equal(r.root.findAll(n => n.type === 'Icon' && n.props.name === 'exclamation-triangle').length, 1);
  await TestRenderer.act(async () => { r.unmount(); });
});

test('single scans are unchanged: one code, then Scan Again', async () => {
  const { QRScanner } = scanner();
  const scans = [];
  let r;
  await TestRenderer.act(async () => { r = TestRenderer.create(React.createElement(QRScanner, { onScan: (code) => { scans.push(code); } })); });
  await TestRenderer.act(async () => { r.root.findByType('CameraView').props.onBarcodeScanned({ data: 'PIPE-1' }); });
  assert.equal(r.root.findByType('CameraView').props.onBarcodeScanned, undefined);
  assert.ok(r.root.findAll(n => n.type === 'Button' && n.props.title === 'Scan Again').length === 1);
  assert.deepEqual(scans, ['PIPE-1']);
  await TestRenderer.act(async () => { r.unmount(); });
});

// The real Scan screen and pack draft store; lookups and navigation faked.
function scanScreen() {
  const routes = [], lookups = [];
  const records = new Map();
  const loader = createModuleLoader({ stubs: {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    zustand: require('zustand'),
    'zustand/middleware': require('zustand/middleware'),
    'react-native': { Platform: { OS: 'ios', select: (options) => options.ios ?? options.default }, StyleSheet: { create: (styles) => styles }, Text: 'Text' },
    '@react-native-async-storage/async-storage': { getItem: async (k) => records.get(k) ?? null, setItem: async (k, v) => { records.set(k, v); }, removeItem: async (k) => { records.delete(k); } },
    'expo-router': { router: { push: (route) => routes.push(route) } },
    '@/components/scanning/QRScanner': { QRScanner: (props) => React.createElement('QRScanner', props, props.actions) },
    '@/components/ui/Button': { Button: element('Button') },
    '@/lib/api/qrcodes': { lookupMaterialByQR: async (code) => { lookups.push(code); return null; } },
    // lookup_tag unavailable (offline or before 022): the earlier lookups decide.
    '@/lib/api/tags': { lookupTag: async () => null },
    '@/lib/api/inventory': { findInventoryByTag: async (code) => { lookups.push(code); return null; }, countedAreaInfo: async () => ({}) },
  } });
  const { ScanScreenContent } = loader.load('./components/screens/ScanScreen.tsx');
  const { usePackStore } = loader.load('./stores/packStore.ts');
  return { ScanScreenContent, usePackStore, routes, lookups };
}
const props = { materialDetailRoute: '/(field)/material-detail', receivingRoute: '/(field)/receiving', crateRoute: '/(field)/crate', packRoute: '/(field)/pack' };

test('Scan sends crate labels in any case to the Crate screen, with no lookup, so it works offline', async () => {
  const h = scanScreen();
  let r;
  await TestRenderer.act(async () => { r = TestRenderer.create(React.createElement(h.ScanScreenContent, props)); });
  await TestRenderer.act(async () => { await r.root.findByType('QRScanner').props.onScan(' hu-ab12cd '); });
  assert.deepEqual(plain(h.routes), [{ pathname: '/(field)/crate', params: { code: 'HU-AB12CD' } }]);
  assert.deepEqual(h.lookups, [], 'no server or receiving lookup for a crate label');
  await TestRenderer.act(async () => { await r.root.findByType('QRScanner').props.onScan('GT2-LO-001'); });
  assert.equal(h.routes[1], '/(field)/receiving', 'item tags still go to receiving');
  assert.deepEqual(h.lookups, ['GT2-LO-001', 'GT2-LO-001']);

  const pack = r.root.findAll(n => n.type === 'Button')[0];
  assert.equal(pack.props.title, 'Pack a crate');
  await TestRenderer.act(async () => { pack.props.onPress(); });
  assert.equal(h.routes[2], '/(field)/pack');
  await TestRenderer.act(async () => { h.usePackStore.getState().begin('HU-AB12CD', null); });
  assert.equal(r.root.findAll(n => n.type === 'Button')[0].props.title, 'Continue packing HU-AB12CD');
  await TestRenderer.act(async () => { r.unmount(); });
});
