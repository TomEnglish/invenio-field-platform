const test = require('node:test');
const assert = require('node:assert/strict');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

const { countReviewIssue, buildCountPayload } = createModuleLoader().load('./lib/inventory/count.ts');
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
