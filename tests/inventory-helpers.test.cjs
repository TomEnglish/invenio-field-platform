const test = require('node:test');
const assert = require('node:assert/strict');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

// Modules run in their own VM realm; compare plain copies of their results.
const plain = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const same = (actual, expected, message) => assert.deepEqual(plain(actual), expected, message);

const loader = createModuleLoader();
const tree = loader.load('./lib/inventory/categories.ts');
const map = loader.load('./lib/inventory/siteMap.ts');
const count = loader.load('./lib/inventory/count.ts');

const category = (id, parent_id, name, extra = {}) => ({ id, parent_id, name, status: 'active', sort_order: 0, ...extra });
const categories = [
  category('gen1', null, 'Generator 1'),
  category('gen2', null, 'Generator 2', { sort_order: 1 }),
  category('oil', 'gen1', 'Oil System'),
  category('valve', 'oil', 'Control Valve'),
  category('pump', 'oil', 'Lube Pump', { status: 'proposed' }),
  category('old', 'gen1', 'Old Stuff', { status: 'archived' }),
  category('orphan', 'missing-parent', 'Spare Parts'),
  category('gen2oil', 'gen2', 'Oil System'),
];

test('the category tree hides archived rows, sorts siblings and lifts orphans to the top level', () => {
  const built = tree.buildCategoryTree(categories);
  same(tree.childCategories(built, null).map(c => c.id), ['gen1', 'orphan', 'gen2']);
  same(tree.childCategories(built, 'gen1').map(c => c.id), ['oil']);
  same(tree.childCategories(built, 'oil').map(c => c.name), ['Control Valve', 'Lube Pump']);
  assert.equal(built.byId.has('old'), false);
  assert.equal(tree.hasChildren(built, 'oil'), true);
  assert.equal(tree.hasChildren(built, 'valve'), false);
});

test('breadcrumbs run root-first and survive a loop in bad data', () => {
  const built = tree.buildCategoryTree(categories);
  same(tree.categoryPath(built, 'valve').map(c => c.name), ['Generator 1', 'Oil System', 'Control Valve']);
  assert.equal(tree.categoryPathLabel(built, 'valve'), 'Generator 1 › Oil System › Control Valve');
  same(tree.categoryPath(built, null), []);
  const looped = tree.buildCategoryTree([category('a', 'b', 'A'), category('b', 'a', 'B')]);
  assert.ok(tree.categoryPath(looped, 'a').length <= 2);
});

test('search matches every word across the whole path and ranks the category name first', () => {
  const built = tree.buildCategoryTree(categories);
  const results = tree.searchCategories(built, 'gen 1 valve');
  same(results.map(r => r.category.id), ['valve']);
  assert.equal(results[0].path, 'Generator 1 › Oil System › Control Valve');
  const oil = tree.searchCategories(built, 'oil');
  same(oil.slice(0, 2).map(r => r.category.id).sort(), ['gen2oil', 'oil']);
  assert.ok(oil.findIndex(r => r.category.id === 'valve') > 1, 'children of a matching branch rank after the branch');
  same(tree.searchCategories(built, '   '), []);
  assert.equal(tree.searchCategories(built, 'OLD').length, 0, 'archived categories are not searchable');
});

test('a proposal matching an existing sibling, ignoring case and spacing, is found', () => {
  const built = tree.buildCategoryTree(categories);
  assert.equal(tree.findSibling(built, 'oil', '  control   VALVE ')?.id, 'valve');
  assert.equal(tree.findSibling(built, 'gen2', 'control valve'), undefined);
});

const square = [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5], [0.1, 0.5]];
const bay = [[0.2, 0.2], [0.3, 0.2], [0.3, 0.3], [0.2, 0.3]];
const ell = [[0.6, 0.6], [0.9, 0.6], [0.9, 0.7], [0.7, 0.7], [0.7, 0.9], [0.6, 0.9]];

test('point in polygon handles convex and concave zones', () => {
  assert.equal(map.pointInPolygon({ x: 0.3, y: 0.3 }, square), true);
  assert.equal(map.pointInPolygon({ x: 0.6, y: 0.3 }, square), false);
  assert.equal(map.pointInPolygon({ x: 0.65, y: 0.85 }, ell), true);
  assert.equal(map.pointInPolygon({ x: 0.8, y: 0.8 }, ell), false, 'the notch of the L is outside');
  assert.equal(map.pointInPolygon({ x: 0.5, y: 0.5 }, [[0, 0], [1, 1]]), false);
});

test('the smallest zone under the pin wins', () => {
  const zones = [{ id: 'yard', shape: square }, { id: 'bay', shape: bay }, { id: 'ell', shape: ell }];
  assert.equal(map.zoneAt(zones, { x: 0.25, y: 0.25 }).id, 'bay');
  assert.equal(map.zoneAt(zones, { x: 0.4, y: 0.4 }).id, 'yard');
  assert.equal(map.zoneAt(zones, { x: 0.95, y: 0.05 }), null);
  assert.ok(Math.abs(map.polygonArea(square) - 0.16) < 1e-9);
});

const image = { width: 2000, height: 1000 };
const frame = { width: 400, height: 400 };

test('the plan fits the frame, taps convert to normalised pins and back', () => {
  same(map.fitContain(image, frame), { width: 400, height: 200 });
  const view = map.centredView(image, frame);
  same(view, { scale: 1, x: 0, y: 100 });
  same(map.screenToPin({ x: 200, y: 200 }, view, image, frame), { x: 0.5, y: 0.5 });
  assert.equal(map.screenToPin({ x: 200, y: 50 }, view, image, frame), null, 'a tap above the image places nothing');
  const zoomed = { scale: 4, x: -600, y: -200 };
  const pin = map.screenToPin({ x: 123, y: 321 }, zoomed, image, frame);
  const back = map.pinToScreen(pin, zoomed, image, frame);
  assert.ok(Math.abs(back.x - 123) < 0.01 && Math.abs(back.y - 321) < 0.01);
  same(map.roundPin({ x: 0.1234567891, y: 1.2 }), { x: 0.123457, y: 1 });
});

test('zooming keeps the point under the fingers and the image stays on screen', () => {
  const start = map.centredView(image, frame);
  const focus = { x: 300, y: 150 };
  const before = map.screenToPin(focus, start, image, frame);
  const zoomed = map.zoomAt(start, 3, focus, image, frame);
  assert.equal(zoomed.scale, 3);
  const after = map.screenToPin(focus, zoomed, image, frame);
  assert.ok(Math.abs(after.x - before.x) < 1e-5 && Math.abs(after.y - before.y) < 1e-5);
  assert.equal(map.zoomAt(start, 50, focus, image, frame).scale, map.MAX_ZOOM);
  same(map.zoomAt(zoomed, 0.2, focus, image, frame), plain(start), 'zooming out past 1 recentres');
  const panned = map.panBy(zoomed, 10000, 10000, image, frame);
  same({ x: panned.x, y: panned.y }, { x: 0, y: 0 }, 'no gap at the top-left edge');
  const far = map.panBy(zoomed, -10000, -10000, image, frame);
  same({ x: far.x, y: far.y }, { x: 400 - 1200, y: 400 - 600 });
  assert.equal(map.clampView({ scale: 1, x: 999, y: -999 }, image, frame).y, 100, 'a short image stays centred vertically');
});

test('zone outlines scale with the displayed image', () => {
  assert.equal(map.polygonPoints([[0, 0], [0.5, 0.25], [1, 1]], { width: 200, height: 100 }), '0.0,0.0 100.0,25.0 200.0,100.0');
  assert.equal(map.isValidPin({ x: 0, y: 1 }), true);
  assert.equal(map.isValidPin({ x: -0.1, y: 0.5 }), false);
  assert.equal(map.isValidPin({ x: '0.5', y: 0.5 }), false);
});

test('quantities follow the server rule: up to 9 digits and 3 decimals, above zero', () => {
  assert.equal(count.normaliseQuantity(' 12 '), '12');
  assert.equal(count.normaliseQuantity('1.5'), '1.5');
  assert.equal(count.normaliseQuantity('.25'), '0.25');
  assert.equal(count.normaliseQuantity('4.'), '4');
  assert.equal(count.normaliseQuantity('1,5'), '1.5', 'comma-decimal keypads');
  for (const bad of ['0', '0.000', '-1', '1.2345', '1,5.5', '1,2,3', 'abc', '', '1234567890']) assert.equal(count.normaliseQuantity(bad), null, bad);
});

const items = [
  { qr_code: 'T-1', inventory_item: 'Cooler', part_number: 'P-9', count_status: 'expected', counted_at: null },
  { qr_code: 'T-2 ', inventory_item: 'Valve', part_number: null, count_status: 'expected', counted_at: null },
  { qr_code: 'T-10', inventory_item: 'Pump', part_number: null, count_status: 'counted', counted_at: '2026-10-20T10:00:00Z' },
  { qr_code: 'T-3', inventory_item: 'Motor', part_number: null, count_status: 'received', counted_at: '2026-10-21T10:00:00Z' },
];

test('progress counts tags saved on the device, including new ones, as counted', () => {
  same(count.countProgress(items), { expected: 2, counted: 1, received: 1, total: 4, found: 2 });
  same(count.countProgress(items, ['T-2', 'NEW-1']), { expected: 1, counted: 3, received: 1, total: 5, found: 4 });
  same(count.countProgress(items, ['T-10']), { expected: 2, counted: 1, received: 1, total: 4, found: 2 }, 'a re-count is not double counted');
});

test('the outstanding list excludes found and pending tags and searches tag, name and part', () => {
  same(count.outstandingTags(items).map(i => i.qr_code), ['T-1', 'T-2 ']);
  same(count.outstandingTags(items, ['T-2']).map(i => i.qr_code), ['T-1']);
  same(count.outstandingTags(items, [], 'p-9').map(i => i.qr_code), ['T-1']);
  same(count.outstandingTags(items, [], 'valve').map(i => i.qr_code), ['T-2 ']);
  same(count.recentCounts(items).map(i => i.qr_code), ['T-3', 'T-10']);
  assert.equal(count.findItemByTag(items, ' T-2').inventory_item, 'Valve', 'tags match trimmed');
  assert.equal(count.findItemByTag(items, 't-1'), undefined, 'tags are case-sensitive');
});

test('receiving from a count pre-fills description, whole-number quantity and part number as spec', () => {
  same(count.receivingPrefill({ inventory_item: 'Lube oil cooler', item_description: 'Shell and tube', quantity: '3.000', part_number: ' LOC-22 ' }),
    { material_type: '', qty: 3, description: 'Lube oil cooler — Shell and tube', spec: 'LOC-22' });
  const fractional = count.receivingPrefill({ inventory_item: 'Cable', item_description: 'Cable', quantity: 12.5, part_number: null });
  assert.equal(fractional.qty, 1, 'a fractional count leaves the default quantity');
  assert.equal(fractional.description, 'Cable', 'a repeated description is not doubled');
  assert.equal(fractional.spec, undefined);
});

test('the counted banner reads like "Counted Oct 30 in Zone B"', () => {
  const local = new Date(2026, 9, 30, 9, 15).toISOString();
  assert.equal(count.countedBannerText(local, 'Zone B'), 'Counted Oct 30 in Zone B');
  assert.equal(count.countedBannerText(local, ''), 'Counted Oct 30');
  assert.equal(count.countedBannerText(null, null), 'Counted');
});

test('a matched record pre-fills the draft; an expected one keeps the last location', () => {
  const record = {
    id: 1, uid: 'u', qr_code: 'T-1', inventory_item: 'Cooler', item_description: null, part_number: 'P-9', quantity: '2.000',
    uom: 'SET', condition: null, count_status: 'expected', category_id: 'valve', site_map_id: null, pin_x: null, pin_y: null,
    zone_id: null, location: null, counted_at: null,
  };
  const prefill = count.countStartPrefill(record, categories);
  same(prefill.match, { status: 'expected', name: 'Cooler', countedAt: null });
  same(prefill.item, { name: 'Cooler', description: '', partNumber: 'P-9', quantity: '2', uom: 'SET', condition: 'good' });
  assert.equal(prefill.category.label, 'Generator 1 › Oil System › Control Valve');
  assert.equal(prefill.location, null);
  const counted = count.countStartPrefill({ ...record, count_status: 'counted', site_map_id: 'm', pin_x: '0.25', pin_y: '0.5', zone_id: 'z', counted_at: '2026-10-20T10:00:00Z' }, categories, [{ id: 'z', name: 'Zone B' }]);
  assert.equal(counted.match.status, 'counted');
  same(counted.location, { siteMapId: 'm', pin: { x: 0.25, y: 0.5 }, zoneId: 'z', zoneName: 'Zone B' });
  same(count.countStartPrefill(null), { match: null });
});
