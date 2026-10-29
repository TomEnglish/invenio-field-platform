import type { QueueItem } from './offlineQueue';

export function queueSummary(item: QueueItem): { title: string; detail: string } {
  const payload = item.action?.payload ?? {};
  const names = { receiving:'Receiving', transfer:'Material transfer', issue:'Material issue', shipment:'Outbound shipment', count:'Inventory count', pack:'Crate packing', unpack:'Crate unpacking' };
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
export function crateRefused(item: QueueItem): boolean {
  const type = item.action?.type, error = item.lastError?.trim() ?? '';
  return (type === 'pack' || type === 'unpack') && CRATE_REFUSALS.some(pattern => pattern.test(error));
}
// Saved work the server refused doesn't count as done anywhere on the device.
export function refusedChange(item: QueueItem): boolean {
  return crateRefused(item) || countRecoveryAction(item) !== null;
}
export function queueRecoveryMessage(item: QueueItem): string {
  const error = item.lastError || '';
  const count = item.action?.type === 'count';
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
