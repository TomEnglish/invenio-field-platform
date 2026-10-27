const test = require('node:test');
const assert = require('node:assert/strict');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

const { countReviewIssue, buildCountPayload, categoryAvailabilityIssue, draftFromQueuedCount } = createModuleLoader().load('./lib/inventory/count.ts');
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
