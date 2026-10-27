const test = require('node:test');
const assert = require('node:assert/strict');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

function setup({ record = null, material = null, online = true, switchDuringLookup = false } = {}) {
  const started = [];
  const auth = { user: { id: 'worker-a' }, activeProject: { id: 'project-a' } };
  const { beginCount } = createModuleLoader({ stubs: {
    '@/stores/authStore': { useAuthStore: { getState: () => auth } },
    '@/stores/countStore': { useCountStore: { getState: () => ({ start: (tag, prefill) => started.push({ tag, prefill: JSON.parse(JSON.stringify(prefill)) }) }) } },
    '@/lib/sync/networkStore': { useNetworkStore: { getState: () => ({ isOnline: online }) } },
    '@/lib/api/inventory': { findInventoryByTag: async () => { if (switchDuringLookup) auth.activeProject = { id: 'project-b' }; return record; } },
    '@/lib/api/qrcodes': { lookupMaterialByQR: async () => material },
  } }).load('./components/inventory/beginCount.ts');
  const reference = { categories: [{ id: 'valve', parent_id: null, name: 'Valves', status: 'active', sort_order: 0 }], maps: [], zones: [], items: [], images: {}, savedAt: null };
  return { start: (code) => beginCount(code, reference), started };
}

const expected = {
  id: 7, uid: 'u', qr_code: 'T-1', inventory_item: 'Cooler', item_description: null, part_number: 'P-9', quantity: 1, uom: 'EA',
  condition: null, count_status: 'expected', category_id: 'valve', site_map_id: null, pin_x: null, pin_y: null, zone_id: null, location: null, counted_at: null,
};

test('an expected tag starts a pre-filled count; an unknown tag starts as new', async () => {
  const h = setup({ record: expected });
  assert.equal((await h.start(' T-1 ')).started, true);
  assert.equal(h.started[0].tag, 'T-1');
  assert.equal(h.started[0].prefill.item.partNumber, 'P-9');
  assert.equal(h.started[0].prefill.category.label, 'Valves');
  const fresh = setup();
  assert.equal((await fresh.start('NEW-1')).started, true);
  assert.deepEqual(fresh.started[0].prefill, { match: null });
});

test('received tags, including materials received before counting, are refused', async () => {
  const received = setup({ record: { ...expected, count_status: 'received' } });
  const result = await received.start('T-1');
  assert.equal(result.started, false);
  assert.match(result.message, /already been received/);
  const material = setup({ material: { materialId: 'm-1' } });
  assert.equal((await material.start('OLD-QR')).started, false);
  assert.equal(material.started.length, 0);
  const offline = setup({ material: { materialId: 'm-1' }, online: false });
  assert.equal((await offline.start('OLD-QR')).started, true, 'offline, only the cached count status can be checked');
});

test('a project switch during the lookup does not start a count in the new project', async () => {
  const h = setup({ record: expected, switchDuringLookup: true });
  const result = await h.start('T-1');
  assert.equal(result.started, false);
  assert.equal(h.started.length, 0);
});

test('blank and oversized codes are refused before any lookup', async () => {
  const h = setup();
  assert.equal((await h.start('   ')).started, false);
  assert.equal((await h.start('x'.repeat(121))).started, false);
  assert.equal(h.started.length, 0);
});
