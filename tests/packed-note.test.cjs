const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// "Where it is" on the Count and material screens: the server's item_positions
// answer (022) first; the device's copy offline, before 022, or while a change
// to the item waits in Sync.
function note({ server = null, queue = [], local = null } = {}) {
  const routes = [], asked = [];
  const element = (name) => (props) => React.createElement(name, props, props.children);
  const loader = createModuleLoader({ stubs: {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: { create: (s) => s }, Platform: { OS: 'ios' } },
    'expo-router': { router: { push: (r) => routes.push(r) }, useFocusEffect: () => {} },
    '@expo/vector-icons/FontAwesome': element('Icon'),
    '@/stores/authStore': { useAuthStore: Object.assign(() => null, { getState: () => ({ user: { id: 'worker-a', role: 'field_worker' }, activeProject: { id: 'project-a' } }) }) },
    '@/lib/api/logistics': { packedInNow: async () => local, itemOnLoadNow: async () => null, loadLoad: async () => ({}), readCachedLoad: async () => ({}) },
    '@/lib/api/tags': { lookupTag: async (tag) => { asked.push(tag); return server; } },
    '@/lib/sync/offlineQueue': { getQueue: async () => queue, belongsToCurrentContext: () => true, subscribeQueue: () => () => {} },
    '@/lib/sync/networkStore': { useNetworkStore: { getState: () => ({ isOnline: true }) } },
    '@/lib/design/tokens': { colors: new Proxy({}, { get: () => '#000' }), radius: new Proxy({}, { get: () => 4 }), space: new Proxy({}, { get: () => 4 }), fontSize: new Proxy({}, { get: () => 4 }), fontWeight: new Proxy({}, { get: () => '500' }), touchTarget: 44 },
  } });
  return { PackedInNote: loader.load('./components/logistics/PackedInNote.tsx').PackedInNote, routes, asked };
}
async function show(h, tag) {
  let r;
  await TestRenderer.act(async () => { r = TestRenderer.create(React.createElement(h.PackedInNote, { tag })); });
  await TestRenderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  return r;
}
const textOf = (r) => r.root.findAll(n => n.type === 'Text').map(n => [].concat(n.props.children).join('')).join(' ');

test('the server’s answer says where the item is, and opens its crate or load', async () => {
  const h = note({ server: { kind: 'counted', code: 'GT-1', can_receive: true, position: 'in_crate', crate_code: 'HU-IN0001', top_crate_code: 'HU-AAAA01', place_name: 'Training Yard' }, local: { code: 'HU-OLD001', text: 'In crate HU-OLD001' } });
  const r = await show(h, 'GT-1');
  assert.equal(textOf(r), 'In crate HU-IN0001 (inside HU-AAAA01) at Training Yard');
  await TestRenderer.act(async () => { r.root.findByType('Pressable').props.onPress(); });
  assert.deepEqual(JSON.parse(JSON.stringify(h.routes)), [{ pathname: '/(field)/crate', params: { code: 'HU-AAAA01' } }]);

  const away = note({ server: { kind: 'counted', code: 'GT-1', can_receive: true, position: 'at_place', place_name: 'Gulf Machine' } });
  const a = await show(away, 'GT-1');
  assert.equal(textOf(a), 'Gulf Machine');
  assert.equal(a.root.findAll(n => n.type === 'Pressable').length, 0, 'a place opens nothing');
});

test('without the server, or while a change to the item waits in Sync, the device’s copy answers', async () => {
  const offline = note({ server: null, local: { code: 'HU-AAAA01', text: 'In crate HU-AAAA01 at Training Yard' } });
  assert.equal(textOf(await show(offline, 'GT-1')), 'In crate HU-AAAA01 at Training Yard');
  const waiting = note({
    server: { kind: 'counted', code: 'GT-1', can_receive: true, position: 'at_place', place_name: 'Training Yard' },
    queue: [{ id: 'p', userId: 'worker-a', projectId: 'project-a', action: { type: 'pack', payload: { pack: { unitCode: 'HU-NEW001', add: ['gt-1'], seal: false } } } }],
    local: { code: 'HU-NEW001', text: 'In crate HU-NEW001' },
  });
  assert.equal(textOf(await show(waiting, 'GT-1')), 'In crate HU-NEW001');
  assert.deepEqual(waiting.asked, [], 'the server isn’t asked: the waiting pack is newer');
});
