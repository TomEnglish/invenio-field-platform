const test = require('node:test');
const assert = require('node:assert/strict');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

const plain = (value) => JSON.parse(JSON.stringify(value));
const item = (qr_code, count_status, extra = {}) => ({
  id: 1, uid: `uid-${qr_code}`, qr_code, inventory_item: `Item ${qr_code}`, item_description: null, part_number: null, quantity: 1, uom: 'EA',
  condition: null, count_status, category_id: null, site_map_id: null, pin_x: null, pin_y: null, zone_id: null, location: null, counted_at: null, ...extra,
});

function setup({ tables = {}, online = true, failQueries = false, platform = 'ios', onQuery, before020 = false } = {}) {
  const records = new Map();
  const files = new Map();
  const calls = { queries: [], signed: [], downloads: [], clients: 0 };
  const auth = { user: { id: 'worker-a' }, session: { access_token: 'test' }, activeProject: { id: 'project-a', status: 'active' } };
  const network = { isOnline: online };
  const query = (table, projectId, columns = '') => {
    const state = { table, projectId, columns, filters: [] };
    const builder = {
      neq: (column, value) => { state.filters.push(['neq', column, value]); return builder; },
      eq: (column, value) => { state.filters.push(['eq', column, value]); return builder; },
      order: () => builder,
      limit: () => builder.range(0, 0),
      // Supabase query builders can be awaited directly.
      then: (resolve, reject) => builder.range(0, 999).then(resolve, reject),
      range: async (from, to) => {
        calls.queries.push(state);
        if (onQuery) await onQuery(state, auth);
        if (failQueries) return { data: null, error: { message: 'column inventory_records.uid does not exist' } };
        // A database without migration 020 has no nesting columns.
        if (before020 && table === 'site_map_zones' && /parent_id|is_active/.test(state.columns)) return { data: null, error: { code: '42703', message: 'column site_map_zones.parent_id does not exist' } };
        let rows = (tables[table] ?? []).filter(row => !row.project_id || row.project_id === state.projectId);
        for (const [op, column, value] of state.filters) rows = rows.filter(row => (op === 'eq' ? row[column] === value : row[column] !== value));
        return { data: rows.slice(from, to + 1), error: null };
      },
    };
    return builder;
  };
  const loader = createModuleLoader({ stubs: {
    'react-native': { Platform: { OS: platform } },
    '@react-native-async-storage/async-storage': { getItem: async (k) => records.get(k) ?? null, setItem: async (k, v) => { records.set(k, v); } },
    '@/stores/authStore': { useAuthStore: { getState: () => auth } },
    '@/lib/sync/networkStore': { useNetworkStore: { getState: () => network } },
    // Like the real client, the project is fixed when the client is created.
    '@/lib/supabaseProject': { getProjectClient: () => { const projectId = auth.activeProject.id; calls.clients += 1; return { from: (table) => ({ select: (columns) => query(table, projectId, columns) }) }; } },
    '@/lib/supabase': { supabase: { storage: { from: (bucket) => ({ createSignedUrl: async (path) => { calls.signed.push([bucket, path]); return { data: { signedUrl: `https://signed.example/${path}` }, error: null }; } }) } } },
    'expo-file-system/legacy': {
      documentDirectory: 'file:///documents/',
      getInfoAsync: async (uri) => ({ exists: files.has(uri) }),
      makeDirectoryAsync: async () => {},
      downloadAsync: async (url, to) => { calls.downloads.push([url, to]); files.set(to, url); return { status: 200 }; },
      moveAsync: async ({ from, to }) => { files.set(to, files.get(from)); files.delete(from); },
      deleteAsync: async (uri) => { files.delete(uri); },
      readDirectoryAsync: async (dir) => [...files.keys()].filter(k => k.startsWith(dir)).map(k => k.slice(dir.length)),
    },
  } });
  return { api: loader.load('./lib/api/inventory.ts'), records, files, calls, auth, network };
}

const tables = {
  inventory_categories: [{ id: 'gen1', parent_id: null, name: 'Generator 1', status: 'active', sort_order: 0 }],
  site_maps: [
    { id: 'map-a', name: 'Yard', storage_path: 'project-a/map-a.png', image_width: 2000, image_height: 1000, updated_at: '2026-10-27T09:00:00Z', is_active: true },
    { id: 'map-old', name: 'Old', storage_path: null, image_width: null, image_height: null, updated_at: null, is_active: false },
  ],
  site_map_zones: [
    { id: 'zone-b', map_id: 'map-a', parent_id: null, name: 'Zone B', shape: [[0, 0], [1, 0], [1, 1]], color: '#22AA44', sort_order: 0, is_active: true, location_id: 'rack-b' },
    { id: 'zone-b2', map_id: 'map-a', parent_id: 'zone-b', name: 'Bay 2', shape: [[0.5, 0.1], [0.9, 0.1], [0.9, 0.5]], color: null, sort_order: 0, is_active: true, location_id: null },
    { id: 'zone-old', map_id: 'map-old', name: 'Old zone', shape: [[0, 0], [1, 0], [1, 1]], color: null, sort_order: 0 },
  ],
  inventory_records: [item('T-1', 'expected'), item('T-2', 'counted', { zone_id: 'zone-b', location: 'Zone B' })],
};

test('Count data and the site-plan image are saved per account and project for offline use', async () => {
  const h = setup({ tables });
  const result = await h.api.loadCountReference();
  assert.equal(result.source, 'online');
  assert.deepEqual(plain(result.data.maps.map(m => m.id)), ['map-a'], 'inactive plans are left out');
  assert.deepEqual(plain(result.data.zones.map(z => z.id)), ['zone-b', 'zone-b2']);
  assert.equal(result.data.zones[1].parent_id, 'zone-b', 'the cache keeps the area nesting');
  assert.ok(h.calls.queries.some(q => q.table === 'site_map_zones'));
  assert.equal(result.data.items.length, 2);
  assert.ok(h.calls.queries.some(q => q.table === 'inventory_categories' && q.filters.some(f => f[0] === 'neq' && f[2] === 'archived')));
  assert.deepEqual(h.calls.signed, [['site-plans', 'project-a/map-a.png']]);
  const image = result.data.images['map-a'];
  assert.equal(image, 'file:///documents/site-plans/project-a/map-a-20261027090000.png');
  assert.ok(h.files.has(image));
  assert.ok([...h.records.keys()].every(key => key.startsWith('cache_worker-a_project-a_')));

  h.network.isOnline = false;
  const offline = await h.api.loadCountReference();
  assert.equal(offline.source, 'cache');
  assert.equal(offline.data.items.length, 2);
  assert.equal(offline.data.images['map-a'], image);
  assert.ok(offline.data.savedAt);

  h.network.isOnline = true;
  await h.api.loadCountReference();
  assert.equal(h.calls.downloads.length, 1, 'an unchanged plan is not downloaded again');
});

test('a failed refresh (e.g. migration 019 not applied) falls back to the saved copy', async () => {
  const h = setup({ tables });
  await h.api.loadCountReference();
  const broken = setup({ tables, failQueries: true });
  for (const [key, value] of h.records) broken.records.set(key, value);
  const result = await broken.api.loadCountReference();
  assert.equal(result.source, 'cache');
  assert.match(result.error, /does not exist/);
  assert.equal(result.data.items.length, 2);
});

test('data loaded for one project is never saved under another', async () => {
  const h = setup({ tables, onQuery: async (state, auth) => { if (state.table === 'inventory_records') auth.activeProject = { id: 'project-b', status: 'active' }; } });
  const result = await h.api.loadCountReference();
  assert.equal(result.source, 'cache');
  assert.match(result.error, /Project changed/);
  assert.equal([...h.records.keys()].length, 0);
});

test('tag lookup asks the server online and the cache offline, and saved counts update the cache', async () => {
  const h = setup({ tables });
  await h.api.loadCountReference();
  assert.equal((await h.api.findInventoryByTag(' T-2 ')).count_status, 'counted');
  h.network.isOnline = false;
  assert.equal((await h.api.findInventoryByTag('T-1')).count_status, 'expected');
  assert.equal(await h.api.findInventoryByTag('NOPE'), null);
  assert.deepEqual(plain(await h.api.countedAreaInfo({ zone_id: 'zone-b2', site_map_id: 'map-a', location: null })), { path: 'Zone B › Bay 2', locationId: 'rack-b', locationLabel: 'Zone B' }, 'the nearest linked rack above the area, labelled with that area');
  assert.deepEqual(plain(await h.api.countedAreaInfo({ zone_id: null, site_map_id: null, location: ' Legacy rack ' })), { path: 'Legacy rack', locationId: null, locationLabel: null });

  await h.api.recordCountLocally({ tag: 'T-1', name: 'Cooler', quantity: '2', uom: 'EA', condition: 'good', categoryId: 'gen1', siteMapId: 'map-a', zoneId: 'zone-b', pin: { x: 0.5, y: 0.5 } }, 'Zone B');
  await h.api.recordCountLocally({ tag: 'NEW-1', name: 'Spare', quantity: '1', uom: 'EA', condition: 'good', categoryId: null, siteMapId: null, zoneId: null }, null);
  const cached = plain((await h.api.readCachedReference()).items);
  const t1 = cached.find(i => i.qr_code === 'T-1');
  assert.equal(t1.count_status, 'counted');
  assert.equal(t1.inventory_item, 'Cooler');
  assert.equal(t1.location, 'Zone B');
  assert.equal(t1.pin_x, 0.5);
  assert.equal(cached.find(i => i.qr_code === 'NEW-1').count_status, 'counted');
});

test('the web build shows plans from a signed URL instead of storing them', async () => {
  const h = setup({ tables, platform: 'web' });
  const result = await h.api.loadCountReference();
  assert.equal(result.data.images['map-a'], 'https://signed.example/project-a/map-a.png');
  assert.equal(h.calls.downloads.length, 0);
});

test('every page of a refresh comes from the project it started in, even across project switches', async () => {
  const many = Array.from({ length: 1500 }, (_, i) => item(`A-${i}`, 'expected', { project_id: 'project-a' }));
  const other = Array.from({ length: 1200 }, (_, i) => item(`B-${i}`, 'expected', { project_id: 'project-b' }));
  let pages = 0;
  const h = setup({ tables: { ...tables, inventory_records: [...many, ...other] }, onQuery: async (state, auth) => {
    if (state.table !== 'inventory_records') return;
    pages += 1;
    // Switch to B before the second page, and back to A before the refresh ends.
    auth.activeProject = { id: pages === 1 ? 'project-b' : 'project-a', status: 'active' };
  } });
  const result = await h.api.loadCountReference();
  assert.equal(result.source, 'online');
  assert.equal(pages, 2);
  const cached = (await h.api.readCachedReference()).items;
  assert.equal(cached.length, 1500);
  assert.ok(cached.every(row => row.qr_code.startsWith('A-')), 'no project B rows in project A\'s cache');
});

test('large tag lists are stored in chunks, and a download replaces counts recorded on the device', async () => {
  const many = Array.from({ length: 1234 }, (_, i) => item(`T-${i}`, 'expected'));
  const h = setup({ tables: { ...tables, inventory_records: many } });
  await h.api.loadCountReference();
  const chunkKeys = [...h.records.keys()].filter(key => /count_items_\d+$/.test(key));
  assert.equal(chunkKeys.length, 3);
  assert.ok(chunkKeys.every(key => h.records.get(key).length < 200000), 'each stored value stays small');
  const restored = (await h.api.readCachedReference()).items;
  assert.equal(restored.length, 1234);
  assert.equal(restored[0].pin_x, null, 'dropped nulls come back as null');

  const before = chunkKeys.map(key => h.records.get(key));
  await h.api.recordCountLocally({ tag: 'T-5', name: 'Found it', quantity: '1', uom: 'EA', condition: 'good', categoryId: null, siteMapId: null, zoneId: null }, null);
  assert.equal((await h.api.readCachedReference()).items.find(i => i.qr_code === 'T-5').count_status, 'counted');
  assert.deepEqual(chunkKeys.map(key => h.records.get(key)), before, 'a saved count does not rewrite the downloaded chunks');

  // The next download is authoritative; the shorter list also empties the old third chunk.
  h.network.isOnline = true;
  const fewer = setup({ tables: { ...tables, inventory_records: many.slice(0, 600) } });
  for (const [key, value] of h.records) fewer.records.set(key, value);
  await fewer.api.loadCountReference();
  const after = (await fewer.api.readCachedReference()).items;
  assert.equal(after.length, 600);
  assert.equal(after.find(i => i.qr_code === 'T-5').count_status, 'expected');
});

test('overlapping refreshes for the same project share one download', async () => {
  const h = setup({ tables });
  const [first, second] = await Promise.all([h.api.refreshCountReference(), h.api.refreshCountReference()]);
  assert.equal(first, second);
  assert.equal(h.calls.clients, 1);
  assert.equal(h.calls.downloads.length, 1);
});

test('a slow server answer falls back to the cached tag', async () => {
  const { api } = setup();
  await assert.rejects(api.withTimeout(new Promise(() => {}), 10), /too long/);
  assert.equal(await api.withTimeout(Promise.resolve(7), 10), 7);
});

test('zones cached by build 5 (before nesting) read back as active top-level areas', async () => {
  const h = setup({ tables });
  h.records.set('cache_worker-a_project-a_count_site_map_zones', JSON.stringify({ data: [{ id: 'old', map_id: 'map-a', name: 'Old zone', shape: [[0, 0], [1, 0], [1, 1]], color: null, sort_order: 0 }], timestamp: 0 }));
  h.network.isOnline = false;
  const [zone] = (await h.api.readCachedReference()).zones;
  assert.deepEqual(plain({ parent_id: zone.parent_id, is_active: zone.is_active, location_id: zone.location_id }), { parent_id: null, is_active: true, location_id: null });
});

test('the hand-off asks the server for a plan\'s areas the device has not saved', async () => {
  const h = setup({ tables });
  const info = await h.api.countedAreaInfo({ zone_id: 'zone-b2', site_map_id: 'map-a', location: 'Zone B › Bay 2' });
  assert.deepEqual(plain(info), { path: 'Zone B › Bay 2', locationId: 'rack-b', locationLabel: 'Zone B' });
  assert.ok(h.calls.queries.some(q => q.table === 'site_map_zones' && q.filters.some(f => f[1] === 'map_id' && f[2] === 'map-a')));
  h.network.isOnline = false;
  const offline = setup({ tables, online: false });
  assert.deepEqual(plain(await offline.api.countedAreaInfo({ zone_id: 'zone-b2', site_map_id: 'map-a', location: 'Zone B › Bay 2' })), { path: 'Zone B › Bay 2', locationId: null, locationLabel: null }, 'offline with no saved areas, the stored path is shown');
});

test('a build 5 copy of the areas (no nesting or rack links) is not trusted for the hand-off', async () => {
  const flatCache = JSON.stringify({ data: [
    { id: 'zone-b', map_id: 'map-a', name: 'Zone B', shape: [[0, 0], [1, 0], [1, 1]], color: null, sort_order: 0 },
    { id: 'zone-b2', map_id: 'map-a', name: 'Bay 2', shape: [[0.5, 0.1], [0.9, 0.1], [0.9, 0.5]], color: null, sort_order: 0 },
  ], timestamp: 0 });
  const online = setup({ tables });
  online.records.set('cache_worker-a_project-a_count_site_map_zones', flatCache);
  assert.deepEqual(plain(await online.api.countedAreaInfo({ zone_id: 'zone-b2', site_map_id: 'map-a', location: 'Zone B › Bay 2' })), { path: 'Zone B › Bay 2', locationId: 'rack-b', locationLabel: 'Zone B' }, 'online, the server\'s areas are used');
  const offline = setup({ tables, online: false });
  offline.records.set('cache_worker-a_project-a_count_site_map_zones', flatCache);
  assert.deepEqual(plain(await offline.api.countedAreaInfo({ zone_id: 'zone-b2', site_map_id: 'map-a', location: 'Zone B › Bay 2' })), { path: 'Zone B › Bay 2', locationId: null, locationLabel: null }, 'offline, the stored path rather than the flat name');
});

test('before migration 020 (or after a rollback) areas still download, as top-level areas in use', async () => {
  const flat = { ...tables, site_map_zones: tables.site_map_zones.map(({ parent_id, is_active, ...zone }) => zone) };
  const h = setup({ tables: flat, before020: true });
  const result = await h.api.loadCountReference();
  assert.equal(result.source, 'online', 'the Count download does not fail');
  assert.equal(result.error, undefined);
  assert.deepEqual(plain(result.data.zones.map(z => [z.id, z.parent_id, z.is_active])), [['zone-b', null, true], ['zone-b2', null, true]]);
  assert.equal(result.data.items.length, 2);
  const info = await setup({ tables: flat, before020: true }).api.countedAreaInfo({ zone_id: 'zone-b', site_map_id: 'map-a', location: 'Zone B' });
  assert.deepEqual(plain(info), { path: 'Zone B', locationId: 'rack-b', locationLabel: 'Zone B' }, 'the hand-off falls back the same way');
});
