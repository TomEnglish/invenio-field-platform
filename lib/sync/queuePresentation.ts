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
// Refused by the server (SQLSTATE 22023) or by the app's own checks: the
// same change will be refused again, so it waits for a decision.
export function isRefused(item: QueueItem): boolean {
  return !!item.refused || item.lastErrorCode === '22023';
}
// A count the server refused will be refused again on every retry. Sync then
// offers to reopen it in Count ("fix") or, for a received tag, only to
// discard it. Photo, connection and sign-in failures are retried instead.
// Items saved before error codes were kept are judged by their wording.
export function countRecoveryAction(item: QueueItem): 'fix' | 'discard' | null {
  const error = item.lastError || '';
  if (item.action?.type !== 'count' || !error) return null;
  if (isRefused(item)) return /already been received/i.test(error) ? 'discard' : 'fix';
  if (item.lastErrorCode || /photo/i.test(error)) return null;
  if (/already been received/i.test(error)) return 'discard';
  if (/network|fetch|connect|timeout|took too long|reconnect|jwt|sign.in|unauthori[sz]ed|access|permission|account or project changed|not confirmed|unsupported/i.test(error)) return null;
  return 'fix';
}
const LOAD_TYPES = new Set(['load_save', 'load_on', 'load_depart', 'load_off', 'stop_complete']);
const OWN_TYPES = new Set(['pack', 'unpack', 'licence', ...LOAD_TYPES]);
// A crate, load or licence change the server refused names what is in the way
// (an item in another crate, a load that has left…). Sorting that out and
// retrying can work, so Sync keeps Retry and adds Discard.
export function crateRefused(item: QueueItem): boolean {
  return OWN_TYPES.has(item.action?.type) && isRefused(item);
}
// The load a queued step belongs to. A load's steps go in order: once one is
// unresolved, the later ones wait.
export function loadOf(item: QueueItem): string | null {
  if (!LOAD_TYPES.has(item.action?.type) && item.action?.type !== 'licence') return null;
  const payload = item.action.payload as { op?: { loadId?: string }; loadId?: string };
  return payload.op?.loadId ?? payload.loadId ?? null;
}
// A step for this load that hasn't gone through and isn't just waiting for a
// connection: refused, failed or given up on. Departing or finishing a stop
// behind one would act on scans the server may never have.
export function unresolvedFor(items: QueueItem[], loadId: string): QueueItem[] {
  return items.filter(item => loadOf(item) === loadId && (item.refused || item.deadLetter || !!item.lastError));
}
// What Sync lets the crew discard: a refused change, and any crate, load or
// licence item that automatic retries have given up on (a licence must never
// be stuck on the device).
export function canDiscard(item: QueueItem): boolean {
  return countRecoveryAction(item) !== null || crateRefused(item) || (!!item.deadLetter && OWN_TYPES.has(item.action?.type));
}
// Saved work the server refused doesn't count as done anywhere on the device.
export function refusedChange(item: QueueItem): boolean {
  return isRefused(item) || countRecoveryAction(item) !== null;
}
export function queueRecoveryMessage(item: QueueItem): string {
  const error = item.lastError || '';
  const count = item.action?.type === 'count';
  const reason = error.replace(/^Licence recorded; photo (upload )?will retry: /, '').replace(/[.\s]+$/, '');
  if (crateRefused(item) && item.action.type === 'licence') {
    if (item.lastErrorCode === 'LICENCE_FORGOTTEN') return 'The licence number is kept only until the app closes, and it closed before this uploaded. Discard this and record the licence again in Driver check-in.';
    if (item.lastErrorCode === 'PHOTO_GONE') return 'The licence photos are no longer on this device. Discard this and record the licence again in Driver check-in.';
    if (/at most 4 licence photos/.test(error)) return 'The licence is on file, but this load already has 4 licence photos, so these can’t be added. Discard this; the office can remove old photos.';
    return `The server refused the licence: “${reason}”. Discard it and record the licence again in Driver check-in.`;
  }
  if (crateRefused(item) && LOAD_TYPES.has(item.action.type)) return `The server refused this load change: “${reason}”. Sort that out and retry, or discard the change. Later steps for this load wait until then.`;
  if (crateRefused(item)) {
    if (/choose a location/i.test(error)) return 'This crate can’t be sealed without a location. Discard this change, then pack the crate again and choose its area.';
    return `The server refused this crate change: “${reason}”. Sort that out and retry, or discard the change.`;
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
