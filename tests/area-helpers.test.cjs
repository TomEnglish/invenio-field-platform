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
  // A child traced exactly over its parent: the child wins, whatever the order.
  const same = rect(0.2, 0.2, 0.4, 0.4);
  assert.equal(areas.deepestAreaAt([area('kid', 'mum', 'Kid', same), area('mum', null, 'Mum', same)], { x: 0.3, y: 0.3 }).id, 'kid');
  assert.equal(areas.deepestAreaAt([area('mum', null, 'Mum', same), area('kid', 'mum', 'Kid', same)], { x: 0.3, y: 0.3 }).id, 'kid');
});

test('area bounds, the linked rack location and the required-area rule', () => {
  assert.deepEqual(plain(areas.areaBounds(rect(0.2, 0.07, 0.3, 0.43))), { minX: 0.2, minY: 0.07, maxX: 0.3, maxY: 0.43 });
  const all = areas.buildAreaTree(sample);
  assert.deepEqual(plain({ id: areas.linkedLocation(all, 'rack2').locationId, owner: areas.linkedLocation(all, 'rack2').owner.id }), { id: 'rack-t1-1-2', owner: 'rack2' }, 'its own rack');
  assert.deepEqual(plain({ id: areas.linkedLocation(all, 'rack3').locationId, owner: areas.linkedLocation(all, 'rack3').owner.id }), { id: 'rack-t1', owner: 't1' }, 'else the nearest parent with one, which owns the label');
  assert.equal(areas.linkedLocation(all, 'bayA'), null);
  const maps = [{ id: 'map-a' }, { id: 'map-plain' }];
  assert.equal(areas.locationRule(maps, sample, false), undefined, 'unknown until the plan has been downloaded');
  const rule = areas.locationRule(maps, sample, true);
  assert.equal(rule.liveAreaIds.has('rack2'), true);
  assert.equal(rule.liveAreaIds.has('bayC'), false);
  assert.equal(rule.liveAreaIds.has('other-map'), false, 'areas on a plan no longer in use are not live');
  assert.equal(areas.areaRequired(rule, 'map-a'), true);
  assert.equal(areas.areaRequired(rule, 'map-plain'), false, 'a plan with no areas takes a pin on its own');
  assert.equal(areas.areaRequired(rule, null), true, 'no plan named: required while any plan has areas');
  assert.equal(areas.areaRequired(areas.locationRule(maps, [], true), null), false, 'no areas, no requirement');
  assert.equal(areas.areaRequired(areas.locationRule(maps, [area('x', null, 'X', rect(0, 0, 1, 1), { is_active: false })], true), null), false);
  assert.equal(areas.areaRequired(undefined, 'map-a'), false);
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

test('a tap picks the deepest area in the tree, then the smaller; broken outlines never win', () => {
  // A small top-level area overlapping a deeper bay: the bay (depth 2) wins.
  const tree = [
    area('yard', null, 'Yard', rect(0, 0, 0.6, 0.6)),
    area('bay', 'yard', 'Bay', rect(0.1, 0.1, 0.5, 0.5)),
    area('sign', null, 'Sign post', rect(0.28, 0.28, 0.32, 0.32)),
  ];
  assert.equal(areas.deepestAreaAt(tree, { x: 0.3, y: 0.3 }).id, 'bay');
  // Equal depth: the smaller wins.
  const siblings = [area('big', null, 'Big', rect(0, 0, 0.5, 0.5)), area('small', null, 'Small', rect(0.2, 0.2, 0.3, 0.3))];
  assert.equal(areas.deepestAreaAt(siblings, { x: 0.25, y: 0.25 }).id, 'small');
  // A zero-area sliver and a bow-tie (self-crossing) outline are ignored.
  const sliver = area('sliver', 'bay', 'Sliver', [[0.2, 0.2], [0.4, 0.4], [0.3, 0.3]]);
  const bowtie = area('bowtie', 'bay', 'Bow tie', [[0.2, 0.2], [0.4, 0.4], [0.4, 0.2], [0.2, 0.4]]);
  assert.equal(areas.usableShape(sliver.shape), false);
  assert.equal(areas.usableShape(bowtie.shape), false);
  assert.equal(areas.usableShape(rect(0.1, 0.1, 0.5, 0.5)), true);
  assert.equal(areas.usableShape([[0, 0], [1, 1]]), false);
  assert.equal(areas.deepestAreaAt([...tree, sliver, bowtie], { x: 0.3, y: 0.3 }).id, 'bay');
  assert.equal(areas.deepestAreaAt([...tree, bowtie], { x: 0.25, y: 0.3 }).id, 'bay');
});

test('a tap checks outlines only for the areas under the finger', () => {
  // 300 areas of 200 points each, none under the tap. Checking every outline
  // for crossings first read each one tens of thousands of times per tap.
  const circle = (cx, cy, r, n) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);
  let reads = 0;
  const counted = (shape) => new Proxy(shape, { get: (target, key) => { if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1; return target[key]; } });
  const many = Array.from({ length: 300 }, (_, i) => area(`a${i}`, null, `Area ${i}`, counted(circle(0.6 + (i % 20) * 0.02, 0.6 + Math.floor(i / 20) * 0.02, 0.008, 200))));
  const target = area('target', null, 'Target', rect(0.1, 0.1, 0.2, 0.2));
  assert.equal(areas.deepestAreaAt([...many, target], { x: 0.15, y: 0.15 }).id, 'target');
  assert.ok(reads < 300 * 200 * 4, `${reads} reads of outline points for one tap`);
});

test('a saved location is stale when its plan or area is retired, or the area is on another plan', () => {
  const rule = areas.locationRule([{ id: 'map-a' }, { id: 'map-b' }], sample, true);
  assert.equal(areas.staleLocation({ siteMapId: 'map-a', zoneId: 'rack2' }, rule), null);
  assert.equal(areas.staleLocation({ siteMapId: null, zoneId: 'rack2' }, rule), null, 'no plan named: the server takes the area\'s plan');
  // Missing from the copy: a newer plan or a retired one. Unknown until a
  // download made for that location confirms it is gone.
  assert.equal(areas.staleLocation({ siteMapId: 'map-gone', zoneId: null }, rule), 'unknown');
  assert.equal(areas.retiredLocation({ siteMapId: 'map-gone', zoneId: null }, rule), false, 'kept');
  assert.equal(areas.locationKey({ siteMapId: 'map-gone', zoneId: null }), 'map-gone|');
  const confirmed = areas.locationRule([{ id: 'map-a' }, { id: 'map-b' }], sample, true, 'map-gone|');
  assert.equal(areas.staleLocation({ siteMapId: 'map-gone', zoneId: null }, confirmed), 'plan');
  assert.equal(areas.retiredLocation({ siteMapId: 'map-gone', zoneId: null }, confirmed), true);
  assert.equal(areas.staleLocation({ siteMapId: 'map-gone', zoneId: 'rack2' }, confirmed), 'unknown', 'confirmed for another location only');
  assert.equal(areas.staleLocation({ siteMapId: 'map-a', zoneId: 'bay99' }, rule), 'unknown', 'an area newer than the copy');
  assert.equal(areas.staleLocation({ siteMapId: 'map-a', zoneId: 'bay99' }, areas.locationRule([{ id: 'map-a' }], sample, true, 'map-a|bay99')), 'area');
  assert.equal(areas.staleLocation({ siteMapId: 'map-a', zoneId: 'bayC' }, rule), 'area', 'retired area');
  assert.equal(areas.staleLocation({ siteMapId: 'map-a', zoneId: 'bay10' }, rule), 'area', 'under a retired parent');
  assert.equal(areas.staleLocation({ siteMapId: 'map-b', zoneId: 'rack2' }, rule), 'other-plan');
  assert.equal(areas.staleLocation({ siteMapId: 'map-gone', zoneId: 'rack2' }, undefined), null, 'unknown until downloaded');
});
