const test = require('node:test');
const assert = require('node:assert/strict');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

// The pure crate rules in lib/logistics/crates.ts, against migration 021.
const crates = createModuleLoader().load('./lib/logistics/crates.ts');
const plain = (value) => JSON.parse(JSON.stringify(value));

const unit = (code, extra = {}) => ({
  id: `id-${code}`, code, kind: 'crate', description: null, is_high_value: false, status: 'open', parent_id: null, parent_code: null, top_code: code,
  place_id: 'yard', place_name: 'Training Yard', site_map_id: 'map-a', zone_id: 'bay-1', location: 'T2 Laydown › Bay 1', item_count: 0, unit_count: 0, ...extra,
});
const packed = (unit_code, tag, name = `Item ${tag}`) => ({ unit_code, tag, name, quantity: 1, uom: 'EA', material_id: `m-${tag}`, inventory_uid: null });
const reference = (extra = {}) => ({
  units: [
    unit('HU-AAAA01', { item_count: 1, unit_count: 1 }),
    unit('HU-BBBB02', { parent_id: 'id-HU-AAAA01', parent_code: 'HU-AAAA01', top_code: 'HU-AAAA01' }),
    unit('HU-CCCC03', { status: 'sealed', zone_id: 'bay-2', location: 'T2 Laydown › Bay 2', item_count: 1 }),
    unit('HU-DONE04', { status: 'unpacked' }),
    unit('HU-LOAD05', { status: 'on_load' }),
  ],
  items: [packed('HU-AAAA01', 'PIPE-1', '6" pipe'), packed('HU-CCCC03', 'VALVE-9', 'Gate valve')],
  places: [{ id: 'yard', kind: 'yard', name: 'Training Yard', project_id: 'project-a', city: null, state: null }],
  materials: [
    { id: 'm-PIPE-2', tag: 'PIPE-2', name: 'Pipe 4" A106', quantity: 3 },
    { id: 'm-PIPE-1', tag: 'PIPE-1', name: '6" pipe', quantity: 1 },
  ],
  counted: [
    { uid: 'u-1', tag: 'GT2-LO-001', name: 'Lube oil cooler', quantity: '1.5', uom: 'EA', status: 'counted' },
    { uid: 'u-2', tag: 'GT2-LO-002', name: 'Filter housing', quantity: 1, uom: 'EA', status: 'expected' },
    { uid: 'u-3', tag: 'GT2-LO-003', name: 'Old pump', quantity: 1, uom: 'EA', status: 'received' },
  ],
  savedAt: '2026-10-29T08:00:00Z',
  ...extra,
});
const draft = (code, extra = {}) => ({
  code, before: null, kind: 'crate', description: '', isHighValue: false, add: [], remove: [],
  location: { placeId: null, placeName: '', siteMapId: null, zoneId: null, zoneName: '' }, ...extra,
});
const index = (ref = reference()) => crates.indexLoad(ref);

test('crate labels are read in any case and must look like HU- plus 4 to 20 letters or numbers', () => {
  assert.equal(crates.crateCode(' hu-ab12cd '), 'HU-AB12CD');
  assert.equal(crates.looksLikeCrate('Hu-x'), true);
  assert.equal(crates.isCrateCode('hu-ab12cd'), true);
  assert.equal(crates.isCrateCode('HU-AB'), false);
  assert.equal(crates.isCrateCode('HU-AB 12'), false);
  assert.match(crates.labelIssue(index(), 'GT2-LO-001'), /item tag/);
  assert.match(crates.labelIssue(index(), 'hu-ab'), /isn't a crate label/);
  assert.match(crates.labelIssue(index(), 'HU-LOAD05'), /HU-LOAD05 is on load \?; unload it first/);
  assert.equal(crates.labelIssue(index(), 'hu-new123'), null, 'an unused label becomes a crate when packed');
  assert.equal(crates.labelIssue(index(), 'HU-DONE04'), null, 'an unpacked label can be packed again');
});

test('scanned items: in-yard materials and counted items go in; the copy refuses what the server would', () => {
  const ix = index();
  const d = draft('HU-CCCC03');
  const verdict = (tag, extra = {}) => crates.classifyScan(ix, { ...d, ...extra }, tag);
  assert.deepEqual(plain(verdict('PIPE-2')), { kind: 'add', entry: { tag: 'PIPE-2', name: 'Pipe 4" A106', crate: false }, message: 'PIPE-2 added.' });
  assert.equal(verdict(' GT2-LO-001 ').entry.name, 'Lube oil cooler', 'tags are trimmed, as the server trims them');
  const other = verdict('PIPE-1');
  assert.equal(other.kind, 'refuse');
  assert.equal(other.message, 'PIPE-1 is already in crate HU-AAAA01; take it out of that crate first.');
  assert.equal(other.recheck, true, 'the copy may be out of date, so the server is asked');
  assert.equal(verdict('VALVE-9').kind, 'already');
  assert.match(verdict('GT2-LO-002').message, /hasn't been counted or received yet/);
  assert.match(verdict('GT2-LO-003').message, /issued or shipped/);
  assert.equal(verdict('PIPE-2', { add: [{ tag: 'PIPE-2', name: 'x', crate: false }] }).kind, 'already');
  assert.deepEqual(plain(verdict('VALVE-9', { remove: [{ tag: 'VALVE-9', name: 'x', crate: false }] })), { kind: 'keep', tag: 'VALVE-9', message: 'VALVE-9 stays in HU-CCCC03.' });
  assert.equal(verdict('  '), null);

  // Unknown to the copy: added unchecked; once the server has been asked, refused.
  const unknown = verdict('NEW-TAG');
  assert.equal(unknown.kind, 'add');
  assert.equal(unknown.entry.unchecked, true);
  const confirmed = crates.classifyScan(ix, d, 'NEW-TAG', true);
  assert.equal(confirmed.message, "NEW-TAG isn't a received or counted item in this project.");

  const full = Array.from({ length: 500 }, (_, i) => ({ tag: `T-${i}`, name: '', crate: false }));
  assert.match(verdict('PIPE-2', { add: full }).message, /at most 500 tags/);
});

test('scanned crates: no crate in itself, in two crates, in a crate it holds, or more than 5 levels deep', () => {
  const ix = index();
  const verdict = (code, tag, confirmed = false) => crates.classifyScan(ix, draft(code), tag, confirmed);
  assert.match(verdict('HU-CCCC03', 'hu-cccc03').message, /can’t go inside itself/);
  assert.equal(verdict('HU-CCCC03', 'hu-bbbb02').message, 'HU-BBBB02 is already inside HU-AAAA01; take it out first.');
  assert.match(verdict('HU-BBBB02', 'HU-AAAA01').message, /cannot go inside itself or a crate it contains/);
  assert.match(verdict('HU-CCCC03', 'HU-DONE04').message, /unpacked; it can’t go inside another crate/);
  assert.match(verdict('HU-CCCC03', 'HU-LOAD05').message, /on a load/);
  assert.equal(verdict('HU-AAAA01', 'HU-BBBB02').kind, 'already');
  const ok = verdict('HU-AAAA01', 'hu-cccc03');
  assert.equal(ok.kind, 'add');
  assert.equal(ok.entry.tag, 'HU-CCCC03');
  assert.equal(ok.entry.crate, true);
  assert.equal(verdict('HU-AAAA01', 'HU-ZZZZ99').entry.unchecked, true, 'a crate not on the device is checked on upload');
  assert.match(verdict('HU-AAAA01', 'HU-ZZZZ99', true).message, /hasn't been packed yet/);

  // L1 › L2 › L3 › L4 holds; a crate holding one more crate makes 6 levels.
  const chain = ['HU-LVL001', 'HU-LVL002', 'HU-LVL003', 'HU-LVL004'].map((code, i, all) => unit(code, i ? { parent_code: all[i - 1], parent_id: `id-${all[i - 1]}` } : {}));
  const deep = crates.indexLoad(reference({ units: [...chain, unit('HU-TWO001'), unit('HU-TWO002', { parent_code: 'HU-TWO001' }), unit('HU-ONE001')] }));
  assert.match(crates.classifyScan(deep, draft('HU-LVL004'), 'HU-TWO001').message, /at most 5 levels deep/);
  assert.equal(crates.classifyScan(deep, draft('HU-LVL004'), 'HU-ONE001').kind, 'add', 'five levels is allowed');
});

test('review: an empty crate is not sealed, and a crate on its own needs an area when the project has areas', () => {
  const ix = index();
  assert.deepEqual(plain(crates.packReviewIssue(ix, draft('HU-NEW123'), true, true)), { step: 2, message: 'An empty crate can’t be sealed. Scan items into it first, or save it open.' });
  assert.equal(crates.packReviewIssue(ix, draft('HU-NEW123'), false, true), null, 'an empty crate can be saved open');
  const filled = draft('HU-NEW123', { add: [{ tag: 'PIPE-2', name: '', crate: false }] });
  assert.equal(crates.packReviewIssue(ix, filled, true, true).step, 3);
  assert.equal(crates.packReviewIssue(ix, filled, true, false), null, 'no areas in the project: no location needed');
  assert.equal(crates.packReviewIssue(ix, filled, true, null), null, 'unknown on this device: the server decides');
  assert.equal(crates.packReviewIssue(ix, { ...filled, location: { ...filled.location, zoneId: 'bay-3', siteMapId: 'map-a' } }, true, true), null);
  assert.equal(crates.packReviewIssue(ix, draft('HU-BBBB02', { add: [{ tag: 'PIPE-2', name: '', crate: false }] }), true, true), null, 'a nested crate goes where its outer crate goes');
  assert.equal(crates.packReviewIssue(ix, draft('HU-CCCC03', { before: crates.packBefore(ix.units.get('HU-CCCC03')) }), true, true), null, 'it keeps the area it has');
  // Now on its own: the copy wins over how it was when packing started.
  const loose = crates.indexLoad(reference({ units: [unit('HU-LOOSE1', { zone_id: null, location: null })] }));
  const wasNested = draft('HU-LOOSE1', { before: { ...crates.packBefore(loose.units.get('HU-LOOSE1')), parentCode: 'HU-AAAA01' }, add: [{ tag: 'PIPE-2', name: '', crate: false }] });
  assert.equal(crates.packReviewIssue(loose, wasNested, true, true).step, 3);
  // Unpacked (or taken out) since the draft started: it can't come out again.
  const unpacked = crates.indexLoad(crates.applyPending(reference(), [{ type: 'unpack', payload: { unitCode: 'HU-CCCC03' } }]));
  assert.match(crates.packReviewIssue(unpacked, draft('HU-CCCC03', { remove: [{ tag: 'VALVE-9', name: '', crate: false }] }), false, true).message, /VALVE-9 is no longer in HU-CCCC03/);
  // A tag the server has since refused holds the save.
  const refusedTag = draft('HU-NEW123', { add: [{ tag: 'PIPE-2', name: '', crate: false, problem: 'PIPE-2 is already in crate HU-Y; take it out of that crate first.' }] });
  assert.deepEqual(plain(crates.packReviewIssue(ix, refusedTag, false, true)), { step: 2, message: 'PIPE-2 is already in crate HU-Y; take it out of that crate first. Remove PIPE-2 from the list, or sort it out first.' });
  const emptied = draft('HU-CCCC03', { before: crates.packBefore(ix.units.get('HU-CCCC03')), remove: [{ tag: 'VALVE-9', name: '', crate: false }] });
  assert.equal(crates.packReviewIssue(ix, emptied, true, true).step, 2, 'taking the last item out leaves it empty');
  assert.equal(crates.packReviewIssue(ix, draft('HU-NEW123', { description: 'x'.repeat(201) }), false, true).step, 1);
});

test('the pack payload carries the session, sending details and location only when they change', () => {
  const ix = index();
  const fresh = draft('HU-NEW123', {
    kind: 'skid', description: '  Pump spares ', isHighValue: true,
    add: [{ tag: 'PIPE-2', name: '', crate: false }, { tag: 'HU-CCCC03', name: '', crate: true }],
    location: { placeId: 'yard', placeName: 'Training Yard', siteMapId: 'map-a', zoneId: 'bay-3', zoneName: 'T2 Laydown › Bay 3' },
  });
  assert.deepEqual(plain(crates.buildPackPayload(fresh, true)), {
    unitCode: 'HU-NEW123', seal: true, kind: 'skid', description: 'Pump spares', isHighValue: true,
    placeId: 'yard', zoneId: 'bay-3', siteMapId: 'map-a', add: ['PIPE-2', 'HU-CCCC03'],
  });
  assert.deepEqual(plain(crates.buildPackPayload(draft('HU-NEW124'), false)), { unitCode: 'HU-NEW124', seal: false }, 'a label the device doesn’t know keeps whatever type it has; a new one is a crate');
  assert.equal(crates.buildPackPayload(draft('HU-NEW124', { kind: 'basket' }), false).kind, 'basket', 'a type chosen is sent');

  const before = crates.packBefore(ix.units.get('HU-CCCC03'));
  const same = draft('HU-CCCC03', { before, location: { placeId: 'yard', placeName: '', siteMapId: 'map-a', zoneId: 'bay-2', zoneName: '' }, remove: [{ tag: 'VALVE-9', name: '', crate: false }] });
  assert.deepEqual(plain(crates.buildPackPayload(same, false)), { unitCode: 'HU-CCCC03', seal: false, remove: ['VALVE-9'] }, 'unchanged details and area are not sent again');
  assert.deepEqual(plain(crates.buildPackPayload({ ...same, remove: [], description: 'Spares', isHighValue: true }, true)), { unitCode: 'HU-CCCC03', seal: true, description: 'Spares', isHighValue: true });
  const allowed = new Set(['unitCode', 'kind', 'description', 'isHighValue', 'placeId', 'zoneId', 'siteMapId', 'add', 'remove', 'seal']);
  assert.ok(Object.keys(crates.buildPackPayload(fresh, true)).every(key => allowed.has(key)), 'only keys migration 021 reads');
});

test('saved packs and unpacks show at once, as the server will apply them, and replaying one changes nothing', () => {
  const ref = reference();
  const pack = { type: 'pack', payload: { pack: { unitCode: 'hu-new123', kind: 'skid', add: ['PIPE-2', 'HU-CCCC03', 'GT2-LO-001', 'PIPE-1'], zoneId: 'bay-3', siteMapId: 'map-a', seal: true }, zoneName: 'T2 Laydown › Bay 3' } };
  const after = crates.indexLoad(crates.applyPending(ref, [pack]));
  const crate = after.units.get('HU-NEW123');
  assert.equal(crate.status, 'sealed');
  assert.equal(crate.kind, 'skid');
  assert.equal(crate.location, 'T2 Laydown › Bay 3');
  assert.deepEqual(plain(after.contents.get('HU-NEW123').map(item => item.tag)), ['PIPE-2', 'GT2-LO-001'], 'PIPE-1 is in another crate, as the server would refuse');
  assert.equal(after.contents.get('HU-NEW123')[1].name, 'Lube oil cooler');
  assert.equal(after.units.get('HU-CCCC03').parent_code, 'HU-NEW123');
  assert.equal(after.units.get('HU-CCCC03').location, 'T2 Laydown › Bay 3', 'a nested crate is where its outer crate is');
  assert.equal(crate.item_count, 2);
  assert.equal(crate.unit_count, 1);
  assert.deepEqual(plain(crates.packedInText(after, 'GT2-LO-001')), { code: 'HU-NEW123', text: 'In crate HU-NEW123 at T2 Laydown › Bay 3' });
  assert.deepEqual(plain(crates.applyPending(ref, [pack, pack])), plain(crates.applyPending(ref, [pack])));

  const unpack = crates.indexLoad(crates.applyPending(ref, [pack, { type: 'unpack', payload: { unitCode: 'HU-NEW123' } }]));
  assert.equal(unpack.units.get('HU-NEW123').status, 'unpacked');
  assert.equal(unpack.contents.get('HU-NEW123'), undefined);
  assert.equal(unpack.units.get('HU-CCCC03').parent_code, null);
  assert.equal(unpack.units.get('HU-CCCC03').zone_id, 'bay-3', 'released where the crate stood');
  assert.equal(crates.packedInText(unpack, 'PIPE-2'), null);

  // Taking a nested crate out leaves it where its outer crate is.
  const out = crates.indexLoad(crates.applyPending(ref, [{ type: 'pack', payload: { pack: { unitCode: 'HU-AAAA01', remove: ['hu-bbbb02', 'PIPE-1'], seal: false } } }]));
  assert.equal(out.units.get('HU-BBBB02').parent_code, null);
  assert.equal(out.units.get('HU-BBBB02').location, 'T2 Laydown › Bay 1');
  assert.equal(out.crateOf.get('PIPE-1'), undefined);

  // A count saved on the device makes its tag packable.
  const counted = crates.indexLoad(crates.applyPending(ref, [{ type: 'count', payload: { count: { tag: 'GT2-LO-002', name: 'Filter housing', quantity: '2', uom: 'EA' } } }]));
  assert.equal(crates.classifyScan(counted, draft('HU-NEW123'), 'GT2-LO-002').kind, 'add');
  assert.equal(crates.applyPending(ref, [{ type: 'receiving', payload: {} }]), ref, 'other actions leave the copy alone');
});

test('a pack started while an earlier one waits to upload resends its details and area, in case that one is refused', () => {
  const ref = reference();
  const waiting = { type: 'pack', payload: { pack: { unitCode: 'HU-NEW001', kind: 'skid', description: 'Valves', zoneId: 'bay-3', siteMapId: 'map-a', add: ['PIPE-2'], seal: false }, zoneName: 'T2 Laydown › Bay 3' } };
  const index = crates.indexLoad(crates.applyPending(ref, [waiting]));
  const known = crates.indexLoad(ref);
  const { before, start } = crates.packStart('HU-NEW001', index, known);
  assert.equal(before, null, 'the server has no such crate yet');
  assert.deepEqual(plain(start), { kind: 'skid', description: 'Valves', isHighValue: false, location: { placeId: null, placeName: '', siteMapId: 'map-a', zoneId: 'bay-3', zoneName: 'T2 Laydown › Bay 3' } });
  const second = draft('HU-NEW001', { before, ...start, add: [{ tag: 'GT2-LO-001', name: '', crate: false }] });
  assert.deepEqual(plain(crates.buildPackPayload(second, true)), { unitCode: 'HU-NEW001', seal: true, kind: 'skid', description: 'Valves', zoneId: 'bay-3', siteMapId: 'map-a', add: ['GT2-LO-001'] });

  // Nothing waiting: the crate's own values, and its area isn't sent again.
  const settled = crates.packStart('HU-CCCC03', known, known);
  assert.equal(settled.before.zoneId, 'bay-2');
  assert.equal(settled.start.location.zoneId, null);
  // A nested crate's place is its outer crate's: never carried.
  assert.equal(crates.packStart('HU-BBBB02', known, known).start.location.zoneId, null);
});

test('a fresh answer from the server replaces what the copy says about that tag', () => {
  const ref = reference();
  const merged = crates.mergeFresh(ref, 'PIPE-1', { units: [], items: [], materials: [{ id: 'm-PIPE-1', tag: 'PIPE-1', name: '6" pipe', quantity: 1 }], counted: [] });
  assert.equal(crates.classifyScan(crates.indexLoad(merged), draft('HU-CCCC03'), 'PIPE-1', true).kind, 'add', 'taken out of HU-AAAA01 since the copy was saved');
  const crate = crates.mergeFresh(ref, 'hu-bbbb02', { units: [unit('HU-BBBB02')], items: [], materials: [], counted: [] });
  assert.equal(crates.classifyScan(crates.indexLoad(crate), draft('HU-CCCC03'), 'HU-BBBB02', true).kind, 'add');

  // The crate being packed comes back too: taken out of HU-AAAA01 since, so
  // putting HU-AAAA01 inside it is no longer a loop.
  const stale = crates.classifyScan(crates.indexLoad(ref), draft('HU-BBBB02'), 'HU-AAAA01');
  assert.match(stale.message, /cannot go inside itself or a crate it contains/);
  const trees = crates.mergeFresh(ref, 'HU-AAAA01', { units: [unit('HU-AAAA01'), unit('HU-BBBB02')], items: [], materials: [], counted: [] });
  assert.equal(crates.classifyScan(crates.indexLoad(trees), draft('HU-BBBB02'), 'HU-AAAA01', true).kind, 'add');
  assert.equal(trees.units.filter(u => u.code === 'HU-BBBB02').length, 1, 'each crate once: the server rows replace the copy rows');

  // A legacy tag stored with spaces isn't found by the lookup: the record stays.
  const kept = crates.mergeFresh(ref, 'GT2-LO-001', { units: [], items: [], materials: [], counted: [] });
  assert.equal(crates.classifyScan(crates.indexLoad(kept), draft('HU-CCCC03'), 'GT2-LO-001', true).kind, 'add');
});
