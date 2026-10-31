const test = require('node:test');
const assert = require('node:assert/strict');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

// The real crate cache (lib/api/logistics.ts), offline queue and sync manager.
// Only storage, the network flag and Supabase are faked.
const plain = (value) => JSON.parse(JSON.stringify(value));
const OPERATION = '30000000-0000-4000-8000-000000000003';

function setup({ tables = {}, online = true, rpc, onQuery, onWrite, onRead } = {}) {
  const records = new Map();
  const calls = { queries: [], rpc: [] };
  const auth = { accessMode: 'online', loading: false, user: { id: 'worker-a' }, session: { access_token: 'test' }, activeProject: { id: 'project-a', status: 'active' } };
  const network = { isOnline: online };
  const valueAt = (row, path) => path.split('.').reduce((value, key) => value?.[key], row);
  const query = (table, projectId, columns) => {
    const state = { table, projectId, columns, filters: [] };
    const filter = (op) => (column, value) => { state.filters.push([op, column, value]); return builder; };
    const builder = {
      eq: filter('eq'), ilike: filter('ilike'), neq: filter('neq'), gt: filter('gt'), in: filter('in'), or: (expression) => { state.filters.push(['or', expression]); return builder; },
      order: () => builder,
      limit: () => builder,
      then: (resolve, reject) => builder.range(0, 999).then(resolve, reject),
      range: async (from, to) => {
        calls.queries.push(state);
        if (onQuery) await onQuery(state, auth);
        let rows = (tables[table] ?? []).filter(row => !projectId || !('project_id' in row) || row.project_id === projectId);
        for (const [op, column, value] of state.filters) {
          if (op === 'or') {
            const allowed = column.split(',').map(part => part.split('.'));
            rows = rows.filter(row => allowed.some(([field, test, wanted]) => (test === 'is' ? row[field] === null : row[field] === wanted)));
          } else rows = rows.filter(row => (op === 'eq' ? valueAt(row, column) === value : op === 'ilike' ? String(valueAt(row, column) ?? '').toLowerCase() === value.replace(/\\(.)/g, '$1').toLowerCase() : op === 'neq' ? valueAt(row, column) !== value : op === 'in' ? value.includes(valueAt(row, column)) : valueAt(row, column) > value));
        }
        return { data: rows.slice(from, to + 1), error: null };
      },
    };
    return builder;
  };
  const loader = createModuleLoader({ stubs: {
    'react-native': { Platform: { OS: 'ios' } },
    '@react-native-async-storage/async-storage': { getItem: async (k) => { const value = records.get(k) ?? null; if (onRead) await onRead(k); return value; }, setItem: async (k, v) => { records.set(k, v); if (onWrite) await onWrite(k, auth); } },
    '@/stores/authStore': { useAuthStore: { getState: () => auth, subscribe: () => () => {} } },
    '@/lib/sync/networkStore': { useNetworkStore: { getState: () => network, subscribe: () => () => {} } },
    'lib/sync/networkStore.ts': { useNetworkStore: { getState: () => network, subscribe: () => () => {} } },
    '@/lib/supabaseProject': { getProjectClient: () => { const projectId = auth.activeProject.id; return { projectId, from: (table) => ({ select: (columns) => query(table, projectId, columns) }) }; } },
    '@/lib/supabase': { supabase: {
      from: (table) => ({ select: (columns) => query(table, null, columns) }),
      rpc: async (name, args) => {
        assert.equal(name, 'apply_field_operation');
        calls.rpc.push(plain(args));
        if (rpc) return rpc(args);
        const unitCode = args.p_payload.unitCode;
        return { data: args.p_action === 'pack' ? { id: 'unit-1', code: unitCode, status: args.p_payload.seal ? 'sealed' : 'open', created: true, item_count: 1, unit_count: 0 } : { id: 'unit-1', code: unitCode, status: 'unpacked', items_released: 1, units_released: 0 }, error: null };
      },
    } },
    'lib/api/receiving.ts': { submitReceivingRecord: async () => { throw new Error('unexpected receiving'); } },
    'lib/api/materials.ts': { transferMaterial: async () => {}, issueMaterial: async () => {} },
    'lib/api/shipments.ts': { createShipment: async () => {} },
    'lib/api/count.ts': { submitCount: async () => {} },
  } });
  return {
    api: loader.load('./lib/api/logistics.ts'), queue: loader.load('./lib/sync/offlineQueue.ts'), sync: loader.load('./lib/sync/syncManager.ts'),
    presentation: loader.load('./lib/sync/queuePresentation.ts'), records, calls, auth, network,
  };
}

const row = (code, extra = {}) => ({
  id: `id-${code}`, project_id: 'project-a', code, kind: 'crate', description: null, is_high_value: false, status: 'open', parent_id: null, parent_code: null, top_code: code,
  place_id: 'yard-a', place_name: 'Training Yard', site_map_id: 'map-a', zone_id: 'bay-1', location: 'T2 Laydown › Bay 1', item_count: 0, unit_count: 0, ...extra,
});
const tables = {
  handling_unit_overview: [row('HU-AAAA01', { item_count: 1, unit_count: 1 }), row('HU-INNER2', { parent_code: 'HU-AAAA01', top_code: 'HU-AAAA01' }), row('HU-OTHER1', { project_id: 'project-b' })],
  handling_unit_items: [{ project_id: 'project-a', unit_code: 'HU-AAAA01', tag: 'PIPE-1', name: '6" pipe', quantity: 1, uom: 'EA', material_id: 'm-1', inventory_uid: null }],
  places: [
    { id: 'yard-a', kind: 'yard', name: 'Training Yard', project_id: 'project-a', city: 'Houston', state: 'TX', is_active: true },
    { id: 'shop', kind: 'outside_shop', name: 'Gulf Machine', project_id: null, city: null, state: null, is_active: true },
    { id: 'yard-b', kind: 'yard', name: 'North Yard', project_id: 'project-b', city: null, state: null, is_active: true },
    { id: 'old', kind: 'vendor', name: 'Closed Vendor', project_id: null, city: null, state: null, is_active: false },
  ],
  materials: [
    { id: 'm-1', project_id: 'project-a', material_type: 'Pipe', size: '6"', grade: null, current_quantity: 1, status: 'in_yard', qr_codes: { code_value: 'PIPE-1' } },
    { id: 'm-2', project_id: 'project-a', material_type: 'Pipe', size: '4"', grade: 'A106', current_quantity: 3, status: 'in_yard', qr_codes: { code_value: ' PIPE-2 ' } },
    { id: 'm-3', project_id: 'project-a', material_type: 'Valve', size: null, grade: null, current_quantity: 0, status: 'depleted', qr_codes: { code_value: 'VALVE-1' } },
  ],
  inventory_records: Array.from({ length: 1200 }, (_, i) => ({ project_id: 'project-a', uid: `u-${i}`, qr_code: `GT-${i}`, inventory_item: `Item ${i}`, quantity: 1, uom: 'EA', count_status: i % 2 ? 'counted' : 'expected' })),
};

test('crates, places and packable tags are saved per account and project, in chunks, for offline use', async () => {
  const h = setup({ tables });
  const result = await h.api.loadLoad();
  assert.equal(result.source, 'online');
  assert.deepEqual(plain(result.data.units.map(u => u.code)), ['HU-AAAA01', 'HU-INNER2'], 'only this project’s crates');
  assert.deepEqual(plain(result.data.places.map(p => p.id)), ['yard-a', 'shop'], 'shared places and this project’s, active only');
  assert.deepEqual(plain(result.data.materials), [{ id: 'm-1', tag: 'PIPE-1', name: 'Pipe 6"', quantity: 1 }, { id: 'm-2', tag: 'PIPE-2', name: 'Pipe 4" A106', quantity: 3 }]);
  assert.ok(h.calls.queries.some(q => q.table === 'materials' && q.filters.some(f => f[0] === 'eq' && f[1] === 'status' && f[2] === 'in_yard')));
  assert.equal(result.data.counted.length, 1200);
  assert.ok([...h.records.keys()].every(key => key.startsWith('cache_worker-a_project-a_')));
  assert.equal(JSON.parse(h.records.get('cache_worker-a_project-a_load_counted_chunks')).data, 3, 'tags are stored 500 to a row');

  h.network.isOnline = false;
  const offline = await h.api.loadLoad();
  assert.equal(offline.source, 'cache');
  assert.deepEqual(plain(offline.data), plain(result.data));
  h.auth.activeProject = { id: 'project-b', status: 'active' };
  assert.equal((await h.api.loadLoad()).data.units.length, 0, 'another project sees none of it');
});

test('a queued pack is sent as apply_field_operation "pack" with the session payload, and shows before the next download', async () => {
  const h = setup({ tables });
  await h.api.loadLoad();
  const pack = { unitCode: 'HU-NEW123', seal: true, kind: 'skid', add: ['PIPE-2', 'HU-AAAA01'], zoneId: 'bay-3', siteMapId: 'map-a' };
  await h.queue.addToQueue({ type: 'pack', payload: { pack, zoneName: 'T2 Laydown › Bay 3' } }, OPERATION);
  const [saved] = await h.queue.getQueue();
  assert.deepEqual(plain(h.presentation.queueSummary(saved)), { title: 'HU-NEW123', detail: 'Crate packing · 2 in · Sealed · T2 Laydown › Bay 3' });

  const result = await h.sync.processQueue();
  assert.deepEqual(plain(result), { processed: 1, failed: 0 });
  assert.deepEqual(h.calls.rpc, [{ p_operation_id: OPERATION, p_project_id: 'project-a', p_action: 'pack', p_payload: pack }]);
  assert.equal((await h.queue.getQueue()).length, 0);

  const cached = await h.api.readCachedLoad();
  const crate = cached.units.find(u => u.code === 'HU-NEW123');
  assert.equal(crate.status, 'sealed');
  assert.equal(crate.location, 'T2 Laydown › Bay 3');
  assert.equal(cached.units.find(u => u.code === 'HU-AAAA01').parent_code, 'HU-NEW123');
  assert.equal(cached.units.find(u => u.code === 'HU-INNER2').top_code, 'HU-NEW123');
  assert.ok(cached.items.some(item => item.tag === 'PIPE-2' && item.unit_code === 'HU-NEW123'));

  // The next download has it, and the overlay is dropped.
  tables.handling_unit_overview.push(row('HU-NEW123', { status: 'sealed' }));
  await new Promise(resolve => setTimeout(resolve, 5));
  await h.api.refreshLoad();
  assert.deepEqual(JSON.parse(h.records.get('cache_worker-a_project-a_load_applied')).data, []);
  tables.handling_unit_overview.pop();
});

test('an unpack is sent with its crate code; a refusal stays in Sync with the server’s reason and can be discarded', async () => {
  const refusal = 'PIPE-1 is already in crate HU-AAAA01; take it out of that crate first';
  const h = setup({ tables, rpc: (args) => (args.p_action === 'pack' ? { data: null, error: { message: refusal, code: '22023' } } : { data: { id: 'unit-1', code: 'HU-AAAA01', status: 'unpacked', items_released: 1, units_released: 0 }, error: null }) });
  await h.queue.addToQueue({ type: 'unpack', payload: { unitCode: 'HU-AAAA01' } }, OPERATION);
  await h.queue.addToQueue({ type: 'pack', payload: { pack: { unitCode: 'HU-CCCC03', add: ['PIPE-1'], seal: false } } }, '30000000-0000-4000-8000-000000000004');
  const result = await h.sync.processQueue();
  assert.deepEqual(plain(result), { processed: 1, failed: 1 });
  assert.deepEqual(h.calls.rpc.map(call => [call.p_action, call.p_payload]), [['unpack', { unitCode: 'HU-AAAA01' }], ['pack', { unitCode: 'HU-CCCC03', add: ['PIPE-1'], seal: false }]]);
  const [left] = await h.queue.getQueue();
  assert.equal(left.lastError, refusal);
  assert.equal(h.presentation.crateRefused(left), true);
  assert.equal(h.presentation.queueRecoveryMessage(left), `The server refused this crate change: “${refusal}”. Sort that out and retry, or discard the change.`);
  assert.deepEqual(plain(h.presentation.queueSummary(left)), { title: 'HU-CCCC03', detail: 'Crate packing · 1 in · Left open' });
  assert.match(h.presentation.queueRecoveryMessage({ ...left, lastError: 'Choose a location' }), /can’t be sealed without a location/);
  assert.equal(left.refused, true, 'a 22023 needs a decision');
  assert.equal(left.retryCount, 0, 'and isn’t counted as a try');
  assert.equal(h.presentation.crateRefused({ ...left, lastError: 'Network request failed', lastErrorCode: undefined, refused: false }), false, 'connection failures just retry');
  assert.equal(h.presentation.queueSummary({ ...left, action: { type: 'unpack', payload: { unitCode: 'HU-AAAA01' } } }).title, 'HU-AAAA01');
});

test('a reply without the crate is not treated as saved, so the same operation retries', async () => {
  const h = setup({ rpc: () => ({ data: { id: 'x' }, error: null }) });
  await h.queue.addToQueue({ type: 'pack', payload: { pack: { unitCode: 'HU-NEW123', seal: false } } }, OPERATION);
  await h.sync.processQueue();
  const [left] = await h.queue.getQueue();
  assert.match(left.lastError, /not confirmed/);
  assert.equal(h.presentation.crateRefused(left), false);
});

test('a scanned tag the copy refuses is looked up on the server: crates by code, items in the yard by tag', async () => {
  const h = setup({ tables });
  const crate = await h.api.lookupTagOnline('hu-aaaa01');
  assert.deepEqual(plain(crate.units.map(u => u.code)), ['HU-AAAA01', 'HU-INNER2'], 'with every crate in the same outermost crate');
  assert.deepEqual(plain((await h.api.lookupCratesOnline(['HU-INNER2'])).map(u => u.code).sort()), ['HU-AAAA01', 'HU-INNER2']);
  const item = await h.api.lookupTagOnline(' PIPE-1 ');
  assert.deepEqual(plain(item.items.map(i => i.unit_code)), ['HU-AAAA01']);
  const materials = h.calls.queries.find(q => q.table === 'materials');
  assert.match(materials.columns, /qr_codes!inner\(code_value\)/, 'the tag filter is on the joined QR code');
  assert.ok(materials.filters.some(f => f[1] === 'qr_codes.code_value' && f[2] === 'PIPE-1'));
  assert.ok(materials.filters.some(f => f[1] === 'status' && f[2] === 'in_yard'));

  // "In crate … at …" for material and count views, online or from the copy.
  assert.deepEqual(plain(await h.api.packedInNow('PIPE-1', [])), { code: 'HU-AAAA01', text: 'In crate HU-AAAA01 at Training Yard · T2 Laydown › Bay 1' });
  h.network.isOnline = false;
  assert.equal(await h.api.packedInNow('PIPE-1', []), null, 'nothing saved on this device yet');
  h.network.isOnline = true;
  await h.api.loadLoad();
  h.network.isOnline = false;
  assert.equal((await h.api.packedInNow('PIPE-1', [])).code, 'HU-AAAA01');
  assert.equal(await h.api.packedInNow('PIPE-1', [{ type: 'unpack', payload: { unitCode: 'HU-AAAA01' } }]), null, 'an unpack waiting in Sync already counts');
});

test('refusals are recognised by their code (22023), never by words that could be part of a tag', () => {
  const h = setup();
  const item = (lastError, lastErrorCode, type = 'pack') => ({ id: 'x', userId: 'worker-a', projectId: 'project-a', lastError, lastErrorCode, action: { type, payload: { pack: { unitCode: 'HU-AB12CD', add: ['T'], seal: false }, unitCode: 'HU-AB12CD' } } });
  assert.equal(h.presentation.crateRefused(item('CONNECTOR-12 is already in crate HU-ABC123; take it out of that crate first', '22023')), true);
  assert.equal(h.presentation.crateRefused(item('Network request failed', undefined)), false);
  assert.equal(h.presentation.crateRefused(item('JWT expired', 'PGRST301')), false);
  // 022 refuses office-only steps with 42501 too: retrying unchanged can't help, so it waits for a decision.
  assert.equal(h.presentation.crateRefused(item("Crate HU-CONN01 isn't in this project", '42501', 'unpack')), true, 'access refusals need a decision');
  assert.equal(h.presentation.crateRefused({ ...item('Choose a location', '22023'), action: { type: 'count', payload: {} } }), false, 'counts have their own recovery');
  assert.equal(h.presentation.countRecoveryAction({ ...item('Choose a location', '22023'), action: { type: 'count', payload: {} } }), 'fix');
});

test('changes the server refused are left out of the device’s picture of the crates; others still count', () => {
  const loader = createModuleLoader({ stubs: {
    react: require('react'),
    'expo-router': { useFocusEffect: () => {} },
    '@/stores/authStore': { useAuthStore: Object.assign(() => null, { getState: () => ({ user: { id: 'worker-a' }, session: {}, activeProject: { id: 'project-a' } }) }) },
    '@/lib/sync/networkStore': { useNetworkStore: { getState: () => ({ isOnline: true }) } },
    '@/lib/sync/offlineQueue': { belongsToCurrentContext: (item) => item.userId === 'worker-a' && item.projectId === 'project-a', getQueue: async () => [], subscribeQueue: () => () => {} },
    '@/lib/api/logistics': { loadLoad: async () => ({}), readCachedLoad: async () => ({}) },
    '@/lib/sync/licenceMemory': { licenceKnown: () => false },
  } });
  const { waitingChanges } = loader.load('./components/logistics/useLoadReference.ts');
  const mine = (id, type, lastError, lastErrorCode) => ({ id, userId: 'worker-a', projectId: 'project-a', lastError, lastErrorCode, refused: lastErrorCode === '22023', action: { type, payload: { pack: { unitCode: 'HU-AB12CD', seal: false }, unitCode: 'HU-AB12CD', count: { tag: 'T-1' } } } });
  const queue = [
    mine('waiting', 'pack'), mine('offline', 'unpack', 'Network request failed'),
    mine('refused', 'pack', 'PIPE-1 is already in crate HU-ABC123; take it out of that crate first', '22023'),
    mine('count', 'count'), mine('count-refused', 'count', 'This tag has already been received'),
    mine('other', 'receiving'), { ...mine('elsewhere', 'pack'), projectId: 'project-b' },
    // A licence whose number went with an app restart, and one already recorded (photos left).
    { ...mine('licence-lost', 'licence'), action: { type: 'licence', payload: { loadId: 'l', label: 'L-0001', photos: [] } } },
    { ...mine('licence-photos', 'licence'), action: { type: 'licence', payload: { loadId: 'l', label: 'L-0001', photos: [], recorded: true } } },
  ];
  const { pending, refused } = waitingChanges(queue);
  assert.deepEqual(plain(pending.map(i => i.id)), ['waiting', 'offline', 'count', 'licence-photos']);
  assert.deepEqual(plain(refused.map(i => i.id)), ['refused', 'count-refused', 'licence-lost']);
});

test('a pack accepted while a download is being saved is not lost from the device’s copy', async () => {
  let reached, release;
  const gate = new Promise(resolve => { release = resolve; });
  // Hold the download between reading the accepted-changes list and rewriting it.
  const h = setup({ tables, onRead: async (key) => { if (/load_applied$/.test(key) && reached) { const go = reached; reached = null; go(); await gate; } } });
  const atRead = new Promise(resolve => { reached = resolve; });
  const refresh = h.api.refreshLoad();
  await atRead;
  await h.queue.addToQueue({ type: 'pack', payload: { pack: { unitCode: 'HU-NEW777', add: ['PIPE-2'], seal: false } } }, OPERATION);
  const sync = h.sync.processQueue();
  await new Promise(resolve => setTimeout(resolve, 5));
  release();
  await Promise.all([refresh, sync]);
  const applied = JSON.parse(h.records.get('cache_worker-a_project-a_load_applied')).data;
  assert.deepEqual(plain(applied.map(entry => entry.action.payload.pack.unitCode)), ['HU-NEW777']);
  assert.ok((await h.api.readCachedLoad()).units.some(u => u.code === 'HU-NEW777'));
});

test('a download that outlives a project switch writes nothing under the new project', async () => {
  const h = setup({ tables, onWrite: async (key, auth) => { if (/load_units_0$/.test(key)) auth.activeProject = { id: 'project-b', status: 'active' }; } });
  await assert.rejects(() => h.api.refreshLoad(), /Project changed/);
  assert.deepEqual([...h.records.keys()].filter(key => key.includes('project-b')), []);
});
