const test = require('node:test');
const assert = require('node:assert/strict');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

const loader = createModuleLoader();
const areas = loader.load('./lib/inventory/areas.ts');
const map = loader.load('./lib/inventory/siteMap.ts');
const plain = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const ids = (list) => plain(list.map(item => (item.area ?? item).id));

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const area = (id, parent_id, name, shape, extra = {}) => ({ id, map_id: 'map-a', parent_id, name, shape, sort_order: 0, is_active: true, location_id: null, ...extra });
// A site plan like the Training Yard sample: racks, laydown bays, staging bays.
const sample = [
  area('t1', null, 'T1 Pipe Racks', rect(0.05, 0.05, 0.45, 0.45), { location_id: 'rack-t1' }),
  area('rack1', 't1', 'Rack 1', rect(0.07, 0.07, 0.17, 0.43), { location_id: 'rack-t1-1-1' }),
  area('rack2', 't1', 'Rack 2', rect(0.2, 0.07, 0.3, 0.43), { location_id: 'rack-t1-1-2' }),
  area('rack3', 't1', 'Rack 3', rect(0.33, 0.07, 0.43, 0.43)),
  area('staging', null, 'Equipment Staging', rect(0.55, 0.05, 0.95, 0.45), { sort_order: 2 }),
  area('bayA', 'staging', 'Bay A', rect(0.57, 0.07, 0.7, 0.43)),
  area('bayB', 'staging', 'Bay B', rect(0.71, 0.07, 0.83, 0.43)),
  area('bayC', 'staging', 'Bay C', rect(0.84, 0.07, 0.93, 0.43), { is_active: false }),
  area('t2', null, 'T2 Laydown', rect(0.05, 0.55, 0.95, 0.95), { sort_order: 1, is_active: false }),
  area('bay10', 't2', 'Bay 10', rect(0.1, 0.6, 0.2, 0.9)),
  area('bay2', 't2', 'Bay 2', rect(0.25, 0.6, 0.35, 0.9)),
  area('other-map', 't1', 'On another plan', rect(0.1, 0.1, 0.2, 0.2), { map_id: 'map-b' }),
  area('hold', null, 'T-Hold', rect(0.47, 0.47, 0.53, 0.53)),
];

test('only active areas with no retired area above them can be chosen', () => {
  const live = ids(areas.activeAreas(sample));
  assert.ok(!live.includes('bayC'), 'an inactive area is hidden');
  assert.ok(!live.includes('t2') && !live.includes('bay10') && !live.includes('bay2'), 'so is everything under an inactive parent');
  assert.ok(live.includes('rack2') && live.includes('hold'));
});

test('the tree sorts siblings, ignores parents on other plans and names the full path', () => {
  const tree = areas.buildAreaTree(areas.activeAreas(sample));
  // Equipment Staging sorts last by its sort_order; a parent on another plan is ignored.
  assert.deepEqual(plain(areas.childAreas(tree, null).map(a => a.name)), ['On another plan', 'T-Hold', 'T1 Pipe Racks', 'Equipment Staging']);
  assert.deepEqual(ids(areas.childAreas(tree, 't1')), ['rack1', 'rack2', 'rack3']);
  assert.equal(areas.areaPathLabel(tree, 'rack2'), 'T1 Pipe Racks › Rack 2');
  assert.deepEqual(plain(areas.areaPath(tree, 'rack2').map(a => a.id)), ['t1', 'rack2']);
  const all = areas.buildAreaTree(sample);
  assert.equal(areas.areaPathLabel(all, 'bay10'), 'T2 Laydown › Bay 10', 'a retired branch still names an older count');
  assert.deepEqual(ids(areas.childAreas(all, 't2')), ['bay2', 'bay10'], 'numbers sort naturally');
  const looped = areas.buildAreaTree([area('a', 'b', 'A', rect(0, 0, 1, 1)), area('b', 'a', 'B', rect(0, 0, 1, 1))]);
  assert.ok(areas.areaPath(looped, 'a').length <= 2);
});

test('collapsed areas hide their children in the list', () => {
  const tree = areas.buildAreaTree(areas.activeAreas(sample));
  const closed = areas.visibleAreaRows(tree, new Set());
  assert.equal(closed.find(row => row.area.id === 'rack2'), undefined);
  assert.equal(closed.find(row => row.area.id === 't1').hasChildren, true);
  const open = areas.visibleAreaRows(tree, new Set(['t1']));
  const rack2 = open.find(row => row.area.id === 'rack2');
  assert.equal(rack2.depth, 1);
  assert.equal(open.findIndex(row => row.area.id === 'rack2'), open.findIndex(row => row.area.id === 't1') + 2, 'children follow their parent');
});

test('search matches every word across the path, name matches first', () => {
  const tree = areas.buildAreaTree(areas.activeAreas(sample));
  assert.deepEqual(plain(areas.searchAreas(tree, 't1 rack 2').map(r => r.path)), ['T1 Pipe Racks › Rack 2']);
  const bay = areas.searchAreas(tree, 'bay');
  assert.deepEqual(ids(bay), ['bayA', 'bayB']);
  assert.equal(areas.searchAreas(tree, 'laydown').length, 0, 'retired areas are not found');
  assert.deepEqual(plain(areas.searchAreas(tree, '  ')), []);
});

test('a tap chooses the deepest (smallest) active area under the finger', () => {
  assert.equal(areas.deepestAreaAt(sample, { x: 0.25, y: 0.2 }).id, 'rack2');
  assert.equal(areas.deepestAreaAt(sample, { x: 0.185, y: 0.2 }).id, 't1', 'between racks is the parent');
  assert.equal(areas.deepestAreaAt(sample, { x: 0.9, y: 0.2 }).id, 'staging', 'an inactive child falls back to its parent');
  assert.equal(areas.deepestAreaAt(sample, { x: 0.3, y: 0.7 }), null, 'nothing under an inactive branch');
  assert.equal(areas.deepestAreaAt(sample, { x: 0.99, y: 0.99 }), null);
  // A child drawn slightly outside its parent still wins where it is smaller.
  const sloppy = [area('p', null, 'Parent', rect(0, 0, 0.5, 0.5)), area('c', 'p', 'Child', rect(0.4, 0.4, 0.6, 0.6))];
  assert.equal(areas.deepestAreaAt(sloppy, { x: 0.55, y: 0.55 }).id, 'c');
  assert.equal(areas.deepestAreaAt(sloppy, { x: 0.45, y: 0.45 }).id, 'c');
});

test('area bounds, the linked rack location and the required-area rule', () => {
  assert.deepEqual(plain(areas.areaBounds(rect(0.2, 0.07, 0.3, 0.43))), { minX: 0.2, minY: 0.07, maxX: 0.3, maxY: 0.43 });
  const all = areas.buildAreaTree(sample);
  assert.equal(areas.linkedLocationId(all, 'rack2'), 'rack-t1-1-2', 'its own rack');
  assert.equal(areas.linkedLocationId(all, 'rack3'), 'rack-t1', 'else the nearest parent with one');
  assert.equal(areas.linkedLocationId(all, 'bayA'), null);
  assert.equal(areas.areaRule(sample, false), undefined, 'unknown until the plan has been downloaded');
  const rule = areas.areaRule(sample, true);
  assert.equal(rule.required, true);
  assert.equal(rule.activeIds.has('rack2'), true);
  assert.equal(rule.activeIds.has('bayC'), false);
  assert.equal(areas.areaRule([], true).required, false, 'no areas, no requirement');
  assert.equal(areas.areaRule([area('x', null, 'X', rect(0, 0, 1, 1), { is_active: false })], true).required, false);
});

test('picking an area zooms the plan to fit it, centred and within the zoom limits', () => {
  const image = { width: 2000, height: 1000 }, frame = { width: 400, height: 400 };
  const bounds = areas.areaBounds(rect(0.2, 0.07, 0.3, 0.43));
  const view = map.viewForBounds(bounds, image, frame);
  const topLeft = map.pinToScreen({ x: 0.2, y: 0.07 }, view, image, frame);
  const bottomRight = map.pinToScreen({ x: 0.3, y: 0.43 }, view, image, frame);
  assert.ok(topLeft.x >= 0 && topLeft.y >= 0 && bottomRight.x <= 400 && bottomRight.y <= 400, 'the whole area is on screen');
  assert.ok(Math.abs((topLeft.y + bottomRight.y) / 2 - 200) < 1, 'centred');
  assert.ok(view.scale > 1);
  const tiny = map.viewForBounds({ minX: 0.5, minY: 0.5, maxX: 0.5001, maxY: 0.5001 }, image, frame);
  assert.equal(tiny.scale, map.MAX_ZOOM);
  const whole = map.viewForBounds({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, image, frame);
  assert.deepEqual(plain(whole), plain(map.centredView(image, frame)));
});
