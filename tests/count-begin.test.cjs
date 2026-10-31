const test = require('node:test');
const assert = require('node:assert/strict');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const downloaded = {
  categories: [{ id: 'valve', parent_id: null, name: 'Valves', status: 'active', sort_order: 0 }], items: [], images: {}, savedAt: '2026-10-28T09:00:00Z',
  maps: [{ id: 'map-a', name: 'Yard', storage_path: null, image_width: 2000, image_height: 1000, updated_at: null }],
  zones: [
    { id: 'rack2', map_id: 'map-a', parent_id: null, name: 'Rack 2', shape: rect(0.2, 0.1, 0.3, 0.4), color: null, sort_order: 0, is_active: true, location_id: null },
    { id: 'old', map_id: 'map-a', parent_id: null, name: 'Old bay', shape: rect(0.5, 0.1, 0.6, 0.4), color: null, sort_order: 0, is_active: false, location_id: null },
  ],
};

function setup({ record = null, material = null, online = true, switchDuringLookup = false, kept = { siteMapId: null, pin: null, zoneId: null, zoneName: '' }, reference: given, server = null, copy = null } = {}) {
  const started = [];
  const auth = { user: { id: 'worker-a' }, activeProject: { id: 'project-a' } };
  const { beginCount } = createModuleLoader({ stubs: {
    '@/stores/authStore': { useAuthStore: { getState: () => auth } },
    '@/stores/countStore': { useCountStore: { getState: () => ({ location: kept, start: (tag, prefill) => started.push({ tag, prefill: JSON.parse(JSON.stringify(prefill)) }) }) } },
    '@/lib/sync/networkStore': { useNetworkStore: { getState: () => ({ isOnline: online }) } },
    '@/lib/api/inventory': {
      findInventoryByTag: async () => { if (switchDuringLookup) auth.activeProject = { id: 'project-b' }; return record; },
      withTimeout: (work) => work,
    },
    '@/lib/api/qrcodes': { lookupMaterialByQR: async () => material },
    // lookup_tag unavailable (offline or before 022) unless a test gives the server's answer.
    '@/lib/api/tags': { lookupTag: async () => server },
    // The device's copy of crates and loads, read when the server doesn't answer.
    '@/lib/api/logistics': { readCachedLoad: async () => copy ?? { units: [], items: [], places: [], materials: [], counted: [], loads: [], stops: [], lines: [], companies: [], savedAt: null } },
  } }).load('./components/inventory/beginCount.ts');
  const reference = given ?? { categories: [{ id: 'valve', parent_id: null, name: 'Valves', status: 'active', sort_order: 0 }], maps: [], zones: [], items: [], images: {}, savedAt: null };
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
  assert.deepEqual(fresh.started[0].prefill, { match: null, location: null }, 'nothing kept to drop: the last location carries over');
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

test('a kept location the office retired is not carried into the next count', async () => {
  const keepUsable = setup({ reference: downloaded, kept: { siteMapId: 'map-a', pin: null, zoneId: 'rack2', zoneName: 'Rack 2' } });
  await keepUsable.start('NEW-1');
  assert.equal(keepUsable.started[0].prefill.location, null, 'a usable kept area carries over');
  const h = setup({ reference: downloaded, kept: { siteMapId: 'map-a', pin: null, zoneId: 'old', zoneName: 'Old bay' } });
  await h.start('NEW-2');
  assert.deepEqual(h.started[0].prefill.location, { siteMapId: null, pin: null, zoneId: null, zoneName: '' }, 'a retired area is dropped');
});

test('a location on a plan or area missing from the copy is kept: it may be newer than the download', async () => {
  // The device downloaded map-a; the office has since added map-new with Bay 9.
  const kept = setup({ reference: downloaded, kept: { siteMapId: 'map-new', pin: { x: 0.1, y: 0.1 }, zoneId: null, zoneName: '' } });
  await kept.start('NEW-1');
  assert.equal(kept.started[0].prefill.location, null, 'the kept pin on the newer plan carries over');
  const recorded = { ...expected, count_status: 'counted', site_map_id: 'map-new', zone_id: 'bay9', location: 'Bay 9' };
  const own = setup({ record: recorded, reference: downloaded });
  await own.start('T-1');
  assert.equal(own.started[0].prefill.location.siteMapId, 'map-new', 'the record\'s own newer plan is used, not called retired');
  assert.equal(own.started[0].prefill.location.zoneId, 'bay9');
});

test('a record\'s own location on a retired plan or area gives way to the kept one', async () => {
  const onRetired = { ...expected, count_status: 'counted', site_map_id: 'map-a', zone_id: 'old', location: 'Old bay' };
  const h = setup({ record: onRetired, reference: downloaded, kept: { siteMapId: 'map-a', pin: null, zoneId: 'rack2', zoneName: 'Rack 2' } });
  await h.start('T-1');
  assert.equal(h.started[0].prefill.location, null, 'falls back to the usable kept area');
  const own = setup({ record: { ...onRetired, zone_id: 'rack2' }, reference: downloaded });
  await own.start('T-1');
  assert.equal(own.started[0].prefill.location.zoneId, 'rack2', 'a usable recorded area is used');
});

test('022: crate labels, and items packed in a crate, on a truck or written off, aren’t counted; the server says which through lookup_tag', async () => {
  assert.match((await setup().start('hu-aaaa01')).message, /HU- codes are crate labels; count the items inside the crate/);
  const packed = setup({ record: expected, server: { kind: 'counted', code: 'T-1', can_receive: true, position: 'in_crate', crate_code: 'HU-AAAA01' } });
  assert.match((await packed.start('T-1')).message, /packed in HU-AAAA01; take it out of the crate before counting it/);
  assert.equal(packed.started.length, 0);
  const travelling = setup({ record: expected, server: { kind: 'counted', code: 'T-1', can_receive: false, position: 'on_load', load_number: 'L-0003' } });
  assert.match((await travelling.start('T-1')).message, /on load L-0003; count it when it comes off/);
  const gone = setup({ server: { kind: 'written_off', code: 'T-1', can_receive: false } });
  assert.match((await gone.start('T-1')).message, /written off on a load/);
  const loose = setup({ record: expected, server: { kind: 'expected', code: 'T-1', can_receive: true, position: 'unknown' } });
  assert.equal((await loose.start('t-1')).started, true);
  assert.equal(loose.started[0].tag, 'T-1', 'a tag already counted keeps its spelling');
});

test('022: offline, the device’s copy keeps a packed or travelling item from being counted', async () => {
  const copy = (extra) => ({ units: [], items: [], places: [], materials: [], counted: [], loads: [], stops: [], lines: [], companies: [], savedAt: 'x', ...extra });
  const packed = setup({ online: false, record: expected, copy: copy({ items: [{ unit_code: 'HU-AAAA01', tag: 'T-1', name: 'Cooler', quantity: 1, uom: 'EA', material_id: null, inventory_uid: 'u' }] }) });
  assert.match((await packed.start('T-1')).message, /T-1 is packed in HU-AAAA01; take it out of the crate before counting it/);
  const travelling = setup({ online: false, record: expected, copy: copy({ lines: [{ id: 'l', load_id: 'load-a', load_number: 'L-0003', tag: 'T-1', status: 'on_board' }] }) });
  assert.match((await travelling.start('T-1')).message, /on load L-0003; count it when it comes off/);
  const planned = setup({ online: false, record: expected, copy: copy({ lines: [{ id: 'l', load_id: 'load-a', load_number: 'L-0003', tag: 'T-1', status: 'planned' }] }) });
  assert.equal((await planned.start('T-1')).started, true, 'planned on a load that hasn’t left: still counted where it is');
});
