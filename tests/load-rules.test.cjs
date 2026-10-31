const test = require('node:test');
const assert = require('node:assert/strict');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

// The pure load rules in lib/logistics/loads.ts, against migration 022.
const loader = createModuleLoader();
const loads = loader.load('./lib/logistics/loads.ts');
const crates = loader.load('./lib/logistics/crates.ts');
const plain = (value) => JSON.parse(JSON.stringify(value));

const unit = (code, extra = {}) => ({
  id: `id-${code}`, code, kind: 'crate', description: `Crate ${code}`, is_high_value: false, status: 'sealed', parent_id: null, parent_code: null, top_code: code,
  place_id: 'yard', place_name: 'Training Yard', site_map_id: null, zone_id: null, location: null, item_count: 1, unit_count: 0,
  top_status: 'sealed', load_id: null, load_number: null, load_line_status: null, ...extra,
});
const load = (id, extra = {}) => ({
  id, load_number: 'L-0003', status: 'planning', origin_place_id: 'yard', origin_name: 'Training Yard', planned_date: null, truck_type: null, truck_number: null,
  trailer_number: null, bol_number: null, driver_name: null, driver_phone: null, licence_recorded_at: null, notes: null, stop_count: 2, stops_done: 0,
  next_stop: 'Gulf Machine', planned_count: 2, on_board_count: 0, delivered_count: 0, missing_count: 0, flagged_count: 0, departed_at: null, updated_at: null, ...extra,
});
const stop = (id, seq, place_id, place_name, kind = 'dropoff', extra = {}) => ({ id, load_id: 'load-a', seq, place_id, place_name, kind, planned_date: null, status: 'pending', due_count: 0, delivered_count: 0, missing_count: 0, ...extra });
const line = (tag, extra = {}) => ({
  id: `line-${tag}`, load_id: 'load-a', load_number: 'L-0003', load_status: 'planning', tag, piece_kind: tag.startsWith('HU-') ? 'crate' : 'item', name: `Piece ${tag}`,
  is_high_value: false, status: 'planned', flag: null, added_in_field: false, pickup_stop_id: null, dropoff_stop_id: 'stop-1', dropoff_place: 'Gulf Machine',
  delivered_stop_id: null, delivered_place: null, is_current_position: false, on_at: null, off_at: null, ...extra,
});
const reference = (extra = {}) => ({
  units: [unit('HU-AAAA01', { load_id: 'load-a', load_number: 'L-0003', load_line_status: 'planned' }), unit('HU-INNER1', { parent_code: 'HU-BOX001', top_code: 'HU-BOX001' }), unit('HU-BOX001'), unit('HU-GONE01', { status: 'unpacked', top_status: 'unpacked' })],
  items: [{ unit_code: 'HU-BOX001', tag: 'PIPE-9', name: 'Packed pipe', quantity: 1, uom: 'EA', material_id: 'm-9', inventory_uid: null }],
  places: [
    { id: 'yard', kind: 'yard', name: 'Training Yard', project_id: 'project-a', city: null, state: null },
    { id: 'shop', kind: 'outside_shop', name: 'Gulf Machine', project_id: null, city: null, state: null },
    { id: 'site', kind: 'site', name: 'North Site', project_id: 'project-a', city: null, state: null },
  ],
  materials: [{ id: 'm-2', tag: 'PIPE-2', name: 'Pipe 4"', quantity: 3 }, { id: 'm-3', tag: 'PIPE-3', name: 'Pipe 6"', quantity: 1 }, { id: 'm-9', tag: 'PIPE-9', name: 'Packed pipe', quantity: 1 }],
  counted: [{ uid: 'u-1', tag: 'GT-1', name: 'Cooler', quantity: 1, uom: 'EA', status: 'counted' }, { uid: 'u-2', tag: 'GT-2', name: 'Filter', quantity: 1, uom: 'EA', status: 'expected' }],
  loads: [load('load-a'), load('load-b', { load_number: 'L-0007', status: 'loading' })],
  stops: [stop('stop-1', 1, 'shop', 'Gulf Machine', 'dropoff'), stop('stop-2', 2, 'site', 'North Site', 'both'), stop('stop-b', 1, 'shop', 'Gulf Machine', 'dropoff', { load_id: 'load-b' })],
  lines: [line('HU-AAAA01'), line('PIPE-2', { dropoff_stop_id: 'stop-2', dropoff_place: 'North Site' }), line('PIPE-3', { load_id: 'load-b', load_number: 'L-0007', dropoff_stop_id: 'stop-b', status: 'on_board' })],
  companies: [],
  savedAt: '2026-10-31T08:00:00Z',
  ...extra,
});
const ix = (ref = reference()) => loads.indexLoads(ref);
const cx = (ref = reference()) => crates.indexLoad(ref);
const on = (op) => ({ type: 'load_on', payload: { op: { loadId: 'load-a', ...op }, label: 'L-0003' } });

test('check-in: the driver’s name, up to 3 named companies, and a licence (front photo) unless one is on file', () => {
  const ok = { driverName: ' Sam Ortiz ', driverPhone: '555 0100', companies: [{ name: 'Gulf Freight', role: 'broker', contactName: '', phone: '' }], licenceNumber: ' tx  1234-567 ', licenceState: 'TX', licenceExpiry: '2028-02-29', front: 'file:///f.jpg', back: null };
  assert.equal(loads.checkInIssue(ok, false), null);
  assert.deepEqual(plain(loads.checkInIssue({ ...ok, driverName: '  ' }, false)), { step: 0, message: 'Enter the driver’s name.' });
  assert.equal(loads.checkInIssue({ ...ok, companies: [...ok.companies, ...ok.companies, ...ok.companies] }, false), null, 'three is fine');
  assert.equal(loads.checkInIssue({ ...ok, companies: [...ok.companies, ...ok.companies, ...ok.companies, ...ok.companies] }, false).step, 1);
  assert.match(loads.checkInIssue({ ...ok, companies: [{ ...ok.companies[0], name: '' }] }, false).message, /Company 1 needs a name/);
  assert.match(loads.checkInIssue({ ...ok, companies: [{ ...ok.companies[0], role: 'owner' }] }, false).message, /role/);
  assert.match(loads.checkInIssue({ ...ok, licenceNumber: 'ab' }, false).message, /3 to 40 letters/);
  assert.match(loads.checkInIssue({ ...ok, licenceNumber: 'AB#12' }, false).message, /3 to 40 letters/);
  assert.match(loads.checkInIssue({ ...ok, licenceExpiry: '2027-02-29' }, false).message, /real date/);
  assert.match(loads.checkInIssue({ ...ok, front: null }, false).message, /photo of the front/);
  const none = { ...ok, licenceNumber: '', licenceState: '', licenceExpiry: '', front: null };
  assert.equal(loads.checkInIssue(none, false).step, 2, 'a licence is needed when none is on file');
  assert.equal(loads.checkInIssue(none, true), null, 'optional when one is on file');
  assert.equal(loads.checkInIssue({ ...none, front: 'file:///f.jpg' }, true).step, 2, 'once started, it has to be complete');

  const { save, licence } = loads.checkInPayloads('load-a', 'L-0003', ok);
  assert.deepEqual(plain(save), { loadId: 'load-a', driverName: 'Sam Ortiz', driverPhone: '555 0100', companies: [{ name: 'Gulf Freight', role: 'broker' }] });
  assert.deepEqual(plain(licence), { loadId: 'load-a', label: 'L-0003', licence: { number: 'TX 1234-567', state: 'TX', expiry: '2028-02-29' }, photos: [{ uri: 'file:///f.jpg' }] });
  assert.equal(JSON.stringify(save).includes('1234'), false, 'the number never goes in the load_save');
  assert.equal(loads.checkInPayloads('load-a', 'L-0003', none).licence, null);
});

test('the load-out checklist counts planned pieces here, and on-board ones, as "N of M on board"', () => {
  let list = loads.loadChecklist(ix(), 'load-a');
  assert.deepEqual([list.onBoard, list.total], [0, 2]);
  const after = ix(loads.applyLoadPending(reference(), [on({ pieces: ['hu-aaaa01'] })]));
  list = loads.loadChecklist(after, 'load-a');
  assert.equal(loads.checklistText(list), '1 of 2 on board');
  assert.equal(after.loads.get('load-a').status, 'loading', 'the first piece on makes it loading');
  assert.equal(crates.indexLoad(loads.applyLoadPending(reference(), [on({ pieces: ['HU-AAAA01'] })])).units.get('HU-AAAA01').status, 'on_load');
  // A pick-up stop's list is what is picked up there.
  const pickup = ix(reference({ lines: [...reference().lines, line('GT-1', { pickup_stop_id: 'stop-2', dropoff_stop_id: 'stop-1' })] }));
  assert.equal(loads.loadChecklist(pickup, 'load-a', 'stop-2').total, 1);
  assert.equal(loads.loadChecklist(pickup, 'load-a').total, 2);
});

test('load-out scans: planned ones tick; unplanned ones ask for a drop-off; the copy warns about other loads, crates inside crates and packed items', () => {
  const kind = (raw, at = null) => loads.classifyLoadOn(cx(), ix(), 'load-a', raw, at);
  assert.equal(kind('hu-aaaa01').kind, 'planned');
  assert.equal(kind('PIPE-3').message, 'PIPE-3 is already on load L-0007.');
  assert.equal(kind('HU-INNER1').message, "HU-INNER1 is inside HU-BOX001; a crate travels with the crate it's in.");
  assert.equal(kind('PIPE-9').message, 'PIPE-9 is packed in HU-BOX001; load the crate instead.');
  assert.match(kind('HU-GONE01').message, /unpacked; it can't go on a load/);
  assert.match(kind('GT-2').message, /isn't a crate label or a received or counted item/);
  const unplanned = kind('GT-1');
  assert.equal(unplanned.kind, 'unplanned');
  assert.equal(unplanned.unchecked, false);
  assert.equal(kind('NEW-TAG').unchecked, true, 'not on the device: the server checks it');
  assert.equal(kind('HU-BOX001').kind, 'unplanned');
  assert.equal(kind('PIPE-2', 'stop-2').kind, 'refuse', 'planned at the origin, not this pick-up stop');
  assert.equal(loads.classifyLoadOn(cx(), ix(loads.applyLoadPending(reference(), [on({ pieces: ['PIPE-2'] })])), 'load-a', 'PIPE-2').kind, 'already');
  // Drop-offs: not a pick-up-only stop, not done, and after the pick-up stop.
  assert.deepEqual(plain(loads.dropoffChoices(ix(), 'load-a').map(s => s.id)), ['stop-1', 'stop-2']);
  assert.deepEqual(plain(loads.dropoffChoices(ix(), 'load-a', 'stop-1').map(s => s.id)), ['stop-2']);
});

test('an unplanned piece goes on with its drop-off stop; undo takes a piece off (or off the list if it was added here)', () => {
  const ref = reference();
  let after = loads.applyLoadPending(ref, [on({ pieces: [{ code: 'GT-1', dropoffStopId: 'stop-2' }, 'PIPE-2'] })]);
  let added = after.lines.find(l => l.tag === 'GT-1');
  assert.deepEqual(plain([added.status, added.added_in_field, added.dropoff_stop_id, added.dropoff_place, added.name]), ['on_board', true, 'stop-2', 'North Site', 'Cooler']);
  assert.equal(loads.applyLoadPending(ref, [on({ pieces: ['GT-1'] })]).lines.some(l => l.tag === 'GT-1'), false, 'without a drop-off the server refuses, so nothing changes');
  after = loads.applyLoadPending(after, [on({ pieces: [], undo: ['GT-1', 'PIPE-2'] })]);
  assert.equal(after.lines.find(l => l.tag === 'GT-1').status, 'removed');
  assert.equal(after.lines.find(l => l.tag === 'PIPE-2').status, 'planned');
  // A crate taken off goes back to how it was.
  const crate = loads.applyLoadPending(loads.applyLoadPending(ref, [on({ pieces: ['HU-AAAA01'] })]), [on({ pieces: [], undo: ['HU-AAAA01'] })]);
  assert.equal(crate.units.find(u => u.code === 'HU-AAAA01').status, 'sealed');
  const twice = [on({ pieces: ['PIPE-2'] }), on({ pieces: ['PIPE-2'] })];
  assert.deepEqual(plain(loads.applyLoadPending(ref, twice).lines), plain(loads.applyLoadPending(ref, twice.slice(0, 1)).lines), 'replaying changes nothing');
});

test('a load made offline is checked in, loaded, sent off, unloaded and finished before it syncs', () => {
  const ref = reference({ loads: [], stops: [], lines: [] });
  const id = 'load-new';
  const act = (type, op, extra = {}) => ({ type, payload: { op: { loadId: id, ...op }, label: 'New load', ...extra } });
  const steps = [
    act('load_save', { originPlaceId: 'yard', stops: [{ id: 's1', placeId: 'shop', kind: 'dropoff' }, { id: 's2', placeId: 'site', kind: 'both' }] }),
    act('load_save', { driverName: 'Sam Ortiz', companies: [{ name: 'Gulf Freight', role: 'carrier' }] }),
    { type: 'licence', payload: { loadId: id, label: 'New load', licence: { number: 'TX123' }, photos: [] } },
    act('load_on', { pieces: [{ code: 'HU-BOX001', dropoffStopId: 's1' }, { code: 'GT-1', dropoffStopId: 's2' }] }),
    act('load_depart', {}),
    // An area at an outside shop is refused by the server: nothing changes.
    act('load_off', { stopId: 's1', pieces: ['HU-BOX001'], zoneId: 'z-1', siteMapId: 'map-a' }, { zoneName: 'Bay 1' }),
    act('load_off', { stopId: 's1', pieces: ['HU-BOX001'] }),
    act('stop_complete', { stopId: 's1' }),
  ];
  let result = loads.applyLoadPending(ref, steps);
  let x = loads.indexLoads(result);
  const made = x.loads.get(id);
  assert.equal(loads.loadLabel(made), 'New load');
  assert.equal(made.status, 'in_transit');
  assert.equal(made.origin_name, 'Training Yard');
  assert.equal(made.driver_name, 'Sam Ortiz');
  assert.equal(made.licence_waiting, true);
  assert.equal(JSON.stringify(result).includes('TX123'), false, 'the licence number never reaches the device’s picture');
  assert.deepEqual(plain([made.delivered_count, made.on_board_count, made.stops_done, made.next_stop]), [1, 1, 1, 'North Site']);
  const box = result.units.find(u => u.code === 'HU-BOX001');
  assert.deepEqual(plain([box.status, box.place_name, box.zone_id]), ['delivered', 'Gulf Machine', null], 'an area only at our own place (the shop is not)');
  const ours = loads.applyLoadPending(result, [act('load_off', { stopId: 's2', pieces: ['GT-1'], zoneId: 'z-1', siteMapId: 'map-a' }, { zoneName: 'Bay 1' })]);
  assert.equal(loads.indexLoads(ours).position.get('GT-1').delivered_place, 'North Site', 'our own site takes an area');
  const inner = crates.indexLoad(result).units.get('HU-INNER1');
  assert.equal(inner.top_status, 'delivered');

  // Finishing the last stop with a piece still on board marks it missing and delivers the load.
  result = loads.applyLoadPending(result, [act('stop_complete', { stopId: 's2' })]);
  x = loads.indexLoads(result);
  assert.equal(x.loads.get(id).status, 'delivered');
  assert.equal(x.position.get('GT-1').status, 'missing');
});

test('departing needs the driver’s name and something on board; planned pieces left off stay behind', () => {
  assert.match(loads.departCheck(ix(), 'load-a').issue, /driver's name/);
  const named = reference({ loads: [load('load-a', { driver_name: 'Sam' })] });
  assert.equal(loads.departCheck(ix(named), 'load-a').issue, 'Nothing is on the truck yet.');
  const loaded = loads.applyLoadPending(named, [on({ pieces: ['HU-AAAA01'] })]);
  const check = loads.departCheck(ix(loaded), 'load-a');
  assert.equal(check.issue, null);
  assert.deepEqual(plain(check.behind.map(l => l.tag)), ['PIPE-2']);
  const gone = loads.applyLoadPending(loaded, [{ type: 'load_depart', payload: { op: { loadId: 'load-a' }, label: 'L-0003' } }]);
  assert.equal(gone.lines.find(l => l.tag === 'PIPE-2').status, 'not_loaded');
  assert.equal(gone.loads.find(l => l.id === 'load-a').status, 'in_transit');
});

test('unloading: due pieces tick; a piece due elsewhere is the wrong stop; one not on the list is an extra; another load’s piece is refused', () => {
  const ref = loads.applyLoadPending(reference({ loads: [load('load-a', { driver_name: 'Sam' }), load('load-b', { load_number: 'L-0007', status: 'loading' })] }),
    [on({ pieces: ['HU-AAAA01', 'PIPE-2'] }), { type: 'load_depart', payload: { op: { loadId: 'load-a' }, label: 'L-0003' } }]);
  const kind = (raw) => loads.classifyUnload(cx(ref), ix(ref), 'load-a', 'stop-1', raw);
  assert.equal(kind('hu-aaaa01').kind, 'due');
  assert.match(kind('PIPE-2').message, /due at North Site.*wrong stop/);
  assert.equal(kind('GT-1').kind, 'extra');
  assert.equal(kind('PIPE-3').message, 'PIPE-3 belongs to load L-0007.');
  assert.match(kind('PIPE-9').message, /packed in HU-BOX001/);
  const off = loads.applyLoadPending(ref, [{ type: 'load_off', payload: { op: { loadId: 'load-a', stopId: 'stop-1', pieces: ['HU-AAAA01', 'PIPE-2', 'GT-1'] }, label: 'L-0003' } }]);
  const list = loads.unloadChecklist(ix(off), 'load-a', 'stop-1');
  assert.deepEqual([list.offCount, list.total], [1, 1]);
  assert.deepEqual(plain(list.extras.map(l => [l.tag, l.flag])).sort(), [['GT-1', 'extra'], ['PIPE-2', 'wrong_stop']]);
  assert.equal(loads.classifyUnload(cx(off), ix(off), 'load-a', 'stop-1', 'HU-AAAA01').kind, 'already');
  // Finishing the stop: what was due here and not scanned becomes missing.
  const due = loads.applyLoadPending(ref, [{ type: 'stop_complete', payload: { op: { loadId: 'load-a', stopId: 'stop-1' }, label: 'L-0003' } }]);
  assert.equal(due.lines.find(l => l.tag === 'HU-AAAA01').status, 'missing');
  assert.equal(due.units.find(u => u.code === 'HU-AAAA01').status, 'missing');
  assert.equal(crates.unitLoadText(due.units.find(u => u.code === 'HU-AAAA01')), 'Missing from L-0003');
});

test('the load editor sends only what changed; stops go only before the truck leaves', () => {
  const draft = { originPlaceId: 'yard', plannedDate: '2026-11-04', truckType: 'Flatbed', truckNumber: '', trailerNumber: '', bolNumber: '', notes: '', stops: [{ id: 's1', placeId: 'shop', kind: 'dropoff' }] };
  assert.deepEqual(plain(loads.loadSavePayload('load-new', draft, undefined, [], false)), { loadId: 'load-new', originPlaceId: 'yard', plannedDate: '2026-11-04', truckType: 'Flatbed', stops: [{ id: 's1', placeId: 'shop', kind: 'dropoff' }] });
  const before = load('load-a', { planned_date: '2026-11-04', truck_type: 'Flatbed' });
  const stops = [stop('s1', 1, 'shop', 'Gulf Machine')];
  assert.deepEqual(plain(loads.loadSavePayload('load-a', draft, before, stops, false)), { loadId: 'load-a' });
  assert.deepEqual(plain(loads.loadSavePayload('load-a', { ...draft, truckNumber: 'T-9', stops: [...draft.stops, { id: 's2', placeId: 'site', kind: 'both' }] }, before, stops, true)), { loadId: 'load-a', truckNumber: 'T-9' }, 'no stops after leaving');
  assert.equal(loads.loadEditIssue({ ...draft, originPlaceId: null }, false), 'Choose where the load starts.');
  assert.equal(loads.loadEditIssue({ ...draft, stops: [] }, false), 'Add at least one stop.');
  assert.match(loads.loadEditIssue({ ...draft, stops: [{ id: 's1', placeId: 'shop', kind: 'pickup' }] }, false), /drop-off/);
  assert.match(loads.loadEditIssue({ ...draft, plannedDate: '2026-02-30' }, false), /real date/);
});

test('crates follow 022: delivered crates can change, crates on a truck or planned can’t', () => {
  const ix2 = crates.indexLoad({ ...reference(), units: [
    unit('HU-DLVR01', { status: 'delivered', top_status: 'delivered' }),
    unit('HU-ONLD01', { status: 'on_load', top_status: 'on_load', load_id: 'load-a', load_number: 'L-0003', load_line_status: 'on_board' }),
    unit('HU-NEST01', { parent_code: 'HU-ONLD01', top_code: 'HU-ONLD01', top_status: 'on_load', load_number: 'L-0003', load_line_status: 'on_board' }),
    unit('HU-MISS01', { status: 'missing', top_status: 'missing', load_number: 'L-0003', load_line_status: 'missing' }),
    unit('HU-PLAN01', { load_id: 'load-a', load_number: 'L-0003', load_line_status: 'planned' }),
  ] });
  assert.equal(crates.labelIssue(ix2, 'HU-DLVR01'), null);
  assert.equal(crates.labelIssue(ix2, 'HU-ONLD01'), 'HU-ONLD01 is on load L-0003; unload it first.');
  assert.equal(crates.labelIssue(ix2, 'HU-NEST01'), 'HU-NEST01 is inside HU-ONLD01, which is on load L-0003; unload it first.');
  assert.equal(crates.labelIssue(ix2, 'HU-MISS01'), 'HU-MISS01 is missing from load L-0003; the office marks it found first.');
  assert.equal(crates.unpackIssue(ix2.units.get('HU-PLAN01')), 'HU-PLAN01 is planned on load L-0003; take it off the load first.');
  assert.equal(crates.unpackIssue(ix2.units.get('HU-DLVR01')), null);
  assert.equal(crates.unitLoadText(ix2.units.get('HU-PLAN01')), 'Planned on L-0003');
  assert.equal(crates.unitLoadText(ix2.units.get('HU-ONLD01')), 'On load L-0003');
  const draft = { code: 'HU-NEW001', add: [], remove: [] };
  assert.match(crates.classifyScan(ix2, draft, 'HU-PLAN01').message, /planned on load L-0003; take it off the load first/);
  assert.equal(crates.classifyScan(ix2, draft, 'HU-DLVR01').kind, 'add', 'a delivered crate can go inside another');
  const items = crates.indexLoad(reference());
  assert.equal(crates.classifyScan(items, draft, 'PIPE-2').message, 'PIPE-2 is on load L-0003; take it off the load first.');
});

test('review fixes: check-in sends only changes; stop dates are kept; stops still needed can’t go', () => {
  const start = { driverName: 'Sam Ortiz', driverPhone: '555 0100', companies: [{ name: 'Gulf Freight', role: 'carrier', contactName: '', phone: '' }] };
  const draft = { ...start, companies: start.companies.map(c => ({ ...c })), licenceNumber: '', licenceState: '', licenceExpiry: '', front: null, back: null };
  assert.equal(loads.checkInPayloads('load-a', 'L-0003', draft, start).save, null, 'nothing changed: the office’s details stay as they are');
  assert.deepEqual(plain(loads.checkInPayloads('load-a', 'L-0003', { ...draft, driverPhone: '555 0199' }, start).save), { loadId: 'load-a', driverPhone: '555 0199' });
  assert.deepEqual(plain(loads.checkInPayloads('load-a', 'L-0003', { ...draft, companies: [] }, start).save), { loadId: 'load-a', companies: [] }, 'removing companies is a change');

  const dated = [{ ...stop('s1', 1, 'shop', 'Gulf Machine'), planned_date: '2026-11-05' }];
  const edit = { originPlaceId: 'yard', plannedDate: '', truckType: '', truckNumber: '', trailerNumber: '', bolNumber: '', notes: '',
    stops: [{ id: 's1', placeId: 'shop', kind: 'both', plannedDate: '2026-11-05' }] };
  assert.deepEqual(plain(loads.loadSavePayload('load-a', edit, load('load-a'), dated, false).stops), [{ id: 's1', placeId: 'shop', kind: 'both', plannedDate: '2026-11-05' }], 'the office’s stop date is sent back');

  const before = [stop('stop-1', 1, 'shop', 'Gulf Machine'), stop('stop-2', 2, 'site', 'North Site', 'both')];
  const manifest = [line('HU-AAAA01'), line('GT-1', { pickup_stop_id: 'stop-2', dropoff_stop_id: 'stop-1' })];
  const base = { ...edit, stops: [{ id: 'stop-1', placeId: 'shop', kind: 'dropoff' }, { id: 'stop-2', placeId: 'site', kind: 'both' }] };
  assert.match(loads.loadEditIssue({ ...base, stops: [base.stops[1]] }, false, manifest, before), /The stop at Gulf Machine still has pieces planned for it/);
  assert.match(loads.loadEditIssue({ ...base, stops: [{ ...base.stops[0], kind: 'pickup' }, base.stops[1]] }, false, manifest, before), /drop-off stop after its pick-up stop/);
  assert.match(loads.loadEditIssue(base, false, manifest, before), /drop-off stop after its pick-up stop/, 'GT-1 is picked up at stop 2 but drops at stop 1');
  assert.equal(loads.loadEditIssue({ ...base, stops: [base.stops[1], base.stops[0]] }, false, manifest, before), null, 'reordered so it works');
});

test('review fixes: load-out and unload checks follow the server', () => {
  const ref = reference({ lines: [...reference().lines, line('GT-1', { pickup_stop_id: 'stop-1', dropoff_stop_id: 'stop-2' }), line('PIPE-M', { status: 'missing', on_at: 'x' })] });
  assert.equal(loads.classifyLoadOn(cx(ref), ix(ref), 'load-a', 'GT-1').kind, 'planned', 'a planned pick-up can go on here instead');
  assert.match(loads.classifyLoadOn(cx(ref), ix(ref), 'load-a', 'PIPE-M').message, /missing from L-0003; the office marks it found first/);
  const done = reference({ stops: [{ ...stop('stop-1', 1, 'shop', 'Gulf Machine'), status: 'done' }, stop('stop-2', 2, 'site', 'North Site', 'both')] });
  assert.match(loads.classifyLoadOn(cx(done), ix(done), 'load-a', 'HU-AAAA01').message, /Gulf Machine is already done/);
  const left = reference({ loads: [load('load-a', { status: 'in_transit' })] });
  assert.match(loads.classifyLoadOn(cx(left), ix(left), 'load-a', 'HU-AAAA01').message, /has left; choose the pick-up stop/);
  assert.match(loads.classifyUnload(cx(), ix(), 'load-a', 'stop-1', 'GT-2').message, /isn't a crate label or a received or counted item/, 'an expected record would sink the batch');
  assert.equal(loads.classifyUnload(cx(), ix(), 'load-a', 'stop-1', 'NOT-A-TAG').unchecked, true);
  assert.equal(loads.classifyUnload(cx(), ix(), 'load-a', 'stop-1', 'GT-1').unchecked, false);
});

test('review fixes: saved changes apply in the order made (unloaded, then repacked)', () => {
  const ref = reference({ loads: [load('load-a', { status: 'in_transit', driver_name: 'Sam' })], lines: [line('HU-AAAA01', { status: 'on_board', on_at: 'x' })],
    units: [unit('HU-AAAA01', { status: 'on_load', top_status: 'on_load', load_id: 'load-a', load_number: 'L-0003', load_line_status: 'on_board' })] });
  const result = loads.applyChanges(ref, [
    { type: 'load_off', payload: { op: { loadId: 'load-a', stopId: 'stop-1', pieces: ['HU-AAAA01'] }, label: 'L-0003' } },
    { type: 'pack', payload: { pack: { unitCode: 'HU-AAAA01', add: ['PIPE-3'], seal: true } } },
  ]);
  const crate = crates.indexLoad(result).units.get('HU-AAAA01');
  assert.equal(crate.status, 'sealed', 'the pack applies after the unload');
  assert.equal(crates.indexLoad(result).crateOf.get('PIPE-3'), 'HU-AAAA01');
});
