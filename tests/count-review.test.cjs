const test = require('node:test');
const assert = require('node:assert/strict');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

const { countReviewIssue, countLocationIssue, buildCountPayload, categoryAvailabilityIssue, draftFromQueuedCount, countStartPrefill } = createModuleLoader().load('./lib/inventory/count.ts');
const plain = (value) => JSON.parse(JSON.stringify(value));

function draft() {
  return {
    tag: ' GT2-LO-001 ',
    match: null,
    item: { name: ' Lube oil cooler ', description: '', partNumber: ' LOC-22 ', quantity: '.5', uom: 'ea', condition: 'good', notes: '' },
    category: { categoryId: 'valve', proposed: null, label: 'Generator 1 › Oil System › Control Valve' },
    location: { siteMapId: 'map-a', pin: { x: 0.42, y: 0.61 }, zoneId: 'zone-b', zoneName: 'Zone B' },
    photos: [],
  };
}

test('a complete count is ready to save', () => assert.equal(countReviewIssue(draft()), null));

test('restored or edited drafts send the user back to the step that needs fixing', () => {
  const cases = [
    [d => { d.tag = '  '; }, 0],
    [d => { d.tag = 'x'.repeat(121); }, 0],
    [d => { d.item.name = ''; }, 0],
    [d => { d.item.quantity = '0'; }, 0],
    [d => { d.item.quantity = '1.2345'; }, 0],
    [d => { d.item.uom = ''; }, 0],
    [d => { d.item.uom = 'X'.repeat(17); }, 0],
    [d => { d.item.condition = 'broken'; }, 0],
    [d => { d.category = { categoryId: null, proposed: null, label: '' }; }, 1],
    [d => { d.category = { categoryId: 'valve', proposed: { parentId: null, name: 'New' }, label: 'New' }; }, 1],
    [d => { d.category = { categoryId: null, proposed: { parentId: 'oil', name: '   ' }, label: '' }; }, 1],
    [d => { d.location.siteMapId = null; }, 2],
    [d => { d.location.pin = { x: 1.5, y: 0.2 }; }, 2],
  ];
  for (const [change, step] of cases) {
    const d = draft();
    change(d);
    const issue = countReviewIssue(d);
    assert.equal(issue?.step, step, `${change}`);
    assert.ok(issue.message.length > 0);
  }
});

test('location is optional, and a zone without a pin is allowed', () => {
  const none = draft();
  none.location = { siteMapId: null, pin: null, zoneId: null, zoneName: '' };
  assert.equal(countReviewIssue(none), null);
  const zoneOnly = draft();
  zoneOnly.location.pin = null;
  assert.equal(countReviewIssue(zoneOnly), null);
});

test('the payload trims text, normalises quantity and unit, and leaves blanks out', () => {
  assert.deepEqual(plain(buildCountPayload(draft())), {
    tag: 'GT2-LO-001', name: 'Lube oil cooler', quantity: '0.5', uom: 'EA', condition: 'good',
    categoryId: 'valve', siteMapId: 'map-a', zoneId: 'zone-b', partNumber: 'LOC-22', pin: { x: 0.42, y: 0.61 },
  });
});

test('a proposal is sent instead of a category id, and a pin only with its plan', () => {
  const d = draft();
  d.category = { categoryId: null, proposed: { parentId: 'oil', name: ' Pressure Valve ' }, label: 'Oil System › Pressure Valve' };
  d.location = { siteMapId: null, pin: null, zoneId: null, zoneName: '' };
  d.item.description = 'Shell and tube';
  d.item.notes = 'Under tarp';
  const payload = plain(buildCountPayload(d));
  assert.equal(payload.categoryId, null);
  assert.deepEqual(payload.proposedCategory, { parentId: 'oil', name: 'Pressure Valve' });
  assert.equal('pin' in payload, false);
  assert.equal(payload.siteMapId, null);
  assert.equal(payload.description, 'Shell and tube');
  assert.equal(payload.notes, 'Under tarp');
});

test('a category the office archived or merged since it was chosen must be chosen again', () => {
  const tree = [{ id: 'valve', status: 'active' }, { id: 'oil', status: 'proposed' }, { id: 'old', status: 'archived' }];
  const kept = { categoryId: 'valve', proposed: null, label: 'Valve' };
  assert.equal(categoryAvailabilityIssue(kept, tree, true), null);
  assert.equal(categoryAvailabilityIssue({ ...kept, categoryId: 'oil' }, tree, true), null, 'proposed categories can be used');
  assert.equal(categoryAvailabilityIssue({ ...kept, categoryId: 'old' }, tree, true).step, 1);
  assert.equal(categoryAvailabilityIssue({ ...kept, categoryId: 'gone' }, tree, true).step, 1);
  assert.match(categoryAvailabilityIssue({ categoryId: null, proposed: { parentId: 'old', name: 'New' }, label: '' }, tree, true).message, /parent/);
  assert.equal(categoryAvailabilityIssue({ categoryId: null, proposed: { parentId: null, name: 'New' }, label: '' }, tree, true), null);
  assert.equal(categoryAvailabilityIssue({ ...kept, categoryId: 'gone' }, [], false), null, 'without a downloaded tree the server decides');
});

test('a refused queued count becomes the same draft again, opening where the server objected', () => {
  const d = draft();
  d.category = { categoryId: null, proposed: { parentId: 'oil', name: 'Pressure Valve' }, label: 'Oil System › Pressure Valve' };
  d.item.notes = 'Under tarp';
  const payload = { count: plain(buildCountPayload(d)), photos: [{ uri: 'file:///p.jpg' }], categoryLabel: d.category.label, zoneName: 'Zone B' };
  const restored = draftFromQueuedCount(payload, 'Parent category is unavailable in this project');
  assert.equal(restored.step, 1);
  assert.equal(countReviewIssue(restored.draft), null, 'the reopened draft passes review again');
  assert.deepEqual(plain(buildCountPayload(restored.draft)), payload.count, 'saving it unchanged sends the same payload');
  assert.equal(restored.draft.category.label, 'Oil System › Pressure Valve');
  assert.equal(draftFromQueuedCount(payload, 'Zone is unavailable on this map').step, 2);
  assert.equal(draftFromQueuedCount(payload, 'Quantity must be a positive number with up to 3 decimals').step, 0);
  assert.equal(draftFromQueuedCount(payload, 'Something else').step, 3);
});

// Plan map-a has areas; plan map-b (also in use) has none; area "gone" is
// retired. map-old is missing from the copy: retired only once a download made
// for that location confirms it (confirmedFor).
const rule = {
  activeMapIds: new Set(['map-a', 'map-b']), liveAreaIds: new Set(['zone-b', 'rack2']), mapsWithAreas: new Set(['map-a']),
  areaMap: new Map([['zone-b', 'map-a'], ['rack2', 'map-a']]), retiredAreaIds: new Set(['gone']), confirmedFor: null,
};

test('a count needs an area when the plan it names has areas (or, with no plan, when any does)', () => {
  const none = draft();
  none.location = { siteMapId: null, pin: null, zoneId: null, zoneName: '' };
  assert.equal(countReviewIssue(none, rule).step, 2);
  assert.match(countLocationIssue(none.location, rule), /Choose a location/);
  assert.equal(countReviewIssue(none, { ...rule, liveAreaIds: new Set(), mapsWithAreas: new Set(), areaMap: new Map() }), null, 'no areas, no requirement');
  const pinOnPlainPlan = draft();
  pinOnPlainPlan.location = { siteMapId: 'map-b', pin: { x: 0.5, y: 0.5 }, zoneId: null, zoneName: '' };
  assert.equal(countReviewIssue(pinOnPlainPlan, rule), null, 'a plan with no areas takes a pin on its own');
  assert.equal(countReviewIssue(none), null, 'unknown rule: the server decides');
  const areaOnly = draft();
  areaOnly.location = { siteMapId: 'map-a', pin: null, zoneId: 'rack2', zoneName: 'T1 Pipe Racks › Rack 2' };
  assert.equal(countReviewIssue(areaOnly, rule), null);
  const retired = draft();
  assert.match(countReviewIssue({ ...retired, location: { ...retired.location, zoneId: 'gone' } }, rule).message, /retired this area/);
  const retiredPlan = draft();
  retiredPlan.location = { siteMapId: 'map-old', pin: { x: 0.2, y: 0.2 }, zoneId: null, zoneName: '' };
  assert.equal(countReviewIssue(retiredPlan, rule), null, 'missing from an older copy: maybe a new plan, so the server decides');
  assert.match(countReviewIssue(retiredPlan, { ...rule, confirmedFor: 'map-old|' }).message, /retired this site plan/, 'missing from a download made for it: retired');
  const newArea = draft();
  newArea.location = { siteMapId: 'map-a', pin: null, zoneId: 'zone-new', zoneName: 'New bay' };
  assert.equal(countReviewIssue(newArea, rule), null, 'an area newer than the copy is kept');
  assert.match(countReviewIssue(newArea, { ...rule, confirmedFor: 'map-a|zone-new' }).message, /retired this area/);
  // The server: 42501 "Zone is unavailable on this map".
  const otherPlan = draft();
  otherPlan.location = { siteMapId: 'map-b', pin: null, zoneId: 'rack2', zoneName: 'T1 Pipe Racks › Rack 2' };
  assert.equal(countReviewIssue(otherPlan, rule).step, 2);
  assert.match(countReviewIssue(otherPlan, rule).message, /different site plan/);
  const pinOutside = draft();
  pinOutside.location = { siteMapId: 'map-a', pin: { x: 0.9, y: 0.9 }, zoneId: null, zoneName: '' };
  assert.equal(countReviewIssue(pinOutside, rule).step, 2, 'a pin alone is not enough');
});

test('a count refused for having no location reopens on the Location step', () => {
  const payload = { count: plain(buildCountPayload(draft())), photos: [] };
  assert.equal(draftFromQueuedCount(payload, 'Choose a location').step, 2);
  assert.equal(draftFromQueuedCount(payload, 'Area is inactive').step, 2);
  assert.equal(draftFromQueuedCount(payload, 'This area is no longer in use; choose another').step, 2);
  assert.equal(draftFromQueuedCount(payload, 'This site plan is no longer in use').step, 2, 'a retired plan does not loop back to review');
});

test('a matched record pre-fills its area with the full path', () => {
  const zones = [
    { id: 't1', map_id: 'map-a', parent_id: null, name: 'T1 Pipe Racks', shape: [], sort_order: 0, is_active: true, location_id: null },
    { id: 'rack2', map_id: 'map-a', parent_id: 't1', name: 'Rack 2', shape: [], sort_order: 0, is_active: true, location_id: null },
  ];
  const record = { id: 1, uid: 'u', qr_code: 'T', inventory_item: 'Cooler', item_description: null, part_number: null, quantity: 1, uom: 'EA', condition: 'good',
    count_status: 'counted', category_id: null, site_map_id: 'map-a', pin_x: null, pin_y: null, zone_id: 'rack2', location: 'stale text', counted_at: null };
  assert.equal(countStartPrefill(record, [], zones).location.zoneName, 'T1 Pipe Racks › Rack 2');
  assert.equal(countStartPrefill(record, [], []).location.zoneName, 'stale text', 'without saved areas, the stored path');
});
