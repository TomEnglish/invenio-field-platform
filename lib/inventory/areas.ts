// Nested map areas (site_map_zones with parent_id, migration 020): the
// Location step's list and the site plan are the same tree. Pure functions,
// following categories.ts, so they work the same online and from the cache.
import { pointInPolygon, polygonArea, type Pin, type Polygon } from './siteMap';

export interface MapArea {
  id: string;
  map_id: string;
  parent_id: string | null;
  name: string;
  shape: Polygon;
  sort_order: number;
  is_active: boolean;
  location_id: string | null;
}

export interface AreaTree<T extends MapArea = MapArea> {
  byId: Map<string, T>;
  // Children keyed by parent id; top-level areas live under ''.
  children: Map<string, T[]>;
}

const ROOT = '';
export const AREA_SEPARATOR = ' › ';

function compare(a: MapArea, b: MapArea) {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

// A parent on another map, or missing from the list, is ignored: the area is
// shown at the top level rather than lost.
function parentOf<T extends MapArea>(area: T, byId: Map<string, T>): T | undefined {
  const parent = area.parent_id ? byId.get(area.parent_id) : undefined;
  return parent && parent.id !== area.id && parent.map_id === area.map_id ? parent : undefined;
}

// Areas a crew can choose: active, and with no inactive area above them.
export function activeAreas<T extends MapArea>(areas: T[]): T[] {
  const byId = new Map(areas.map(area => [area.id, area]));
  const live = (area: T) => {
    const seen = new Set<string>();
    for (let current: T | undefined = area; current && !seen.has(current.id); current = parentOf(current, byId)) {
      if (current.is_active === false) return false;
      seen.add(current.id);
    }
    return true;
  };
  return areas.filter(live);
}

// Pass activeAreas(...) for what crews pick from; pass every area to name the
// path of an older count whose area has since been retired.
export function buildAreaTree<T extends MapArea>(areas: T[]): AreaTree<T> {
  const byId = new Map(areas.map(area => [area.id, area]));
  const children = new Map<string, T[]>();
  for (const area of areas) {
    const key = parentOf(area, byId)?.id ?? ROOT;
    const list = children.get(key) ?? [];
    list.push(area);
    children.set(key, list);
  }
  for (const list of children.values()) list.sort(compare);
  return { byId, children };
}

export function childAreas<T extends MapArea>(tree: AreaTree<T>, parentId: string | null): T[] {
  return tree.children.get(parentId ?? ROOT) ?? [];
}

// Root-first ancestry, for the breadcrumb. Stops on a loop instead of hanging.
export function areaPath<T extends MapArea>(tree: AreaTree<T>, id: string | null | undefined): T[] {
  const path: T[] = [];
  const seen = new Set<string>();
  let current = id ? tree.byId.get(id) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = parentOf(current, tree.byId);
  }
  return path;
}

// "T1 Pipe Racks › Rack 2", as the server stores it in inventory_records.location.
export function areaPathLabel(tree: AreaTree, id: string | null | undefined): string {
  return areaPath(tree, id).map(area => area.name).join(AREA_SEPARATOR);
}

// Depth-first order with depth, skipping the children of collapsed areas.
export function visibleAreaRows<T extends MapArea>(tree: AreaTree<T>, expanded: Set<string>): { area: T; depth: number; hasChildren: boolean }[] {
  const rows: { area: T; depth: number; hasChildren: boolean }[] = [];
  const walk = (parentId: string | null, depth: number, seen: Set<string>) => {
    for (const area of childAreas(tree, parentId)) {
      if (seen.has(area.id)) continue;
      const hasChildren = childAreas(tree, area.id).length > 0;
      rows.push({ area, depth, hasChildren });
      if (hasChildren && expanded.has(area.id)) walk(area.id, depth + 1, new Set([...seen, area.id]));
    }
  };
  walk(null, 0, new Set());
  return rows;
}

function normalise(text: string) {
  return text.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

// Every word must appear somewhere in the full path ("t1 rack 2" finds
// T1 Pipe Racks › Rack 2). Name matches first, then shallower areas.
export function searchAreas<T extends MapArea>(tree: AreaTree<T>, query: string, limit = 50): { area: T; path: string }[] {
  const words = normalise(query).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const results: { area: T; path: string; rank: number; depth: number }[] = [];
  for (const area of tree.byId.values()) {
    const path = areaPath(tree, area.id);
    const haystack = normalise(path.map(a => a.name).join(' '));
    if (!words.every(word => haystack.includes(word))) continue;
    const name = normalise(area.name);
    const rank = name === words.join(' ') ? 0 : words.every(word => name.includes(word)) ? 1 : 2;
    results.push({ area, path: path.map(a => a.name).join(AREA_SEPARATOR), rank, depth: path.length });
  }
  results.sort((a, b) => a.rank - b.rank || a.depth - b.depth || a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));
  return results.slice(0, limit).map(({ area, path }) => ({ area, path }));
}

// Segments (a,b) and (c,d) cross at a single interior point.
function crosses(a: [number, number], b: [number, number], c: [number, number], d: [number, number]) {
  const side = (p: [number, number], q: [number, number], r: [number, number]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = side(c, d, a), d2 = side(c, d, b), d3 = side(a, b, c), d4 = side(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// A shape a tap can sensibly land in: at least a triangle, with some area,
// and no edges crossing. A zero-area or bow-tie outline would otherwise
// "contain" taps it shouldn't, or win every tap by being smallest.
export function usableShape(shape: Polygon): boolean {
  if (!Array.isArray(shape) || shape.length < 3 || polygonArea(shape) < 1e-9) return false;
  for (let i = 0; i < shape.length; i++) {
    const a = shape[i], b = shape[(i + 1) % shape.length];
    for (let j = i + 2; j < shape.length; j++) {
      if (i === 0 && j === shape.length - 1) continue; // edges sharing a corner
      if (crosses(a, b, shape[j], shape[(j + 1) % shape.length])) return false;
    }
  }
  return true;
}

// The area a tap means: among active areas with a usable outline containing
// the point, the deepest in the tree; between equally deep ones, the smaller.
export function deepestAreaAt<T extends MapArea>(areas: T[], pin: Pin): T | null {
  const live = activeAreas(areas);
  const tree = buildAreaTree(live);
  let best: { area: T; depth: number; size: number } | null = null;
  for (const area of live) {
    if (!usableShape(area.shape) || !pointInPolygon(pin, area.shape)) continue;
    const depth = areaPath(tree, area.id).length, size = polygonArea(area.shape);
    if (!best || depth > best.depth || (depth === best.depth && size < best.size)) best = { area, depth, size };
  }
  return best?.area ?? null;
}

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
export function areaBounds(shape: Polygon): Bounds {
  const xs = shape.map(([x]) => x), ys = shape.map(([, y]) => y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

// Receiving starts at the rack location linked to the area, or the nearest
// area above it that has one; `owner` is the area that holds the link.
export function linkedLocation<T extends MapArea>(tree: AreaTree<T>, id: string | null | undefined): { locationId: string; owner: T } | null {
  const path = areaPath(tree, id);
  for (let i = path.length - 1; i >= 0; i--) if (path[i].location_id) return { locationId: path[i].location_id!, owner: path[i] };
  return null;
}

// What the server accepts as a count location (migration 020), from the
// downloaded plans and areas. The cache holds only plans in use. A count needs
// an area when the plan it names has areas in use, or, with no plan, when any
// plan does; a plan with no areas takes a pin on its own. Unknown without a
// downloaded copy; the server still decides.
export interface LocationRule {
  activeMapIds: Set<string>;
  liveAreaIds: Set<string>;
  mapsWithAreas: Set<string>;
  // Live area → the plan it is drawn on.
  areaMap: Map<string, string>;
}
export function locationRule(maps: { id: string }[], areas: MapArea[], treeKnown: boolean): LocationRule | undefined {
  if (!treeKnown) return undefined;
  const activeMapIds = new Set(maps.map(map => map.id));
  const live = activeAreas(areas).filter(area => activeMapIds.has(area.map_id));
  return {
    activeMapIds, liveAreaIds: new Set(live.map(area => area.id)), mapsWithAreas: new Set(live.map(area => area.map_id)),
    areaMap: new Map(live.map(area => [area.id, area.map_id])),
  };
}

// Why a saved location can no longer be sent: its plan or area was retired,
// or the area is on another plan than the one named (the server refuses all
// three). Null when it is usable, or when nothing is known yet.
export function staleLocation(location: { siteMapId: string | null; zoneId: string | null }, rule: LocationRule | undefined): 'plan' | 'area' | 'other-plan' | null {
  if (!rule) return null;
  if (location.siteMapId && !rule.activeMapIds.has(location.siteMapId)) return 'plan';
  if (location.zoneId && !rule.liveAreaIds.has(location.zoneId)) return 'area';
  if (location.zoneId && location.siteMapId && rule.areaMap.get(location.zoneId) !== location.siteMapId) return 'other-plan';
  return null;
}
export function areaRequired(rule: LocationRule | undefined, siteMapId: string | null): boolean {
  if (!rule) return false;
  return siteMapId ? rule.mapsWithAreas.has(siteMapId) : rule.mapsWithAreas.size > 0;
}
