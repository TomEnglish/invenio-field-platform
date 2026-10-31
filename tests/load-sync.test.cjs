const test = require('node:test');
const assert = require('node:assert/strict');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

// The real crate/load cache, offline queue, sync manager and licence upload.
// Only storage, files, the network flag and Supabase are faked.
const plain = (value) => JSON.parse(JSON.stringify(value));
const OP = (n) => `40000000-0000-4000-8000-00000000000${n}`;
const NUMBER = 'TX 98765-432';

function setup({ tables = {}, online = true, rpc, upload, before022 = false } = {}) {
  const records = new Map();
  const files = new Set(['file:///documents/receiving-photos/front.jpg', 'file:///documents/receiving-photos/back.jpg']);
  const calls = { rpc: [], uploads: [], deleted: [], queries: [] };
  const auth = { accessMode: 'online', loading: false, user: { id: 'worker-a' }, session: { access_token: 'test' }, activeProject: { id: 'project-a', status: 'active' } };
  const network = { isOnline: online };
  const flags = { before022 };
  const valueAt = (row, path) => path.split('.').reduce((value, key) => value?.[key], row);
  const matches = (row, expression) => expression.match(/[a-z_]+\.(?:in\.\([^)]*\)|[a-z]+\.[^,]+)/g).some(part => {
    const [, field, op, rest] = /^([a-z_]+)\.([a-z]+)\.?(.*)$/.exec(part);
    if (op === 'in') return rest.replace(/[()]/g, '').split(',').includes(row[field]);
    if (op === 'is') return row[field] === null;
    if (op === 'gte') return String(row[field]) >= rest;
    return row[field] === rest;
  });
  const query = (table, projectId, columns) => {
    const state = { table, columns, filters: [] };
    const filter = (op) => (column, value) => { state.filters.push([op, column, value]); return builder; };
    const builder = {
      eq: filter('eq'), gt: filter('gt'), in: filter('in'), or: (expression) => { state.filters.push(['or', expression]); return builder; },
      order: () => builder, limit: () => builder,
      then: (resolve, reject) => builder.range(0, 999).then(resolve, reject),
      range: async (from, to) => {
        calls.queries.push(state);
        if (flags.before022 && (/^load_/.test(table) || /top_status|load_line_status/.test(columns))) return { data: null, error: { code: '42703', message: /^load_/.test(table) ? `relation "public.${table}" does not exist` : 'column handling_unit_overview.top_status does not exist' } };
        let rows = (tables[table] ?? []).filter(row => !projectId || !('project_id' in row) || row.project_id === projectId);
        for (const [op, column, value] of state.filters) {
          rows = rows.filter(row => (op === 'or' ? matches(row, column) : op === 'eq' ? valueAt(row, column) === value : op === 'in' ? value.includes(valueAt(row, column)) : valueAt(row, column) > value));
        }
        return { data: rows.slice(from, to + 1), error: null };
      },
    };
    return builder;
  };
  const loader = createModuleLoader({ stubs: {
    'react-native': { Platform: { OS: 'ios' } },
    '@react-native-async-storage/async-storage': { getItem: async (k) => records.get(k) ?? null, setItem: async (k, v) => { records.set(k, v); } },
    '@/stores/authStore': { useAuthStore: { getState: () => auth, subscribe: () => () => {} } },
    '@/lib/sync/networkStore': { useNetworkStore: { getState: () => network, subscribe: () => () => {} } },
    'lib/sync/networkStore.ts': { useNetworkStore: { getState: () => network, subscribe: () => () => {} } },
    '@/lib/supabaseProject': { getProjectClient: () => { const projectId = auth.activeProject.id; return { projectId, from: (table) => ({ select: (columns) => query(table, projectId, columns) }) }; } },
    '@/lib/supabase': { supabase: {
      from: (table) => ({ select: (columns) => query(table, null, columns) }),
      rpc: async (name, args) => {
        calls.rpc.push({ name, args: plain(args), queue: records.get('offline_queue') });
        if (rpc) { const answer = await rpc(name, args); if (answer) return answer; }
        if (name === 'record_driver_licence') return { data: { load_id: args.p_load_id, recorded: true, last4: '-432' }, error: null };
        if (name === 'attach_driver_licence_photo') return { data: null, error: null };
        return { data: { load_id: args.p_payload.loadId, load_number: 'L-0004', status: 'planning' }, error: null };
      },
      storage: { from: (bucket) => ({ upload: async (path, bytes, options) => {
        calls.uploads.push({ bucket, path, options: plain(options), queue: records.get('offline_queue') });
        return upload ? upload(path) : { error: null };
      } }) },
    } },
    'expo-file-system': { File: class { constructor(uri) { this.uri = uri; } async arrayBuffer() { if (!files.has(this.uri)) throw new Error('missing file'); return new Uint8Array([1, 2]).buffer; } } },
    'expo-file-system/legacy': { deleteAsync: async (uri) => { calls.deleted.push(uri); files.delete(uri); } },
    'lib/api/receiving.ts': { submitReceivingRecord: async () => { throw new Error('unexpected receiving'); } },
    'lib/api/materials.ts': { transferMaterial: async () => {}, issueMaterial: async () => {} },
    'lib/api/shipments.ts': { createShipment: async () => {} },
    'lib/api/count.ts': { submitCount: async () => {} },
  } });
  return {
    api: loader.load('./lib/api/logistics.ts'), queue: loader.load('./lib/sync/offlineQueue.ts'), sync: loader.load('./lib/sync/syncManager.ts'),
    presentation: loader.load('./lib/sync/queuePresentation.ts'), records, files, calls, auth, network, flags,
  };
}
const storedEverywhere = (records) => [...records.values()].join('\n');

test('each load operation is queued and sent to apply_field_operation unchanged', async () => {
  const h = setup();
  const ops = [
    ['load_save', { loadId: 'load-n', originPlaceId: 'yard', stops: [{ id: 'stop-1', placeId: 'shop', kind: 'dropoff' }] }],
    ['load_on', { loadId: 'load-n', pieces: ['HU-AAAA01', { code: 'GT-1', dropoffStopId: 'stop-1' }], undo: ['PIPE-2'] }],
    ['load_depart', { loadId: 'load-n' }],
    ['load_off', { loadId: 'load-n', stopId: 'stop-1', pieces: ['HU-AAAA01'], zoneId: 'zone-1', siteMapId: 'map-a' }],
    ['stop_complete', { loadId: 'load-n', stopId: 'stop-1' }],
  ];
  for (const [i, [type, op]] of ops.entries()) await h.queue.addToQueue({ type, payload: { op, label: 'New load', ...(type === 'load_off' ? { zoneName: 'Bay 1' } : {}) } }, OP(i));
  const summaries = (await h.queue.getQueue()).map(item => h.presentation.queueSummary(item));
  assert.deepEqual(plain(summaries), [
    { title: 'New load', detail: 'Load details · 1 stop' }, { title: 'New load', detail: 'Loading · 2 on · 1 taken off' }, { title: 'New load', detail: 'Departure' },
    { title: 'New load', detail: 'Unloading · 1 off · Bay 1' }, { title: 'New load', detail: 'Stop finished' },
  ]);
  assert.deepEqual(plain(await h.sync.processQueue()), { processed: 5, failed: 0 });
  assert.deepEqual(h.calls.rpc.map(call => [call.name, call.args.p_operation_id, call.args.p_action, call.args.p_payload]), ops.map(([type, op], i) => ['apply_field_operation', OP(i), type, op]));
  assert.equal((await h.queue.getQueue()).length, 0);
});

test('the licence: recorded first, the number dropped from the queue at once, photos uploaded without upsert, then the files deleted', async () => {
  let failOnce = true;
  const h = setup({ upload: (path) => (path.endsWith('-1.jpg') && failOnce ? (failOnce = false, { error: { message: 'Network request failed' } }) : { error: null }) });
  const photos = [{ uri: 'file:///documents/receiving-photos/front.jpg' }, { uri: 'file:///documents/receiving-photos/back.jpg' }];
  await h.queue.addToQueue({ type: 'licence', payload: { loadId: 'load-n', label: 'L-0004', licence: { number: NUMBER, state: 'TX', expiry: '2028-02-29' }, photos } }, OP(7));
  const [saved] = await h.queue.getQueue();
  assert.deepEqual(plain(h.presentation.queueSummary(saved)), { title: 'L-0004', detail: 'Driver licence · Licence waiting to upload · 2 photos' });
  assert.equal(JSON.stringify(h.presentation.queueSummary(saved)).includes('98765'), false, 'Sync never shows the number');

  await h.sync.processQueue();
  const record = h.calls.rpc.find(call => call.name === 'record_driver_licence');
  assert.deepEqual(record.args, { p_operation_id: OP(7), p_load_id: 'load-n', p_licence: { number: NUMBER, state: 'TX', expiry: '2028-02-29' } });
  assert.equal(h.calls.rpc.some(call => call.name === 'apply_field_operation'), false, 'never through field_operations');
  assert.ok(h.calls.uploads.every(upload => !upload.queue.includes('98765')), 'the queue no longer holds the number when photos upload');
  assert.deepEqual(h.calls.uploads.map(u => [u.bucket, u.path, u.options.upsert]), [['driver-licences', `load-n/${OP(7)}-0.jpg`, false], ['driver-licences', `load-n/${OP(7)}-1.jpg`, false]]);
  const [waiting] = await h.queue.getQueue();
  assert.equal(waiting.action.payload.licence, null);
  assert.equal(waiting.action.payload.recorded, true);
  assert.match(waiting.lastError, /photo upload will retry/);
  assert.equal(h.presentation.queueSummary(waiting).detail, 'Driver licence · Licence on file; photos still to upload · 2 photos');
  assert.equal(h.presentation.crateRefused(waiting), false, 'a photo failure retries');
  assert.equal(h.files.size, 2, 'files kept until every photo is in');

  // The retry doesn't record again; an upload that already landed counts as done.
  const landed = setup({ upload: (path) => (path.endsWith('-0.jpg') ? { error: { message: 'The resource already exists', statusCode: '409' } } : { error: null }) });
  landed.records.set('offline_queue', h.records.get('offline_queue'));
  await landed.queue.retryQueueItem(OP(7));
  assert.deepEqual(plain(await landed.sync.processQueue()), { processed: 1, failed: 0 });
  assert.equal(landed.calls.rpc.some(call => call.name === 'record_driver_licence'), false);
  assert.deepEqual(landed.calls.rpc.filter(call => call.name === 'attach_driver_licence_photo').map(call => call.args), [{ p_load_id: 'load-n', p_path: `load-n/${OP(7)}-0.jpg` }, { p_load_id: 'load-n', p_path: `load-n/${OP(7)}-1.jpg` }]);
  assert.deepEqual(landed.calls.deleted, photos.map(p => p.uri), 'the photo files are deleted after sync');
  assert.equal((await landed.queue.getQueue()).length, 0);
  assert.equal(storedEverywhere(landed.records).includes('98765'), false, 'the number is in no local store after sync');
  assert.equal(storedEverywhere(h.records).includes('98765'), false);
});

test('licence and load refusals are named by the server’s wording; anything retries gave up on can be discarded', () => {
  const h = setup();
  const item = (type, lastError) => ({ id: 'x', userId: 'worker-a', projectId: 'project-a', lastError, action: { type, payload: { op: { loadId: 'l' }, label: 'L-0004', loadId: 'l', photos: [], licence: null } } });
  assert.equal(h.presentation.crateRefused(item('licence', 'Enter the licence number: 3 to 40 letters, numbers, spaces or dashes')), true);
  // Steps wait for the load's earlier ones, so a missing load was refused or access was lost.
  assert.equal(h.presentation.crateRefused(item('licence', "That load isn't in your projects")), true);
  assert.equal(h.presentation.crateRefused(item('load_on', "That load isn't in this project")), true);
  assert.equal(h.presentation.crateRefused(item('load_on', 'duplicate key value violates unique constraint "load_lines_open_item"')), true);
  assert.match(h.presentation.queueRecoveryMessage(item('licence', 'A load keeps at most 4 licence photos')), /already has 4 licence photos/);
  assert.equal(h.presentation.canDiscard({ ...item('licence', 'new row violates row-level security policy'), deadLetter: true }), true, 'a licence is never stuck on the device');
  assert.equal(h.presentation.canDiscard({ ...item('load_save', 'Unsupported operation'), deadLetter: true }), true);
  assert.equal(h.presentation.canDiscard(item('load_on', 'Network request failed')), false, 'still retrying');
  assert.match(h.presentation.queueRecoveryMessage(item('licence', 'Enter the licence number: 3 to 40 letters, numbers, spaces or dashes')), /record the licence again in Driver check-in/);
  for (const refusal of ["GT-1 is packed in HU-BOX001; load the crate instead", 'PIPE-3 is already on load L-0007', "Add the driver's name before load L-0004 leaves", 'Nothing is on the truck yet',
    "Areas can only be chosen at this project's own yard or site", 'Choose where GT-1 comes off', "HU-INNER1 is inside HU-BOX001; a crate travels with the crate it's in"]) {
    assert.equal(h.presentation.crateRefused(item('load_on', refusal)), true, refusal);
  }
  assert.equal(h.presentation.crateRefused(item('load_on', 'Network request failed')), false);
  assert.match(h.presentation.queueRecoveryMessage(item('load_depart', 'Nothing is on the truck yet')), /refused this load change: “Nothing is on the truck yet”/);
  assert.equal(h.presentation.crateRefused({ ...item('pack', 'HU-AAAA01 is on load L-0003; unload it first') }), true, '022 crate refusals too');
});

const row = (code, extra = {}) => ({
  id: `id-${code}`, project_id: 'project-a', code, kind: 'crate', description: null, is_high_value: false, status: 'sealed', parent_id: null, parent_code: null, top_code: code,
  place_id: 'yard', place_name: 'Training Yard', site_map_id: null, zone_id: null, location: null, item_count: 0, unit_count: 0, top_status: 'sealed', load_id: null, load_number: null, load_line_status: null, ...extra,
});
const loadRow = (id, status, updated_at, extra = {}) => ({ id, project_id: 'project-a', load_number: `L-${id}`, status, origin_place_id: 'yard', origin_name: 'Training Yard', updated_at, driver_name: null, licence_recorded_at: null, ...extra });
const tables = () => ({
  handling_unit_overview: [row('HU-AAAA01', { status: 'on_load', top_status: 'on_load', load_id: 'open', load_number: 'L-open', load_line_status: 'on_board' })],
  handling_unit_items: [], materials: [], inventory_records: [],
  places: [{ id: 'yard', kind: 'yard', name: 'Training Yard', project_id: 'project-a', city: null, state: null, is_active: true }],
  load_overview: [loadRow('open', 'in_transit', '2026-10-01T00:00:00Z'), loadRow('recent', 'delivered', new Date(Date.now() - 86400000).toISOString()), loadRow('old', 'closed', '2026-01-01T00:00:00Z'), loadRow('elsewhere', 'planning', '2026-10-30T00:00:00Z', { project_id: 'project-b' })],
  load_stop_overview: [{ id: 'stop-1', project_id: 'project-a', load_id: 'open', seq: 1, place_id: 'yard', place_name: 'Training Yard', kind: 'dropoff', status: 'pending' }, { id: 'stop-old', project_id: 'project-a', load_id: 'old', seq: 1, place_id: 'yard', place_name: 'Yard', kind: 'dropoff', status: 'done' }],
  load_line_overview: [
    { id: 'line-1', project_id: 'project-a', load_id: 'open', load_number: 'L-open', load_status: 'in_transit', tag: 'PIPE-1 ', status: 'on_board', dropoff_place: 'Gulf Machine', is_current_position: true, on_at: '2026-10-30T10:00:00Z', off_at: null },
    { id: 'line-2', project_id: 'project-a', load_id: 'recent', load_number: 'L-recent', load_status: 'delivered', tag: 'PIPE-5', status: 'delivered', delivered_place: 'North Site', is_current_position: true, on_at: '2026-10-29T10:00:00Z', off_at: '2026-10-30T09:00:00Z' },
  ],
  load_companies: [{ id: 'c-1', project_id: 'project-a', load_id: 'open', position: 1, name: 'Gulf Freight', role: 'carrier', contact_name: null, phone: null }],
});

test('open loads and those finished in the last 30 days are cached with their stops, lines and companies; crates carry their load', async () => {
  const h = setup({ tables: tables() });
  const { data, source } = await h.api.loadLoad();
  assert.equal(source, 'online');
  assert.deepEqual(plain(data.loads.map(l => l.id)).sort(), ['open', 'recent']);
  assert.deepEqual(plain(data.stops.map(s => s.id)), ['stop-1']);
  assert.deepEqual(plain(data.lines.map(l => l.tag)).sort(), ['PIPE-1', 'PIPE-5'], 'tags trimmed as the server trims them');
  assert.equal(data.companies[0].name, 'Gulf Freight');
  assert.equal(data.units[0].load_line_status, 'on_board');
  assert.ok(h.calls.queries.filter(q => q.table === 'load_line_overview').every(q => q.filters.some(f => f[0] === 'in' && f[1] === 'load_id')), 'lines are fetched by load');
  assert.ok([...h.records.keys()].every(key => key.startsWith('cache_worker-a_project-a_') || key === 'offline_queue'));
  h.network.isOnline = false;
  assert.deepEqual(plain((await h.api.loadLoad()).data.loads.map(l => l.id)).sort(), ['open', 'recent'], 'available offline');
  assert.deepEqual(plain(await h.api.itemOnLoadNow('PIPE-1', [])), { loadId: 'open', text: 'On load L-open (to Gulf Machine)' });
  assert.deepEqual(plain(await h.api.itemOnLoadNow('PIPE-5', [])), { loadId: 'recent', text: 'Delivered to North Site on L-recent' });
  // A change saved here is newer than the copy.
  const off = { type: 'load_off', payload: { op: { loadId: 'open', stopId: 'stop-1', pieces: ['PIPE-1'] }, label: 'L-open' } };
  assert.equal((await h.api.itemOnLoadNow('PIPE-1', [off])).text, 'Delivered to Training Yard on L-open');
});

test('before migration 022, crates still download and there are simply no loads', async () => {
  const h = setup({ tables: tables(), before022: true });
  const { data, source, error } = await h.api.loadLoad();
  assert.equal(source, 'online', error);
  assert.equal(data.units.length, 1);
  assert.deepEqual(plain(data.loads), []);
  assert.ok(h.calls.queries.some(q => q.table === 'handling_unit_overview' && !/top_status/.test(q.columns)), 'retried with the 021 columns');
});

test("a load's later steps wait when an earlier one fails, so the server never sees them out of order", async () => {
  let flaky = true;
  const h = setup({ rpc: (name, args) => (name === 'apply_field_operation' && args.p_operation_id === OP(1) && flaky ? { data: null, error: { message: 'Network request failed' } } : null) });
  const step = (n, type, op, loadId = 'load-n') => h.queue.addToQueue({ type, payload: { op: { loadId, ...op }, label: 'L-0004' } }, OP(n));
  await step(1, 'load_on', { pieces: ['HU-AAAA01'] });
  await step(2, 'load_on', { pieces: ['HU-BBBB02'] });
  await step(3, 'load_depart', {});
  await step(4, 'load_save', { notes: 'Other load' }, 'load-other');
  assert.deepEqual(plain(await h.sync.processQueue()), { processed: 1, failed: 1 });
  assert.deepEqual(h.calls.rpc.map(c => c.args.p_operation_id), [OP(1), OP(4)], 'the second batch and the departure wait; another load goes on');
  flaky = false;
  await h.sync.processQueue();
  assert.deepEqual(h.calls.rpc.map(c => c.args.p_operation_id).slice(2), [OP(1), OP(2), OP(3)], 'then in order');
  assert.equal((await h.queue.getQueue()).length, 0);
});

test("an item's position: the server's newer line beats an old one in the copy", async () => {
  const t = tables();
  t.load_line_overview.push({ id: 'line-old', project_id: 'project-a', load_id: 'recent', load_number: 'L-recent', load_status: 'delivered', tag: 'PIPE-7', status: 'delivered', delivered_place: 'North Site', is_current_position: true, on_at: '2026-10-20T10:00:00Z', off_at: '2026-10-21T10:00:00Z' });
  const h = setup({ tables: t });
  await h.api.loadLoad();
  t.load_line_overview = [{ id: 'line-new', project_id: 'project-a', load_id: 'open', load_number: 'L-open', load_status: 'in_transit', tag: 'PIPE-7', status: 'on_board', dropoff_place: 'Gulf Machine', is_current_position: true, on_at: '2026-10-30T10:00:00Z', off_at: null }];
  assert.equal((await h.api.itemOnLoadNow('PIPE-7', [])).text, 'On load L-open (to Gulf Machine)');
});

test('once 022 is deployed, the next download uses its columns again', async () => {
  const t = tables();
  const early = setup({ tables: t, before022: true });
  assert.deepEqual(plain((await early.api.loadLoad()).data.loads), []);
  early.flags.before022 = false;
  early.calls.queries.length = 0;
  const { data } = await early.api.loadLoad();
  assert.ok(early.calls.queries.some(q => q.table === 'handling_unit_overview' && /top_status/.test(q.columns)));
  assert.equal(data.loads.length, 2);
});
