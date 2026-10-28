// Count draft rules, the `count` operation payload, progress figures and the
// count → receiving hand-off. Pure so they are shared by screens, the queue
// and tests. Contract: MSR docs/INITIAL_INVENTORY.md (migration 019).
import { isValidPin, type Pin } from './siteMap';
import { buildCategoryTree, categoryPathLabel, type InventoryCategory } from './categories';
import { areaPathLabel, areaRequired, buildAreaTree, type LocationRule, type MapArea } from './areas';

export type CountCondition = 'good' | 'damaged' | 'mixed';
export type CountStatus = 'expected' | 'counted' | 'received';

// The inventory_records columns the app reads.
export interface InventoryItem {
  id: number;
  uid: string;
  qr_code: string;
  inventory_item: string;
  item_description: string | null;
  part_number: string | null;
  quantity: number | string | null;
  uom: string | null;
  condition: CountCondition | null;
  count_status: CountStatus;
  category_id: string | null;
  site_map_id: string | null;
  pin_x: number | string | null;
  pin_y: number | string | null;
  zone_id: string | null;
  location: string | null;
  counted_at: string | null;
}

export interface CountItemData {
  name: string;
  description: string;
  partNumber: string;
  quantity: string;
  uom: string;
  condition: CountCondition;
  notes: string;
}
export interface CountCategoryChoice {
  categoryId: string | null;
  proposed: { parentId: string | null; name: string } | null;
  label: string;
}
export interface CountLocation {
  siteMapId: string | null;
  pin: Pin | null;
  // The chosen area (site_map_zones); zoneName holds its full path.
  zoneId: string | null;
  zoneName: string;
}
export type { LocationRule } from './areas';
export interface CountPhoto { uri: string }
// The record a scanned tag matched, kept for the item step's banner.
export interface CountMatch {
  status: 'expected' | 'counted';
  name: string;
  countedAt: string | null;
}
export interface CountDraft {
  tag: string;
  match: CountMatch | null;
  item: CountItemData;
  category: CountCategoryChoice;
  location: CountLocation;
  photos: CountPhoto[];
}

export interface CountOperationPayload {
  tag: string;
  name: string;
  description?: string;
  partNumber?: string;
  quantity: string;
  uom: string;
  condition: CountCondition;
  categoryId: string | null;
  proposedCategory?: { parentId: string | null; name: string };
  siteMapId: string | null;
  pin?: Pin;
  zoneId: string | null;
  notes?: string;
}

export const COUNT_UNITS = ['EA', 'FT', 'LF', 'LB', 'SET', 'BOX', 'PAL'];
export const COUNT_CONDITIONS: { value: CountCondition; label: string }[] = [
  { value: 'good', label: 'Good' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'mixed', label: 'Mixed' },
];

const QUANTITY = /^[0-9]{1,9}(\.[0-9]{1,3})?$/;

// The server accepts up to 9 whole digits and 3 decimals, greater than zero.
// Returns the value to send, or null when it would be refused.
export function normaliseQuantity(text: string | number | null | undefined): string | null {
  let value = String(text ?? '').trim();
  // Comma-decimal keypads offer only ",".
  if (!value.includes('.') && value.split(',').length === 2) value = value.replace(',', '.');
  if (value.startsWith('.')) value = `0${value}`;
  if (value.endsWith('.')) value = value.slice(0, -1);
  if (!QUANTITY.test(value) || Number(value) <= 0) return null;
  return value;
}

export function countItemIssue(item: CountItemData): string | null {
  const name = item.name.trim();
  if (!name) return 'Enter the item name.';
  if (name.length > 200) return 'Keep the item name under 200 characters.';
  if (!normaliseQuantity(item.quantity)) return 'Quantity must be greater than zero, with up to 3 decimals.';
  const uom = item.uom.trim();
  if (!uom) return 'Enter a unit, such as EA.';
  if (uom.length > 16) return 'Keep the unit under 16 characters.';
  if (!COUNT_CONDITIONS.some(c => c.value === item.condition)) return 'Choose the condition.';
  return null;
}

export function countCategoryIssue(category: CountCategoryChoice): string | null {
  const proposed = category.proposed?.name.trim() ?? '';
  if (category.categoryId && category.proposed) return 'Choose a category or propose one, not both.';
  if (category.proposed && (!proposed || proposed.length > 120)) return 'Give the proposed category a name under 120 characters.';
  if (!category.categoryId && !category.proposed) return 'Choose a category, or propose one for the office to review.';
  return null;
}

// Mirrors the server's location rules (migration 020); the pin stays optional.
export function countLocationIssue(location: CountLocation, rule?: LocationRule): string | null {
  if (rule && location.siteMapId && !rule.activeMapIds.has(location.siteMapId)) return 'The office has retired this site plan. Choose the location again.';
  if (rule && location.zoneId && !rule.liveAreaIds.has(location.zoneId)) return 'The office has retired this area. Choose the location again.';
  if (!location.zoneId && areaRequired(rule, location.siteMapId)) return 'Choose a location: pick an area from the list or tap it on the plan.';
  if (location.pin && !location.siteMapId) return 'A pin needs a site plan. Choose the plan again or clear the pin.';
  if (location.pin && !isValidPin(location.pin)) return 'The pin is off the plan. Place it again.';
  return null;
}

// The office can archive or merge a category after it was chosen, kept by
// "Count next" or pre-filled from a record; the server then refuses the count
// on every retry. Checked against the latest downloaded tree when there is one.
export function categoryAvailabilityIssue(
  category: CountCategoryChoice,
  categories: Pick<InventoryCategory, 'id' | 'status'>[],
  treeKnown: boolean,
): { step: number; message: string } | null {
  if (!treeKnown) return null;
  const live = new Set(categories.filter(c => c.status !== 'archived').map(c => c.id));
  if (category.categoryId && !live.has(category.categoryId)) return { step: 1, message: 'The office has archived or merged this category. Choose a category again.' };
  if (category.proposed?.parentId && !live.has(category.proposed.parentId)) return { step: 1, message: 'The office has archived or merged the parent of your proposed category. Propose it again under another category.' };
  return null;
}

// Steps: 0 item, 1 category, 2 location, 3 photo + review.
export function countReviewIssue(draft: CountDraft, rule?: LocationRule): { step: number; message: string } | null {
  const tag = draft.tag.trim();
  if (!tag) return { step: 0, message: 'A tag is required. Return to Count and scan the tag.' };
  if (tag.length > 120) return { step: 0, message: 'The tag is too long to save. Check the label and scan again.' };
  const item = countItemIssue(draft.item);
  if (item) return { step: 0, message: item };
  const category = countCategoryIssue(draft.category);
  if (category) return { step: 1, message: category };
  const location = countLocationIssue(draft.location, rule);
  if (location) return { step: 2, message: location };
  return null;
}

// Blank optional text is left out: the server keeps an imported value then.
export function buildCountPayload(draft: CountDraft): CountOperationPayload {
  const text = (value: string) => value.trim() || undefined;
  const { item, category, location } = draft;
  const payload: CountOperationPayload = {
    tag: draft.tag.trim(),
    name: item.name.trim(),
    quantity: normaliseQuantity(item.quantity) ?? item.quantity.trim(),
    uom: item.uom.trim().toUpperCase(),
    condition: item.condition,
    categoryId: category.proposed ? null : category.categoryId,
    siteMapId: location.siteMapId,
    zoneId: location.zoneId,
  };
  const description = text(item.description), partNumber = text(item.partNumber), notes = text(item.notes);
  if (description) payload.description = description;
  if (partNumber) payload.partNumber = partNumber;
  if (notes) payload.notes = notes;
  if (category.proposed) payload.proposedCategory = { parentId: category.proposed.parentId, name: category.proposed.name.trim() };
  if (location.pin && location.siteMapId) payload.pin = { x: location.pin.x, y: location.pin.y };
  return payload;
}

// A queued count the server refused, turned back into a draft so it can be
// fixed in Count. Opens on the step the refusal points at, else the review.
export function draftFromQueuedCount(
  payload: { count: CountOperationPayload; photos?: CountPhoto[]; categoryLabel?: string; zoneName?: string },
  error = '',
): { step: number; draft: CountDraft } {
  const { count } = payload;
  const step = /categor/i.test(error) ? 1 : /zone|area|location|site (map|plan)|pin/i.test(error) ? 2 : /tag|name|quantity|unit|condition/i.test(error) ? 0 : 3;
  return {
    step,
    draft: {
      tag: count.tag,
      match: null,
      item: {
        name: count.name, description: count.description ?? '', partNumber: count.partNumber ?? '',
        quantity: count.quantity, uom: count.uom, condition: count.condition, notes: count.notes ?? '',
      },
      category: count.proposedCategory
        ? { categoryId: null, proposed: count.proposedCategory, label: payload.categoryLabel ?? count.proposedCategory.name }
        : { categoryId: count.categoryId, proposed: null, label: payload.categoryLabel ?? '' },
      location: { siteMapId: count.siteMapId, pin: count.pin ?? null, zoneId: count.zoneId, zoneName: payload.zoneName ?? '' },
      photos: payload.photos ?? [],
    },
  };
}

// Tags match on trimmed, case-sensitive text (unique per project on btrim).
export function findItemByTag<T extends { qr_code: string }>(items: T[], tag: string): T | undefined {
  const wanted = tag.trim();
  return wanted ? items.find(item => (item.qr_code ?? '').trim() === wanted) : undefined;
}

export function quantityText(quantity: number | string | null | undefined): string {
  const value = Number(quantity);
  return Number.isFinite(value) && value > 0 ? String(value) : '1';
}

// Draft values when a scanned tag matches a record. An expected (imported)
// record has no location, so the last zone is kept for "Count next".
export function countStartPrefill(
  item: InventoryItem | null | undefined,
  categories: InventoryCategory[] = [],
  zones: MapArea[] = [],
): { match: CountMatch | null; item?: Partial<CountItemData>; category?: CountCategoryChoice | null; location?: CountLocation | null } {
  if (!item) return { match: null };
  const tree = buildCategoryTree(categories);
  const pin = item.pin_x != null && item.pin_y != null ? { x: Number(item.pin_x), y: Number(item.pin_y) } : null;
  return {
    match: { status: item.count_status === 'counted' ? 'counted' : 'expected', name: item.inventory_item, countedAt: item.counted_at },
    item: {
      name: item.inventory_item ?? '', description: item.item_description ?? '', partNumber: item.part_number ?? '',
      quantity: quantityText(item.quantity), uom: item.uom?.trim() || 'EA', condition: item.condition ?? 'good',
    },
    category: item.category_id && tree.byId.has(item.category_id)
      ? { categoryId: item.category_id, proposed: null, label: categoryPathLabel(tree, item.category_id) }
      : null,
    location: item.site_map_id && (pin || item.zone_id)
      ? { siteMapId: item.site_map_id, pin: isValidPin(pin) ? pin : null, zoneId: item.zone_id, zoneName: (item.zone_id && areaPathLabel(buildAreaTree(zones), item.zone_id)) || item.location || '' }
      : null,
  };
}

export interface CountProgress { expected: number; counted: number; received: number; total: number; found: number }

// Tags saved on this device but not yet uploaded count as counted already.
export function countProgress(items: Pick<InventoryItem, 'qr_code' | 'count_status'>[], pendingTags: string[] = []): CountProgress {
  const pending = new Set(pendingTags.map(tag => tag.trim()));
  const progress = { expected: 0, counted: 0, received: 0, total: 0, found: 0 };
  for (const item of items) {
    const status = item.count_status === 'expected' && pending.has(item.qr_code.trim()) ? 'counted' : item.count_status;
    if (status === 'expected' || status === 'counted' || status === 'received') progress[status] += 1;
    pending.delete(item.qr_code.trim());
  }
  // New tags counted offline are not in the cache yet.
  progress.counted += pending.size;
  progress.total = progress.expected + progress.counted + progress.received;
  progress.found = progress.counted + progress.received;
  return progress;
}

export function outstandingTags<T extends Pick<InventoryItem, 'qr_code' | 'count_status' | 'inventory_item' | 'part_number'>>(
  items: T[], pendingTags: string[] = [], query = '',
): T[] {
  const pending = new Set(pendingTags.map(tag => tag.trim()));
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items
    .filter(item => item.count_status === 'expected' && !pending.has(item.qr_code.trim()))
    .filter(item => {
      const text = [item.qr_code, item.inventory_item, item.part_number].filter(Boolean).join(' ').toLocaleLowerCase();
      return words.every(word => text.includes(word));
    })
    .sort((a, b) => a.qr_code.localeCompare(b.qr_code, undefined, { numeric: true }));
}

// Most recent server counts, newest first.
export function recentCounts<T extends Pick<InventoryItem, 'count_status' | 'counted_at'>>(items: T[], limit = 10): T[] {
  return items
    .filter(item => item.count_status !== 'expected' && item.counted_at)
    .sort((a, b) => String(b.counted_at).localeCompare(String(a.counted_at)))
    .slice(0, limit);
}

// Starting a receipt from a count (contract: description, whole-number
// quantity, part number as spec). Material type stays a receiving choice.
export function receivingPrefill(item: Pick<InventoryItem, 'inventory_item' | 'item_description' | 'quantity' | 'part_number'>) {
  const description = [item.inventory_item, item.item_description]
    .map(value => (value ?? '').trim())
    .filter((value, index, all) => value && all.indexOf(value) === index)
    .join(' — ');
  const quantity = Number(item.quantity);
  return {
    material_type: '',
    qty: Number.isInteger(quantity) && quantity >= 1 ? quantity : 1,
    description: description || undefined,
    spec: item.part_number?.trim() || undefined,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDate(iso: string | null | undefined): string {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime()) ? `${MONTHS[date.getMonth()]} ${date.getDate()}` : '';
}

// "Counted Oct 30 in Zone B"
export function countedBannerText(countedAt: string | null | undefined, zoneName: string | null | undefined): string {
  const date = shortDate(countedAt);
  const zone = zoneName?.trim();
  return ['Counted', date, zone ? `in ${zone}` : ''].filter(Boolean).join(' ');
}
