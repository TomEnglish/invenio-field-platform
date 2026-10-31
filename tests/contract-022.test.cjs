const test = require('node:test');
const assert = require('node:assert/strict');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

// The reworked migration 022 contract (31 October): the pure rules for the
// licence override, who changes stops, late scans, moving pieces between
// loads, partial steps, write-offs, crate moves, where items are, tags in any
// capitals and project activity.
const loader = createModuleLoader();
const loads = loader.load('./lib/logistics/loads.ts');
const crates = loader.load('./lib/logistics/crates.ts');
const positions = loader.load('./lib/logistics/positions.ts');
const activity = loader.load('./lib/activityText.ts');
const plain = (value) => JSON.parse(JSON.stringify(value));

const unit = (code, extra = {}) => ({
  id: `id-${code}`, code, kind: 'crate', description: `Crate ${code}`, is_high_value: false, status: 'sealed', parent_id: null, parent_code: null, top_code: code,
  place_id: 'yard', place_name: 'Training Yard', site_map_id: null, zone_id: null, location: null, item_count: 1, unit_count: 0,
  top_status: 'sealed', load_id: null, load_number: null, load_line_status: null, ...extra,
});
const load = (id, extra = {}) => ({
  id, load_number: 'L-0003', status: 'planning', origin_place_id: 'yard', origin_name: 'Training Yard', planned_date: null, truck_type: null, truck_number: null,
  trailer_number: null, bol_number: null, driver_name: 'Sam Ortiz', driver_phone: null, licence_recorded_at: null, notes: null, stop_count: 2, stops_done: 0,
  next_stop: 'Gulf Machine', planned_count: 1, on_board_count: 0, delivered_count: 0, missing_count: 0, flagged_count: 0, departed_at: null, updated_at: null, ...extra,
});
const stop = (id, seq, place_id, place_name, kind = 'dropoff', extra = {}) => ({ id, load_id: 'load-a', seq, place_id, place_name, kind, planned_date: null, status: 'pending', due_count: 0, delivered_count: 0, missing_count: 0, ...extra });
const line = (tag, extra = {}) => ({
  id: `line-${tag}`, load_id: 'load-a', load_number: 'L-0003', load_status: 'planning', tag, piece_kind: tag.startsWith('HU-') ? 'crate' : 'item', name: `Piece ${tag}`,
  is_high_value: false, status: 'planned', flag: null, added_in_field: false, pickup_stop_id: null, dropoff_stop_id: 'stop-1', dropoff_place: 'Gulf Machine',
  delivered_stop_id: null, delivered_place: null, is_current_position: false, on_at: null, off_at: null, ...extra,
});
const reference = (extra = {}) => ({
  units: [unit('HU-AAAA01'), unit('HU-WOFF01', { status: 'written_off', top_status: 'written_off' }), unit('HU-INWO01', { parent_code: 'HU-WOFF01', top_code: 'HU-WOFF01', top_status: 'written_off' })],
  items: [],
  places: [
    { id: 'yard', kind: 'yard', name: 'Training Yard', project_id: 'project-a', city: null, state: null },
    { id: 'shop', kind: 'outside_shop', name: 'Gulf Machine', project_id: null, city: null, state: null },
    { id: 'vendor', kind: 'vendor', name: 'Valve Co', project_id: null, city: null, state: null },
    { id: 'site', kind: 'site', name: 'North Site', project_id: 'project-a', city: null, state: null },
  ],
  materials: [{ id: 'm-2', tag: 'PIPE-2', name: 'Pipe 4"', quantity: 3 }, { id: 'm-5', tag: 'PIPE-5', name: 'Pipe 8"', quantity: 1 }],
  counted: [{ uid: 'u-1', tag: 'GT-1', name: 'Cooler', quantity: 1, uom: 'EA', status: 'counted' }, { uid: 'u-9', tag: 'GT-9', name: 'Pump', quantity: 1, uom: 'EA', status: 'written_off' }],
  loads: [load('load-a'), load('load-b', { load_number: 'L-0007', status: 'planning' }), load('load-c', { load_number: 'L-0009', status: 'in_transit' })],
  stops: [stop('stop-1', 1, 'shop', 'Gulf Machine'), stop('stop-2', 2, 'site', 'North Site', 'both'), stop('stop-b', 1, 'shop', 'Gulf Machine', 'dropoff', { load_id: 'load-b' }), stop('stop-c', 1, 'site', 'North Site', 'dropoff', { load_id: 'load-c' })],
  lines: [
    line('HU-AAAA01'),
    line('PIPE-2', { load_id: 'load-b', load_number: 'L-0007', dropoff_stop_id: 'stop-b' }),
    line('PIPE-5', { load_id: 'load-c', load_number: 'L-0009', load_status: 'in_transit', dropoff_stop_id: 'stop-c' }),
  ],
  companies: [],
  savedAt: '2026-10-31T08:00:00Z',
  ...extra,
});
const ix = (ref = reference()) => loads.indexLoads(ref);
const cx = (ref = reference()) => crates.indexLoad(ref);
const on = (op, loadId = 'load-a') => ({ type: 'load_on', payload: { op: { loadId, ...op }, label: 'L-0003' } });
const off = (op, loadId = 'load-a') => ({ type: 'load_off', payload: { op: { loadId, ...op }, label: 'L-0003' } });

test('the licence before leaving: crews need it; office staff can leave without it, giving a reason of 5 to 500 characters', () => {
  const ref = reference({ lines: [line('HU-AAAA01', { status: 'on_board', on_at: 'x' })] });
  const crew = loads.departCheck(ix(ref), 'load-a');
  assert.match(crew.issue, /Record the driver's licence/);
  assert.equal(crew.licenceMissing, true);
  assert.match(loads.departCheck(ix(ref), 'load-a', false, 'Checked by phone').issue, /Record the driver's licence/, 'a crew can never override');
  assert.match(loads.departCheck(ix(ref), 'load-a', true).issue, /Record the driver's licence/, 'not overriding until asked');
  assert.match(loads.departCheck(ix(ref), 'load-a', true, '').issue, /at least 5 characters/);
  assert.match(loads.departCheck(ix(ref), 'load-a', true, ' abc ').issue, /at least 5 characters/);
  assert.match(loads.departCheck(ix(ref), 'load-a', true, 'x'.repeat(501)).issue, /500 characters/);
  assert.equal(loads.departCheck(ix(ref), 'load-a', true, 'Checked by phone').issue, null);
  const filed = reference({ loads: [load('load-a', { licence_recorded_at: '2026-10-31T09:00:00Z' })], lines: ref.lines });
  assert.deepEqual(plain(loads.departCheck(ix(filed), 'load-a')), { issue: null, behind: [], licenceMissing: false });
  const unnamed = reference({ loads: [load('load-a', { driver_name: null })], lines: ref.lines });
  assert.match(loads.departCheck(ix(unnamed), 'load-a', true, 'Checked by phone').issue, /driver's name/, 'the name is still needed');
});

test('stops: the office plans them, except on a load a crew started; after leaving, office staff change only the stops not yet reached', () => {
  assert.equal(loads.stopRights(undefined, false), 'all', 'a new load is the crew’s');
  assert.equal(loads.stopRights(load('a', { started_in_field: true }), false), 'all');
  assert.equal(loads.stopRights(load('a', { started_in_field: false }), false), 'none', 'the office’s load');
  assert.equal(loads.stopRights(load('a', { status: 'loading' }), true), 'all');
  assert.equal(loads.stopRights(load('a', { status: 'in_transit', started_in_field: true }), false), 'none');
  assert.equal(loads.stopRights(load('a', { status: 'in_transit' }), true), 'pending');
  assert.equal(loads.stopRights(load('a', { status: 'delivered' }), true), 'none');

  const before = [stop('stop-1', 1, 'shop', 'Gulf Machine', 'dropoff', { status: 'done' }), stop('stop-2', 2, 'site', 'North Site', 'both')];
  const draft = { originPlaceId: 'yard', plannedDate: '', truckType: '', truckNumber: 'T-1', trailerNumber: '', bolNumber: '', notes: '',
    stops: [{ id: 'stop-1', placeId: 'shop', kind: 'dropoff' }, { id: 'stop-2', placeId: 'site', kind: 'dropoff' }, { id: 'stop-3', placeId: 'vendor', kind: 'dropoff' }] };
  assert.equal(loads.loadEditIssue(draft, 'pending', [], before), null, 'a stop still to come changes and one is added');
  assert.match(loads.loadEditIssue({ ...draft, stops: draft.stops.slice(1) }, 'pending', [], before), /Stop 1 \(Gulf Machine\) has been reached; it stays on the load/);
  assert.match(loads.loadEditIssue({ ...draft, stops: [{ id: 'stop-1', placeId: 'shop', kind: 'both' }, ...draft.stops.slice(1)] }, 'pending', [], before), /its place and kind can't change/);
  assert.equal(loads.loadEditIssue({ ...draft, stops: [] }, 'none', [], before), null, 'stops aren’t checked when they aren’t sent');
  const loaded = load('load-a', { status: 'in_transit', truck_number: '' });
  assert.deepEqual(plain(loads.loadSavePayload('load-a', draft, loaded, before, 'none')), { loadId: 'load-a', truckNumber: 'T-1' }, 'a crew on the office’s load changes the truck, not the stops');
  assert.equal(plain(loads.loadSavePayload('load-a', draft, loaded, before, 'pending')).stops.length, 3);

  // After leaving, the office's stop change keeps what the truck reached; with none left to reach, the load is delivered.
  const transit = reference({ loads: [load('load-a', { status: 'in_transit' })], stops: before });
  const changed = loads.applyLoadPending(transit, [{ type: 'load_save', payload: { op: { loadId: 'load-a', stops: [{ id: 'stop-1', placeId: 'shop', kind: 'dropoff' }] }, label: 'L-0003' } }]);
  assert.equal(changed.stops.find(s => s.id === 'stop-1').status, 'done');
  assert.equal(changed.loads.find(l => l.id === 'load-a').status, 'delivered');
  const created = loads.applyLoadPending(reference({ loads: [] }), [{ type: 'load_save', payload: { op: { loadId: 'load-new' }, label: 'New load' } }]);
  assert.equal(created.loads[0].started_in_field, true, 'a load made here is the crew’s to plan until the server says otherwise');
});

test('loading a piece another load has planned: offered as a move while that load hasn’t left, and the move takes it off that plan', () => {
  const ref = reference();
  const scan = loads.classifyLoadOn(cx(ref), ix(ref), 'load-a', 'PIPE-2');
  assert.equal(scan.kind, 'unplanned');
  assert.equal(scan.from, 'L-0007');
  assert.match(scan.message, /planned on load L-0007\. To move it to this load, choose where it comes off/);
  assert.equal(loads.classifyLoadOn(cx(ref), ix(ref), 'load-a', 'pipe-2').from, 'L-0007', 'a tag in other capitals is the same tag');
  assert.match(loads.classifyLoadOn(cx(ref), ix(ref), 'load-a', 'PIPE-5').message, /already on load L-0009/, 'that load has left');
  const boarded = reference({ lines: [...ref.lines.slice(0, 1), line('PIPE-2', { load_id: 'load-b', load_number: 'L-0007', dropoff_stop_id: 'stop-b', status: 'on_board' })] });
  assert.equal(loads.classifyLoadOn(cx(boarded), ix(boarded), 'load-a', 'PIPE-2').kind, 'refuse');
  const lost = reference({ lines: [...ref.lines.slice(0, 1), line('PIPE-2', { load_id: 'load-b', load_number: 'L-0007', dropoff_stop_id: 'stop-b', status: 'missing' })] });
  assert.match(loads.classifyLoadOn(cx(lost), ix(lost), 'load-a', 'PIPE-2').message, /missing from load L-0007; scan it there or the office marks it found first/);

  const without = loads.applyLoadPending(ref, [on({ pieces: [{ code: 'PIPE-2', dropoffStopId: 'stop-2' }] })]);
  assert.equal(without.lines.filter(l => l.tag === 'PIPE-2').length, 1, 'without move the server refuses it: nothing changes here');
  const moved = loads.applyLoadPending(ref, [on({ pieces: [{ code: 'PIPE-2', dropoffStopId: 'stop-2', move: true }] })]);
  assert.deepEqual(plain(moved.lines.filter(l => l.tag === 'PIPE-2').map(l => [l.load_id, l.status])), [['load-b', 'removed'], ['load-a', 'on_board']]);
  assert.equal(moved.loads.find(l => l.id === 'load-b').planned_count, 0);
  const late = loads.applyLoadPending(ref, [on({ pieces: [{ code: 'PIPE-5', dropoffStopId: 'stop-2', move: true }] })]);
  assert.equal(late.lines.find(l => l.tag === 'PIPE-5').load_id, 'load-c', 'never off a load that has left');
});

test('load_on as the server applies it: a missing piece changes nothing, one left behind is reused, and only a piece taken marks a stop arrived', () => {
  const ref = reference({ loads: [load('load-a', { status: 'in_transit' })], lines: [line('HU-AAAA01', { status: 'missing' }), line('GT-1', { status: 'not_loaded', dropoff_stop_id: 'stop-2' })] });
  const result = loads.applyLoadPending(ref, [on({ pieces: ['HU-AAAA01', 'GT-1'], stopId: 'stop-2' })]);
  assert.deepEqual(plain(result.lines.map(l => [l.tag, l.status])), [['HU-AAAA01', 'missing'], ['GT-1', 'on_board']]);
  assert.equal(result.lines.length, 2, 'no second line');
  const nothing = loads.applyLoadPending(ref, [on({ pieces: ['HU-WOFF01'], stopId: 'stop-2' })]);
  assert.equal(nothing.stops.find(s => s.id === 'stop-2').status, 'pending', 'a written-off crate isn’t taken, so the stop isn’t reached');
  assert.match(loads.classifyLoadOn(cx(ref), ix(ref), 'load-a', 'HU-WOFF01', 'stop-2').message, /written off; an administrator can undo that/);
  assert.match(loads.classifyLoadOn(cx(ref), ix(ref), 'load-a', 'HU-INWO01', 'stop-2').message, /written off/);
  assert.match(loads.classifyLoadOn(cx(ref), ix(ref), 'load-a', 'GT-9', 'stop-2').message, /written off/);
});

test('unloading until the load is closed: a finished stop and a delivered load take late scans, and a later scan elsewhere moves a delivered piece', () => {
  const delivered = reference({
    loads: [load('load-a', { status: 'delivered' })],
    stops: [stop('stop-1', 1, 'shop', 'Gulf Machine', 'dropoff', { status: 'done' }), stop('stop-2', 2, 'site', 'North Site', 'dropoff', { status: 'done' })],
    lines: [line('HU-AAAA01', { status: 'missing' }), line('GT-1', { status: 'delivered', delivered_stop_id: 'stop-1', delivered_place: 'Gulf Machine', dropoff_stop_id: 'stop-1' })],
  });
  assert.equal(loads.canUnload(delivered.loads[0]), true);
  assert.deepEqual(plain(loads.unloadStops(ix(delivered), 'load-a').map(s => s.id)), ['stop-1', 'stop-2']);
  assert.equal(loads.unloadStops(ix(reference({ loads: [load('load-a', { status: 'closed' })] })), 'load-a').length, 0, 'not once closed');
  assert.equal(loads.classifyUnload(cx(delivered), ix(delivered), 'load-a', 'stop-2', 'HU-AAAA01').kind, 'wrong_stop');
  assert.equal(loads.classifyUnload(cx(delivered), ix(delivered), 'load-a', 'stop-1', 'HU-AAAA01').kind, 'found');
  assert.equal(loads.classifyUnload(cx(delivered), ix(delivered), 'load-a', 'stop-1', 'GT-1').kind, 'already');
  assert.equal(loads.classifyUnload(cx(delivered), ix(delivered), 'load-a', 'stop-2', 'gt-1').kind, 'moved', 'off at another stop: this scan corrects where');
  assert.match(loads.classifyUnload(cx(delivered), ix(delivered), 'load-a', 'stop-2', 'gt-1').message, /recorded off at Gulf Machine\. This scan moves it here/);

  const after = loads.applyLoadPending(delivered, [off({ stopId: 'stop-1', pieces: ['HU-AAAA01'] }), off({ stopId: 'stop-2', pieces: ['GT-1'] })]);
  const found = after.lines.find(l => l.tag === 'HU-AAAA01'), movedHere = after.lines.find(l => l.tag === 'GT-1');
  assert.deepEqual([found.status, found.flag], ['delivered', 'found']);
  assert.deepEqual([movedHere.delivered_stop_id, movedHere.flag], ['stop-2', 'wrong_stop']);
  assert.equal(after.loads[0].missing_count, 0);
  // Moved on since: a scan here can't take it back.
  const since = reference({ ...delivered, lines: [...delivered.lines, line('GT-1', { id: 'line-gt1-b', load_id: 'load-b', load_number: 'L-0007', dropoff_stop_id: 'stop-b' })] });
  assert.match(loads.classifyUnload(cx(since), ix(since), 'load-a', 'stop-2', 'GT-1').message, /on load L-0007 now; it can't come off this load again/);
  assert.equal(loads.applyLoadPending(since, [off({ stopId: 'stop-2', pieces: ['GT-1'] })]).lines.find(l => l.id === 'line-GT-1').delivered_stop_id, 'stop-1');
  const writtenOff = reference({ loads: [load('load-a', { status: 'in_transit' })], lines: [line('HU-AAAA01', { status: 'written_off' })] });
  assert.match(loads.classifyUnload(cx(writtenOff), ix(writtenOff), 'load-a', 'stop-1', 'HU-AAAA01').message, /written off/);

  // Only office staff finish a stop at a shop or vendor; nobody finishes a finished one.
  assert.equal(loads.canFinishStop(stop('s', 1, 'shop', 'Gulf Machine', 'dropoff', { place_kind: 'vendor' }), false), false);
  assert.equal(loads.canFinishStop(stop('s', 1, 'shop', 'Gulf Machine', 'dropoff', { place_kind: 'vendor' }), true), true);
  assert.equal(loads.canFinishStop(stop('s', 1, 'yard', 'Training Yard', 'dropoff', { place_kind: 'yard' }), false), true);
  assert.equal(loads.canFinishStop(stop('s', 1, 'yard', 'Training Yard', 'dropoff', { place_kind: 'yard', status: 'done' }), true), false);
});

test('a partial step: the pieces taken go over the copy; each one turned down becomes its own step, with an ID made from the step’s', () => {
  const id = '0b0f6c2e-4a1d-4c3b-9b7e-0000000000ff';
  const payload = { op: { loadId: 'load-a', pieces: ['HU-AAAA01', { code: 'PIPE-2', dropoffStopId: 'stop-2' }], undo: ['GT-1'], partial: true, capturedAt: '2026-10-31T10:00:00.000Z' }, label: 'L-0003' };
  const refused = [
    { code: 'pipe-2', list: 'pieces', message: 'PIPE-2 is planned on load L-0007; move it to this load or take it off that plan first', sqlstate: '22023' },
    { code: 'GT-1', list: 'undo', message: "GT-1 isn't on the truck", sqlstate: '22023' },
  ];
  const { applied, steps } = loads.splitRefused('load_on', payload, refused, id);
  assert.deepEqual(plain(applied.op), { loadId: 'load-a', pieces: ['HU-AAAA01'], undo: [], partial: true, capturedAt: '2026-10-31T10:00:00.000Z' });
  assert.deepEqual(plain(steps.map(s => s.id)), [loads.derivedId(id, 0), loads.derivedId(id, 1)]);
  assert.deepEqual(plain(steps.map(s => s.id)), ['0b0f6c2e-4a1d-4c3b-9b7e-010000000100', '0b0f6c2e-4a1d-4c3b-9b7e-020000000101'], 'the same IDs every time the answer is read');
  assert.equal(loads.derivedId('0b0f6c2e-4a1d-4c3b-9b7e-ffffffffffff', 0), '0b0f6c2e-4a1d-4c3b-9b7e-010000000000', 'wraps within the UUID');
  assert.deepEqual(plain(steps[0].action), { type: 'load_on', payload: { op: { loadId: 'load-a', pieces: [{ code: 'PIPE-2', dropoffStopId: 'stop-2' }], capturedAt: '2026-10-31T10:00:00.000Z' }, label: 'L-0003' } }, 'sent whole if retried, so a second refusal stays on it');
  assert.deepEqual(plain(steps[1].action.payload.op), { loadId: 'load-a', pieces: [], undo: ['GT-1'], capturedAt: '2026-10-31T10:00:00.000Z' });
  assert.deepEqual(plain(steps.map(s => [s.error, s.code])), [[`pipe-2: ${refused[0].message}`, '22023'], ["GT-1: GT-1 isn't on the truck", '22023']]);
  assert.match(steps[0].error, loads.MOVE_REFUSAL);
  assert.deepEqual(plain(loads.withMove(steps[0].action.payload.op).pieces), [{ code: 'PIPE-2', dropoffStopId: 'stop-2', move: true }]);
  assert.deepEqual(plain(loads.withMove({ loadId: 'x', pieces: ['HU-1'] }).pieces), [{ code: 'HU-1', move: true }]);

  const unload = loads.splitRefused('load_off', { op: { loadId: 'load-a', stopId: 'stop-1', pieces: ['HU-AAAA01', 'GT-1'], zoneId: 'z', siteMapId: 'm', partial: true }, label: 'L-0003', zoneName: 'Bay 1' },
    [{ code: 'GT-1', message: 'GT-1 belongs to load L-0007', sqlstate: '22023' }], id);
  assert.deepEqual(plain(unload.applied.op.pieces), ['HU-AAAA01']);
  assert.deepEqual(plain(unload.steps[0].action.payload), { op: { loadId: 'load-a', stopId: 'stop-1', pieces: ['GT-1'], zoneId: 'z', siteMapId: 'm' }, label: 'L-0003', zoneName: 'Bay 1' });
});

test('crates under 022: written off can’t change, a crate moves as it is (keeping its seal), and a new place without an area clears the area', () => {
  const index = cx();
  assert.match(crates.labelIssue(index, 'HU-WOFF01'), /HU-WOFF01 was written off; an administrator can undo that/);
  assert.match(crates.unpackIssue(index.units.get('HU-INWO01')), /HU-WOFF01 was written off/);
  assert.match(crates.classifyScan(index, { code: 'HU-NEW001', add: [], remove: [] }, 'HU-WOFF01').message, /written off/);
  assert.match(crates.classifyScan(index, { code: 'HU-NEW001', add: [], remove: [] }, 'GT-9').message, /written off/);
  assert.equal(crates.STATUS_LABELS.written_off, 'Written off');
  assert.equal(crates.moveIssue(index.units.get('HU-AAAA01')), null);
  assert.match(crates.moveIssue(unit('HU-NEST01', { parent_code: 'HU-AAAA01', top_code: 'HU-AAAA01' })), /inside HU-AAAA01; move that crate instead/);
  assert.match(crates.moveIssue(unit('HU-TRUCK1', { status: 'on_load', top_status: 'on_load', load_number: 'L-0003' })), /on load L-0003/);

  const zoned = reference({ units: [unit('HU-AAAA01', { zone_id: 'bay-1', site_map_id: 'map-a', location: 'Bay 1' }), unit('HU-IN0001', { parent_code: 'HU-AAAA01', top_code: 'HU-AAAA01' })] });
  const moved = crates.indexLoad(loads.applyChanges(zoned, [{ type: 'move', payload: { move: { unitCode: 'hu-aaaa01', placeId: 'site' }, placeName: 'North Site' } }]));
  assert.deepEqual(plain(['status', 'place_id', 'place_name', 'zone_id', 'location'].map(k => moved.units.get('HU-AAAA01')[k])), ['sealed', 'site', 'North Site', null, null]);
  assert.equal(moved.units.get('HU-IN0001').place_id, 'site', 'what is inside goes with it');
  const rezoned = crates.indexLoad(loads.applyChanges(zoned, [{ type: 'move', payload: { move: { unitCode: 'HU-AAAA01', zoneId: 'bay-2', siteMapId: 'map-a' }, zoneName: 'Bay 2' } }]));
  assert.deepEqual(plain(['place_id', 'zone_id', 'location'].map(k => rezoned.units.get('HU-AAAA01')[k])), ['yard', 'bay-2', 'Bay 2']);
  const repacked = crates.indexLoad(crates.applyPending(zoned, [{ type: 'pack', payload: { pack: { unitCode: 'HU-AAAA01', placeId: 'site', seal: false } } }]));
  assert.equal(repacked.units.get('HU-AAAA01').zone_id, null, 'packed somewhere new without an area: the old area goes');
  const draft = { code: 'HU-AAAA01', before: crates.packBefore(zoned.units[0]), kind: 'crate', description: 'Crate HU-AAAA01', isHighValue: false, add: [], remove: [],
    location: { placeId: 'yard', placeName: 'Training Yard', siteMapId: 'map-a', zoneId: 'bay-2', zoneName: 'Bay 2' } };
  assert.deepEqual(plain(crates.buildPackPayload(draft, false)), { unitCode: 'HU-AAAA01', seal: false, placeId: 'yard', zoneId: 'bay-2', siteMapId: 'map-a' }, 'the place goes with a new area');
  assert.equal(crates.spelled(index, ' pipe-2 '), 'PIPE-2');
  assert.equal(crates.spelled(index, 'hu-aaaa01'), 'HU-AAAA01');
  assert.equal(crates.spelled(index, 'NEW-TAG'), 'NEW-TAG');
});

test('where an item is (item_positions), and what the material page, Count and Scan let the field do', () => {
  const at = (position, extra = {}) => ({ position, status: 'in_yard', tag: 'PIPE-2', load_number: null, crate_code: null, top_crate_code: null, place_name: null, place_kind: null, area: null, location_note: null, hold: null, ...extra });
  assert.equal(positions.positionText(at('on_load', { load_number: 'L-0003' })), 'On load L-0003');
  assert.equal(positions.positionText(at('missing', { load_number: 'L-0003' })), 'Missing from load L-0003');
  assert.equal(positions.positionText(at('in_crate', { crate_code: 'HU-IN0001', top_crate_code: 'HU-AAAA01', place_name: 'Training Yard', area: 'Bay 1' })), 'In crate HU-IN0001 (inside HU-AAAA01) at Training Yard · Bay 1');
  assert.equal(positions.positionText(at('at_place', { place_name: 'Gulf Machine' })), 'Gulf Machine');
  assert.equal(positions.positionText(at('gone', { status: 'written_off' })), 'Written off');
  assert.equal(positions.positionText(at('unknown')), 'Location not recorded');

  const packed = positions.materialActions(at('in_crate', { crate_code: 'HU-AAAA01' }), false);
  assert.match(packed.transfer, /packed in HU-AAAA01; take it out of the crate first/);
  assert.equal(packed.issue, null, 'issuing from a crate is allowed');
  assert.match(packed.ship, /office staff/);
  assert.match(positions.materialActions(at('in_crate', { crate_code: 'HU-AAAA01' }), true).ship, /packed in HU-AAAA01/);
  const truck = positions.materialActions(at('on_load', { load_number: 'L-0003' }), true);
  assert.ok(truck.transfer && truck.issue && truck.ship && truck.relocate, 'nothing while it travels');
  assert.match(positions.materialActions(at('at_place', { place_kind: 'outside_shop', place_name: 'Gulf Machine' }), false).transfer, /at Gulf Machine; it comes back to the yard on a load/);
  const held = positions.materialActions(at('at_place', { place_kind: 'yard', hold: 'on_hold' }), false);
  assert.match(held.issue, /on hold; the office releases it/);
  assert.equal(held.holdOnly, true);
  assert.deepEqual(plain(positions.materialActions(at('at_place', { place_kind: 'yard', hold: 'on_hold' }), true)), { transfer: null, issue: null, ship: null, relocate: null, holdOnly: false }, 'office staff can');
  assert.equal(positions.materialActions(null, false).transfer, null, 'without the server’s answer the server decides');
  assert.match(positions.materialActions(at('gone', { status: 'written_off' }), true).issue, /written off/);

  const tag = (kind, extra = {}) => ({ kind, code: 'GT-1', can_receive: false, ...extra });
  assert.match(positions.countIssue(tag('crate', { code: 'HU-AAAA01' })), /HU- codes are crate labels/);
  assert.match(positions.countIssue(tag('received')), /already been received/);
  assert.match(positions.countIssue(tag('written_off')), /written off/);
  assert.match(positions.countIssue(tag('counted', { position: 'in_crate', crate_code: 'HU-AAAA01' })), /take it out of the crate before counting it/);
  assert.match(positions.countIssue(tag('counted', { position: 'on_load', load_number: 'L-0003' })), /count it when it comes off/);
  assert.equal(positions.countIssue(tag('expected', { position: 'unknown' })), null);
  assert.equal(positions.countIssue(null), null);

  assert.deepEqual(plain(positions.scanRoute(tag('received', { material_id: 'm-1' }))), { to: 'material', materialId: 'm-1' });
  assert.deepEqual(plain(positions.scanRoute(tag('counted', { can_receive: true }))), { to: 'receive' });
  assert.deepEqual(plain(positions.scanRoute(tag('unknown', { can_receive: true }))), { to: 'receive' });
  assert.match(positions.scanRoute(tag('counted', { position: 'on_load', load_number: 'L-0003' })).message, /receive it when it comes off/);
  assert.match(positions.scanRoute(tag('written_off')).message, /written off/);
  assert.deepEqual(plain(positions.scanRoute(tag('unused_label', { code: 'HU-NEW001' }))), { to: 'crate', code: 'HU-NEW001' });

  const maps = [{ id: 'yard-plan', place_id: 'yard' }, { id: 'loose', place_id: null }, { id: 'site-plan', place_id: 'site' }];
  assert.deepEqual(plain(positions.plansAt(maps, { id: 'yard', kind: 'yard' }).map(m => m.id)), ['yard-plan', 'loose']);
  assert.deepEqual(plain(positions.plansAt(maps, { id: 'shop', kind: 'outside_shop' }).map(m => m.id)), [], 'no areas at a shop or vendor');
  assert.equal(positions.plansAt(maps, null).length, 3);
});

test('project activity reads only the safe details, names loads from the device’s copy, and never shows a licence', () => {
  const row = (action, details = {}, extra = {}) => ({ id: action, created_at: '2026-10-31T10:00:00Z', user_id: 'u', user_name: 'Sam Ortiz', action, entity_type: 'load', entity_id: 'load-a', details, ...extra });
  const named = new Map([['load-a', 'L-0003']]);
  assert.deepEqual(plain(activity.describeActivity(row('load_loaded', { on: ['HU-1', 'HU-2'], moved_from: [{ code: 'HU-2', from: 'L-0007' }] }), named)),
    { id: 'load_loaded', type: 'load', description: 'Loaded L-0003', created_at: '2026-10-31T10:00:00Z', detail: '2 on · 1 moved from other loads — Sam Ortiz' });
  assert.equal(activity.describeActivity(row('load_departed', { not_loaded: 1 }), named).description, 'L-0003 left');
  assert.equal(activity.describeActivity(row('load_saved', { created: true })).description, 'Started a load', 'a load not on this device');
  assert.equal(activity.describeActivity(row('inventory_counted', { tag: 'GT-1', created: true })).detail, 'First count — Sam Ortiz');
  assert.equal(activity.describeActivity(row('handling_unit_packed', { added: ['A', 'B'], removed: [] })).detail, '2 in — Sam Ortiz');
  assert.equal(activity.describeActivity(row('item_relocated', { tag: 'PIPE-2', reason: 'Found on rack 4' })).description, 'Corrected where PIPE-2 is');
  assert.equal(activity.describeActivity(row('line_found', {})).type, 'load');
});

test('review fixes: late scans, corrections and moves follow the server; Ship Out of planned stock; positions for notes', () => {
  // A second phone's late load_on whose drop-off is already done: missing.
  const transit = reference({ loads: [load('load-a', { status: 'in_transit' })], stops: [stop('stop-1', 1, 'shop', 'Gulf Machine', 'dropoff', { status: 'done' }), stop('stop-2', 2, 'site', 'North Site')], lines: [line('HU-AAAA01')] });
  const late = loads.applyLoadPending(transit, [on({ pieces: ['HU-AAAA01'] })]);
  assert.equal(late.lines.find(l => l.tag === 'HU-AAAA01').status, 'missing');
  assert.equal(late.units.find(u => u.code === 'HU-AAAA01').status, 'missing');

  // A correction is refused once the piece travelled on another load since, or its crate changed.
  const base = { loads: [load('load-a', { status: 'delivered' }), load('load-b', { load_number: 'L-0007', status: 'delivered' })], stops: [stop('stop-1', 1, 'shop', 'Gulf Machine', 'dropoff', { status: 'done' }), stop('stop-2', 2, 'site', 'North Site', 'dropoff', { status: 'done' })] };
  const off1 = line('GT-1', { status: 'delivered', delivered_stop_id: 'stop-1', delivered_place: 'Gulf Machine', off_at: '2026-10-30T10:00:00Z' });
  const travelled = reference({ ...base, lines: [off1, line('GT-1', { id: 'line-b', load_id: 'load-b', load_number: 'L-0007', status: 'delivered', on_at: '2026-10-30T12:00:00Z', off_at: '2026-10-30T14:00:00Z' })] });
  assert.match(loads.classifyUnload(cx(travelled), ix(travelled), 'load-a', 'stop-2', 'GT-1').message, /travelled on another load since it came off here/);
  assert.equal(loads.applyLoadPending(travelled, [off({ stopId: 'stop-2', pieces: ['GT-1'] })]).lines.find(l => l.id === 'line-GT-1').delivered_stop_id, 'stop-1');
  const repacked = reference({ ...base, units: [unit('HU-AAAA01', { status: 'sealed' })], lines: [line('HU-AAAA01', { status: 'delivered', delivered_stop_id: 'stop-1', off_at: '2026-10-30T10:00:00Z' })] });
  assert.match(loads.classifyUnload(cx(repacked), ix(repacked), 'load-a', 'stop-2', 'HU-AAAA01').message, /HU-AAAA01 is sealed now; it can't come off this load again/);

  // A move without an area leaves the crate with none, at the same place too.
  const zoned = reference({ units: [unit('HU-AAAA01', { zone_id: 'z', site_map_id: 'map-a', location: 'Rack 1' })] });
  const moved = crates.indexLoad(loads.applyChanges(zoned, [{ type: 'move', payload: { move: { unitCode: 'HU-AAAA01', placeId: 'yard' } } }])).units.get('HU-AAAA01');
  assert.deepEqual(plain([moved.place_id, moved.zone_id, moved.location]), ['yard', null, null]);

  // A copy saved before this update doesn't say who started a load: the server decides.
  assert.equal(loads.stopRights(load('a', { started_in_field: undefined }), false), 'all');

  const planned = { position: 'at_place', status: 'in_yard', tag: 'PIPE-2', load_number: 'L-0007', line_status: 'planned', crate_code: null, place_name: 'Training Yard', place_kind: 'yard', hold: null };
  assert.match(positions.materialActions(planned, true).ship, /planned on load L-0007; take it off the load first/);
  assert.equal(positions.materialActions(planned, true).transfer, null);

  assert.deepEqual(plain(positions.positionNote({ kind: 'counted', code: 'GT-1', can_receive: true, position: 'in_crate', crate_code: 'HU-IN0001', top_crate_code: 'HU-AAAA01', place_name: 'Training Yard' })),
    { text: 'In crate HU-IN0001 (inside HU-AAAA01) at Training Yard', route: 'crate', params: { code: 'HU-AAAA01' } });
  assert.deepEqual(plain(positions.positionNote({ kind: 'received', code: 'GT-1', can_receive: false, position: 'missing', load_id: 'load-a', load_number: 'L-0003' })), { text: 'Missing from load L-0003', route: 'load', params: { id: 'load-a' } });
  assert.deepEqual(plain(positions.positionNote({ kind: 'counted', code: 'GT-1', can_receive: true, position: 'at_place', place_name: 'Gulf Machine' })), { text: 'Gulf Machine', route: null, params: {} });
  assert.equal(positions.positionNote({ kind: 'unknown', code: 'X', can_receive: true }), null);
  assert.match(positions.copyCountIssue(cx(reference({ items: [{ unit_code: 'HU-AAAA01', tag: 'GT-1', name: '', quantity: 1, uom: 'EA', material_id: null, inventory_uid: 'u-1' }] })), 'GT-1'), /packed in HU-AAAA01/);
});
