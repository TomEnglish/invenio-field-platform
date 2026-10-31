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
          const rows = table === 'qr_codes' ? codes : [];
          return (resolve) => resolve({ data: codeError && table === 'qr_codes' ? null : rows, error: table === 'qr_codes' ? codeError : null });
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
const asked = (h, table) => h.queries.find(query => query.table === table);

test('known limits: Inventory search matches the QR code as well as type and grade, whatever the capitals', async () => {
  const h = setup({ codes: [{ id: 'qr-1' }, { id: 'qr-2' }] });
  await h.api.fetchMaterials({ search: '  pipe-1 ' });
  const codes = asked(h, 'qr_codes'), materials = asked(h, 'materials');
  assert.deepEqual(callsOf(codes, 'ilike'), [['code_value', '%pipe-1%']]);
  assert.deepEqual(callsOf(codes, 'neq'), [['entity_type', 'handling_unit']], 'crate labels are never materials');
  assert.deepEqual(callsOf(codes, 'order'), [['created_at', { ascending: false }]]);
  assert.deepEqual(callsOf(codes, 'limit'), [[100]]);
  assert.deepEqual(callsOf(materials, 'or'), [['material_type.ilike."%pipe-1%",grade.ilike."%pipe-1%",qr_code_id.in.(qr-1,qr-2)']]);
});

test('known limits: what is typed stays text in the search: commas, brackets, quotes, % and _', async () => {
  const h = setup();
  await h.api.fetchMaterials({ search: 'A106, Gr "B" (5%)_x' });
  const codes = asked(h, 'qr_codes'), materials = asked(h, 'materials');
  // ILIKE wildcards in the text are escaped; the PostgREST list value is quoted.
  assert.deepEqual(callsOf(codes, 'ilike'), [['code_value', '%A106, Gr "B" (5\\%)\\_x%']]);
  assert.deepEqual(callsOf(materials, 'or'), [['material_type.ilike."%A106, Gr \\"B\\" (5\\\\%)\\\\_x%",grade.ilike."%A106, Gr \\"B\\" (5\\\\%)\\\\_x%"']], 'no code matched: type and grade only');
});

test('no search asks for no codes; a failed code lookup is an error, not an empty list', async () => {
  const plain = setup();
  await plain.api.fetchMaterials({ status: 'in_yard' });
  assert.deepEqual(plain.queries.map(q => q.table), ['materials']);
  assert.deepEqual(callsOf(plain.queries[0], 'or'), []);
  const blank = setup();
  await blank.api.fetchMaterials({ search: '   ' });
  assert.deepEqual(blank.queries.map(q => q.table), ['materials']);

  const failing = setup({ codeError: { message: 'JWT expired' } });
  await assert.rejects(() => failing.api.fetchMaterials({ search: 'PIPE' }), /JWT expired/);
});
