const test = require('node:test');
const assert = require('node:assert/strict');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

// The materials list as Inventory (and the office Materials page) asks for it,
// with a project client that records each query and answers from `codes`.
function setup({ codes = [], codeError = null } = {}) {
  const queries = [];
  const builder = (table) => {
    const query = { table, calls: [] };
    queries.push(query);
    const chain = new Proxy({}, {
      get: (_, method) => {
        if (method === 'then') {
          const byCode = query.calls.some(([name, columns]) => name === 'select' && /qr_codes!inner/.test(columns));
          return (resolve) => resolve(byCode ? { data: codeError ? null : codes, error: codeError } : { data: [], error: null });
        }
        return (...args) => { query.calls.push([method, ...args]); return chain; };
      },
    });
    return chain;
  };
  const auth = { user: { id: 'worker-a' }, session: { access_token: 'test' }, activeProject: { id: 'project-a', status: 'active' } };
  const loader = createModuleLoader({ stubs: {
    'react-native': { Platform: { OS: 'ios' } },
    '@react-native-async-storage/async-storage': { getItem: async () => null, setItem: async () => {} },
    '@/stores/authStore': { useAuthStore: { getState: () => auth } },
    '@/lib/sync/networkStore': { useNetworkStore: { getState: () => ({ isOnline: true }) } },
    '@/lib/supabase': { supabase: {} },
    '@/lib/supabaseProject': { getProjectClient: () => ({ projectId: 'project-a', from: (table) => ({ select: (columns) => builder(table).select(columns) }) }) },
  } });
  return { api: loader.load('./lib/api/materials.ts'), queries };
}
// Plain copies: the module's objects come from its own sandbox.
const callsOf = (query, method) => JSON.parse(JSON.stringify(query.calls.filter(([name]) => name === method).map(([, ...args]) => args)));
// The code lookup selects ids through qr_codes; the list itself everything.
const asked = (h, kind) => h.queries.find(query => query.calls.some(([name, columns]) => name === 'select' && /qr_codes!inner/.test(columns)) === (kind === 'codes'));

test('known limits: Inventory search matches the QR code as well as type and grade, whatever the capitals', async () => {
  const h = setup({ codes: [{ id: 'm-1' }, { id: 'm-2' }] });
  await h.api.fetchMaterials({ search: '  pipe-1 ' });
  const codes = asked(h, 'codes'), materials = asked(h, 'list');
  assert.equal(codes.table, 'materials', 'only materials’ codes: unused labels and crate labels are never found');
  assert.deepEqual(callsOf(codes, 'select'), [['id, qr_codes!inner(code_value)']]);
  assert.deepEqual(callsOf(codes, 'ilike'), [['qr_codes.code_value', '%pipe-1%']]);
  assert.deepEqual(callsOf(codes, 'order'), [['created_at', { ascending: false }]]);
  assert.deepEqual(callsOf(codes, 'limit'), [[100]]);
  assert.deepEqual(callsOf(materials, 'or'), [['material_type.ilike."%pipe-1%",grade.ilike."%pipe-1%",id.in.(m-1,m-2)']]);
});

test('known limits: the code lookup keeps the list’s filters, so its 100 are spent on what can show', async () => {
  const h = setup({ codes: [{ id: 'm-1' }] });
  await h.api.fetchMaterials({ search: 'PIPE', status: 'in_yard', material_type: 'Pipe' });
  assert.deepEqual(callsOf(asked(h, 'codes'), 'eq'), [['status', 'in_yard'], ['material_type', 'Pipe']]);
  assert.deepEqual(callsOf(asked(h, 'list'), 'eq'), [['status', 'in_yard'], ['material_type', 'Pipe']]);
});

test('known limits: what is typed stays text in the search: commas, brackets, quotes, % and _', async () => {
  const h = setup();
  await h.api.fetchMaterials({ search: 'A106, Gr "B" (5%)_x' });
  const codes = asked(h, 'codes'), materials = asked(h, 'list');
  // ILIKE wildcards in the text are escaped; the PostgREST list value is quoted.
  assert.deepEqual(callsOf(codes, 'ilike'), [['qr_codes.code_value', '%A106, Gr "B" (5\\%)\\_x%']]);
  assert.deepEqual(callsOf(materials, 'or'), [['material_type.ilike."%A106, Gr \\"B\\" (5\\\\%)\\\\_x%",grade.ilike."%A106, Gr \\"B\\" (5\\\\%)\\\\_x%"']], 'no code matched: type and grade only');
});

test('a long paste is cut to the longest tag, keeping the request short', async () => {
  const h = setup();
  await h.api.fetchMaterials({ search: `${'é'.repeat(200)}` });
  assert.equal(h.api.SEARCH_MAX, 120);
  assert.deepEqual(callsOf(asked(h, 'codes'), 'ilike'), [['qr_codes.code_value', `%${'é'.repeat(120)}%`]]);
});

test('no search asks for no codes; a failed code lookup is an error, not an empty list', async () => {
  const plain = setup();
  await plain.api.fetchMaterials({ status: 'in_yard' });
  assert.equal(plain.queries.length, 1);
  assert.deepEqual(callsOf(plain.queries[0], 'or'), []);
  const blank = setup();
  await blank.api.fetchMaterials({ search: '   ' });
  assert.equal(blank.queries.length, 1);

  const failing = setup({ codeError: { message: 'JWT expired' } });
  await assert.rejects(() => failing.api.fetchMaterials({ search: 'PIPE' }), /JWT expired/);
});

const React = require('react');
const TestRenderer = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The Inventory tab over a fetchMaterials that answers when the test says.
function inventoryScreen() {
  const asks = [];
  const auth = { user: { id: 'worker-a' }, activeProject: { id: 'project-a', status: 'active' } };
  const element = (name) => (props) => React.createElement(name, props, props.children);
  const loader = createModuleLoader({ stubs: {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': {
      View: 'View', Text: 'Text', TextInput: 'TextInput', FlatList: 'FlatList', ScrollView: 'ScrollView', TouchableOpacity: 'TouchableOpacity',
      RefreshControl: 'RefreshControl', ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: (styles) => styles }, Alert: { alert() {} },
    },
    'expo-router': { router: { push() {} }, useFocusEffect: (effect) => React.useEffect(effect, [effect]) },
    '@expo/vector-icons/FontAwesome': element('Icon'),
    '@/components/ui/Button': { Button: element('Button') },
    '@/lib/api/materials': { SEARCH_MAX: 120, fetchMaterials: (filters) => new Promise(resolve => { asks.push({ filters, resolve }); }) },
    '@/lib/api/tags': { positionsOfMaterials: async () => new Map() },
    '@/lib/logistics/positions': { positionText: () => '' },
    '@/stores/authStore': { useAuthStore: Object.assign((select) => (select ? select(auth) : auth), { getState: () => auth }) },
    '@/lib/sync/networkStore': { useNetworkStore: Object.assign((select) => select({ isOnline: true }), { getState: () => ({ isOnline: true }) }) },
    '@/lib/sync/readCache': { getCached: async () => null, setCache: async () => {} },
    '@/lib/design/tokens': { colors: new Proxy({}, { get: () => '#000' }) },
  } });
  return { Screen: loader.load('./app/(field)/inventory.tsx').default, asks };
}
const row = (id) => ({ id, material_type: `Pipe ${id}`, size: null, grade: null, qty: 1, current_quantity: 1, status: 'in_yard', qr_code_value: id, location_zone: null });

test('known limits: Inventory shows only the latest search, and asks for no more of an older one', async () => {
  const h = inventoryScreen();
  let r;
  await TestRenderer.act(async () => { r = TestRenderer.create(React.createElement(h.Screen)); });
  assert.equal(r.root.findByType('TextInput').props.maxLength, 120);
  await TestRenderer.act(async () => { h.asks[0].resolve({ data: [row('first')], hasMore: true }); });
  await TestRenderer.act(async () => { r.root.findByType('TextInput').props.onChangeText('P'); });
  await TestRenderer.act(async () => { r.root.findByType('TextInput').props.onChangeText('PI'); });
  assert.deepEqual(h.asks.map(ask => ask.filters.search ?? ''), ['', 'P', 'PI']);

  // While "PI" loads, reaching the end asks for nothing more of the old list.
  await TestRenderer.act(async () => { r.root.findByType('FlatList').props.onEndReached(); });
  assert.equal(h.asks.length, 3);

  // "PI" answers first; the slower "P" must not replace it.
  await TestRenderer.act(async () => { h.asks[2].resolve({ data: [row('pi')], hasMore: false }); });
  await TestRenderer.act(async () => { h.asks[1].resolve({ data: [row('p')], hasMore: false }); });
  assert.deepEqual(r.root.findByType('FlatList').props.data.map(item => item.id), ['pi']);
  await TestRenderer.act(async () => { r.unmount(); });
});
