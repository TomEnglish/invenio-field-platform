import type { QueueItem } from './offlineQueue';

export function queueSummary(item: QueueItem): { title: string; detail: string } {
  const payload = item.action?.payload ?? {};
  const names: Record<string, string> = {
    receiving:'Receiving', transfer:'Material transfer', issue:'Material issue', shipment:'Outbound shipment', count:'Inventory count', pack:'Crate packing', unpack:'Crate unpacking',
    load_save:'Load details', load_on:'Loading', load_depart:'Departure', load_off:'Unloading', stop_complete:'Stop finished', licence:'Driver licence',
  };
  const kind = names[item.action?.type] || 'Saved submission';
  if (item.action?.type === 'receiving') {
    const po = payload.po?.po_number;
    return { title: payload.material?.material_type || kind, detail: [kind,po ? (/^PO(?:\b|[-_])/i.test(po) ? po : `PO ${po}`) : 'PO not recorded',payload.material?.qty != null ? `${payload.material.qty} delivered` : null,payload.po?.vendor].filter(Boolean).join(' · ') };
  }
  if (item.action?.type === 'count') {
    const count = payload.count ?? {};
    const quantity = count.quantity ? [count.quantity, count.uom].filter(Boolean).join(' ') : null;
    return { title: count.name || kind, detail: [kind, count.tag ? `Tag ${count.tag}` : 'Tag not recorded', quantity, payload.zoneName].filter(Boolean).join(' · ') };
  }
  if (item.action?.type === 'pack') {
    const pack = payload.pack ?? {};
    const moved = [pack.add?.length ? `${pack.add.length} in` : null, pack.remove?.length ? `${pack.remove.length} out` : null];
    return { title: pack.unitCode || kind, detail: [kind, ...moved, pack.seal ? 'Sealed' : 'Left open', payload.zoneName || payload.placeName].filter(Boolean).join(' · ') };
  }
  if (item.action?.type === 'unpack') return { title: payload.unitCode || kind, detail: `${kind} · Everything inside comes out where the crate is` };
  // Never the licence number: only that one is waiting, and its photos.
  if (item.action?.type === 'licence') {
    const photos = payload.photos?.length ?? 0;
    return { title: payload.label || 'Load', detail: [kind, payload.recorded ? 'Licence on file; photos still to upload' : 'Licence waiting to upload', `${photos} photo${photos === 1 ? '' : 's'}`].join(' · ') };
  }
  if (item.action && item.action.type.startsWith('load_') || item.action?.type === 'stop_complete') {
    const op = payload.op ?? {};
    const pieces = (op.pieces?.length ?? 0), undone = op.undo?.length ?? 0;
    const detail = item.action.type === 'load_on' ? [pieces ? `${pieces} on` : null, undone ? `${undone} taken off` : null]
      : item.action.type === 'load_off' ? [`${pieces} off`, payload.zoneName]
      : item.action.type === 'load_save' ? [op.driverName ? `Driver ${op.driverName}` : null, op.stops ? `${op.stops.length} stop${op.stops.length === 1 ? '' : 's'}` : null] : [];
    return { title: payload.label || 'Load', detail: [kind, ...detail].filter(Boolean).join(' · ') };
  }
  const data = payload as Record<string, unknown>;
  const detail = [data.jobNumber ? `Job ${data.jobNumber}` : null, data.destination, data.quantity != null ? `Quantity ${data.quantity}` : null, data.reason].filter(Boolean).join(' · ');
  return { title: kind, detail: detail || 'Saved for this project' };
}
// A count the server refused will be refused again on every retry. Sync then
// offers to reopen it in Count ("fix") or, for a received tag, only to
// discard it. Photo, connection and sign-in failures are retried instead.
export function countRecoveryAction(item: QueueItem): 'fix' | 'discard' | null {
  const error = item.lastError || '';
  if (item.action?.type !== 'count' || !error || /photo/i.test(error)) return null;
  if (/already been received/i.test(error)) return 'discard';
  if (/network|fetch|connect|timeout|took too long|reconnect|jwt|sign.in|unauthori[sz]ed|access|permission|account or project changed|not confirmed|unsupported/i.test(error)) return null;
  return 'fix';
}
// A crate change the server refused names what is in the way (an item in
// another crate, a crate on a load…). Sorting that out and retrying can work,
// so Sync keeps Retry and adds Discard. Refusals are recognised by migration
// 021's own wording, never by words that could be part of a tag or a code.
const CRATE_REFUSALS = [
  /^Scan a crate label/, /must be lists of tags/, /^Pack at most \d+ tags/, /^Tags must be text/, /must be true or false/, /^Unknown crate type/,
  /^Description is too long/, /^This label belongs to another project/, /^This is an item tag, not a crate label/, /^This crate is .+; (unload it|it can't be unpacked)/,
  /^That place (is unavailable|belongs to another project)/, /^This site plan is unavailable/, /^Zone is unavailable on this map/, /^This area is no longer in use/,
  / isn't in this crate$/, /^Tag numbers must be/, /^Crate .+ isn't in this project/, /can't go inside itself|cannot go inside itself or a crate it contains/,
  / is already inside .+; take it out first$/, / is .+; it can't go inside another crate$/, / has been issued or shipped; it can't be packed$/,
  / isn't a received or counted item in this project$/, / is already in crate .+; take it out of that crate first$/, /^An empty crate can't be sealed/,
  /^Choose a location$/, /^Crates can be nested at most \d+ levels deep/, /must belong to the same project/, /^A crate can only go inside a crate from the same project/,
];
// 022 adds loads, and crates on loads.
const LOAD_REFUSALS = [
  /^This crate is .+; it can't be repacked$/, / is planned on load .+; take it off the load first$/, / is on load .+; (take it off the load first|unload it first)$/,
  / is inside .+, which is on load .+; unload it first$/, / is missing from load .+; the office marks it found first$/,
  /^Choose (a load|a place|the stop|where .+ comes off)/, /^That stop isn't on load /, / is inside .+; a crate travels with the crate it's in$/,
  / has been issued or shipped; it can't go on a load$/, / isn't a crate label or a received or counted item in this project$/, / is packed in .+; load the crate instead$/,
  /^A load ID is required$/, /^Load .+ is .+; it can't change$/, /^Add up to 3 companies$/, /^Each company needs a name$/, /^A company's role is /,
  /^Load .+ has left; (its stops can't change|its plan can't change|choose the pick-up stop you're at)$/, /^A load can have at most \d+ stops$/,
  /^Each stop needs (an ID|an ID and a place)$/, /^Two stops share one ID$/, /^A stop is a drop-off, a pick-up or both$/, /^That stop belongs to another load$/,
  /^The stop at .+ still has pieces planned for it/, /^Every planned piece needs a drop-off stop after its pick-up stop$/, /^Load .+ is finished$/,
  /^Until the truck leaves, scan pieces on without choosing a stop$/, / is a drop-off stop; nothing is picked up there$/, / is already done(; choose a later stop for .+)?$/,
  / isn't on the truck$/, / was loaded somewhere else; it comes off at a stop$/, /^Each piece needs a code$/, / is a pick-up stop; choose where .+ comes off$/,
  / has to come off at a stop after this one$/, / is .+; it can't (go on a load|be unloaded here)$/, / is already on load /, / belongs to load /,
  /^Load .+ has already left$/, /^Add the driver's name before load /, /^Nothing is on the truck yet$/, /^Load .+ hasn't left yet$/, /^Load .+ isn't on the road$/,
  /^Areas can only be chosen at this project's own yard or site$/, /^Only office staff can /, / must be text$/, / is too long \(at most \d+ characters\)$/,
  / must be a date like /, / isn't a real date$/, / isn't a valid ID$/, /^Send .+ as a list$/, /^Send at most \d+ .+ at a time$/,
  /^A load's stops and pieces belong to its project$/,
  // A later step of a load whose first save was refused and discarded (steps
  // wait for earlier ones, so this isn't an unsynced load), or a reused ID.
  /^That load isn't in this project$/, /^Operation ID already belongs to a different request$/, /duplicate key value violates unique constraint/,
];
// The licence's own refusals. It waits for the load's earlier steps, so "That
// load isn't in your projects" means the load was refused, or access was lost.
const LICENCE_REFUSALS = [
  /^That load isn't in your projects$/, /^Operation ID already belongs to a different request$/,
  /^Enter the licence number/, /^This licence was removed after the 90-day retention period$/, /^Load .+ is closed; the office can still correct its licence$/,
  /^Licence photos can't be added to that load$/, /^A load keeps at most 4 licence photos$/, /^Operation ID and licence details are required$/,
  / must be text$/, / is too long/, / must be a date like /, / isn't a real date$/,
];
const LOAD_TYPES = new Set(['load_save', 'load_on', 'load_depart', 'load_off', 'stop_complete']);
export function crateRefused(item: QueueItem): boolean {
  const type = item.action?.type, error = item.lastError?.trim() ?? '';
  if (type === 'licence') return LICENCE_REFUSALS.some(pattern => pattern.test(error.replace(/^Licence recorded; photo (upload )?will retry: /, '')));
  return (type === 'pack' || type === 'unpack' || LOAD_TYPES.has(type)) && [...CRATE_REFUSALS, ...LOAD_REFUSALS].some(pattern => pattern.test(error));
}
// What Sync lets the crew discard: a refused change, and any crate, load or
// licence item that automatic retries have given up on (a licence must never
// be stuck on the device with its number).
export function canDiscard(item: QueueItem): boolean {
  const type = item.action?.type;
  return countRecoveryAction(item) !== null || crateRefused(item)
    || (!!item.deadLetter && (type === 'pack' || type === 'unpack' || type === 'licence' || LOAD_TYPES.has(type)));
}
// Saved work the server refused doesn't count as done anywhere on the device.
export function refusedChange(item: QueueItem): boolean {
  return crateRefused(item) || countRecoveryAction(item) !== null;
}
export function queueRecoveryMessage(item: QueueItem): string {
  const error = item.lastError || '';
  const count = item.action?.type === 'count';
  if (crateRefused(item) && item.action.type === 'licence' && /at most 4 licence photos/.test(error)) return 'The licence is on file, but this load already has 4 licence photos, so these can’t be added. Discard this; the office can remove old photos.';
  if (crateRefused(item) && item.action.type === 'licence') return `The server refused the licence: “${error.replace(/^Licence recorded; photo (upload )?will retry: /, '').replace(/[.\s]+$/, '')}”. Discard it and record the licence again in Driver check-in.`;
  if (crateRefused(item) && LOAD_TYPES.has(item.action.type)) return `The server refused this load change: “${error.replace(/[.\s]+$/, '')}”. Sort that out and retry, or discard the change.`;
  if (crateRefused(item)) {
    if (/choose a location/i.test(error)) return 'This crate can’t be sealed without a location. Discard this change, then pack the crate again and choose its area.';
    return `The server refused this crate change: “${error.replace(/[.\s]+$/, '')}”. Sort that out and retry, or discard the change.`;
  }
  if (count && /already been received/i.test(error)) return 'This tag was received before the count uploaded, so the count cannot be applied. Discard it; the receipt already records the tag.';
  if (count && /choose a location/i.test(error)) return 'Every count now needs a location. Fix it in Count and choose an area, or discard it.';
  if (count && /no longer in use/i.test(error)) return 'The office retired the site plan or area this count uses. Fix it in Count to choose the location again, or discard it.';
  if (count && /(category|zone|area|site map) is (unavailable|inactive)/i.test(error)) return 'The office archived or changed the category, zone or site plan this count uses, so the server refused it. Fix it in Count to choose again, or discard it.';
  if (countRecoveryAction(item) === 'fix') return 'The server refused this count. Fix it in Count, or discard it. Retrying unchanged will be refused again.';
  if (/photo/i.test(error)) return `The ${count ? 'count' : 'receipt'} may already be saved. Retry to finish attaching its photos; the same submission will be reused.`;
  if (/access|permission|jwt|sign.in|unauthorized|account|project/i.test(error)) return 'Verify your sign-in and project access, then retry. Your saved submission is preserved.';
  if (/unsupported|unknown.*type/i.test(error)) return 'Ask an administrator to review this saved submission. Keep it on this device.';
  if (item.deadLetter) return 'Automatic retries have stopped. Check the support details with your administrator before retrying.';
  if (/network|fetch|connect|timeout/i.test(error)) return 'Check your connection and retry when online. Your saved submission is preserved.';
  return error ? 'The upload could not complete. Retry when online; if it fails again, share the support details with your administrator.' : 'Saved on this device. Uploads start when online access is verified.';
}
