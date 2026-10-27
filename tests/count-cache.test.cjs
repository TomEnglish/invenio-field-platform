const test = require('node:test');
const assert = require('node:assert/strict');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

const plain = (value) => JSON.parse(JSON.stringify(value));
const item = (qr_code, count_status, extra = {}) => ({
  id: 1, uid: `uid-${qr_code}`, qr_code, inventory_item: `Item ${qr_code}`, item_description: null, part_number: null, quantity: 1, uom: 'EA',
  condition: null, count_status, category_id: null, site_map_id: null, pin_x: null, pin_y: null, zone_id: null, location: null, counted_at: null, ...extra,
});

function setup({ tables = {}, online = true, failQueries = false, platform = 'ios', onQuery } = {}) {
  const records = new Map();
  const files = new Map();
  const calls = { queries: [], signed: [], downloads: [] };
  const auth = { user: { id: 'worker-a' }, session: { access_token: 'test' }, activeProject: { id: 'project-a', status: 'active' } };
  const network = { isOnline: online };
  const query = (table) => {
    const state = { table, filters: [] };
    const builder = {
      neq: (column, value) => { state.filters.push(['neq', column, value]); return builder; },
      eq: (column, value) => { state.filters.push(['eq', column, value]); return builder; },
      order: () => builder,
      limit: () => builder.range(0, 0),
      range: async (from, to) => {
        calls.queries.push(state);
        if (onQuery) await onQuery(state, auth);
        if (failQueries) return { data: null, error: { message: 'column inventory_records.uid does not exist' } };
        let rows = tables[table] ?? [];
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
    '@/lib/supabaseProject': { getProjectClient: () => ({ from: (table) => ({ select: () => query(table) }) }) },
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
    { id: 'zone-b', map_id: 'map-a', name: 'Zone B', shape: [[0, 0], [1, 0], [1, 1]], color: '#22AA44', sort_order: 0 },
    { id: 'zone-old', map_id: 'map-old', name: 'Old zone', shape: [[0, 0], [1, 0], [1, 1]], color: null, sort_order: 0 },
  ],
  inventory_records: [item('T-1', 'expected'), item('T-2', 'counted', { zone_id: 'zone-b', location: 'Zone B' })],
};

test('Count data and the site-plan image are saved per account and project for offline use', async () => {
  const h = setup({ tables });
  const result = await h.api.loadCountReference();
  assert.equal(result.source, 'online');
  assert.deepEqual(plain(result.data.maps.map(m => m.id)), ['map-a'], 'inactive plans are left out');
  assert.deepEqual(plain(result.data.zones.map(z => z.id)), ['zone-b']);
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
  assert.equal(await h.api.zoneNameFor({ zone_id: 'zone-b', location: null }), 'Zone B');
  assert.equal(await h.api.zoneNameFor({ zone_id: null, location: ' Legacy rack ' }), 'Legacy rack');

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
