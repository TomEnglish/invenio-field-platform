// Category tree helpers for the Count workflow. Pure functions so the picker
// works the same online and from the read cache.

export interface InventoryCategory {
  id: string;
  parent_id: string | null;
  name: string;
  status: 'active' | 'proposed' | 'archived';
  sort_order: number;
}

export interface CategoryTree {
  byId: Map<string, InventoryCategory>;
  // Children keyed by parent id; top-level categories live under ''.
  children: Map<string, InventoryCategory[]>;
}

const ROOT = '';
export const PATH_SEPARATOR = ' › ';

function compare(a: InventoryCategory, b: InventoryCategory) {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

// Archived categories are hidden. A category whose parent is missing (archived
// or not yet synced) is shown at the top level rather than dropped.
export function buildCategoryTree(categories: InventoryCategory[]): CategoryTree {
  const visible = categories.filter(c => c && c.status !== 'archived');
  const byId = new Map(visible.map(c => [c.id, c]));
  const children = new Map<string, InventoryCategory[]>();
  for (const category of visible) {
    const parent = category.parent_id && byId.has(category.parent_id) && category.parent_id !== category.id ? category.parent_id : ROOT;
    const list = children.get(parent) ?? [];
    list.push(category);
    children.set(parent, list);
  }
  for (const list of children.values()) list.sort(compare);
  return { byId, children };
}

export function childCategories(tree: CategoryTree, parentId: string | null): InventoryCategory[] {
  return tree.children.get(parentId ?? ROOT) ?? [];
}

export function hasChildren(tree: CategoryTree, id: string): boolean {
  return (tree.children.get(id)?.length ?? 0) > 0;
}

// Root-first ancestry, for breadcrumbs. Stops on a loop instead of hanging.
export function categoryPath(tree: CategoryTree, id: string | null | undefined): InventoryCategory[] {
  const path: InventoryCategory[] = [];
  const seen = new Set<string>();
  let current = id ? tree.byId.get(id) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parent_id ? tree.byId.get(current.parent_id) : undefined;
  }
  return path;
}

export function categoryPathLabel(tree: CategoryTree, id: string | null | undefined, separator = PATH_SEPARATOR): string {
  return categoryPath(tree, id).map(c => c.name).join(separator);
}

export interface CategorySearchResult {
  category: InventoryCategory;
  path: string;
}

function normalise(text: string) {
  return text.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

// Every word in the query must appear somewhere in the category's full path, so
// "gen oil valve" finds Generator 1 › Oil System › Control Valve. Matches on the
// category's own name rank first, then shallower categories, then by path.
export function searchCategories(tree: CategoryTree, query: string, limit = 50): CategorySearchResult[] {
  const words = normalise(query).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const results: (CategorySearchResult & { rank: number; depth: number })[] = [];
  for (const category of tree.byId.values()) {
    const path = categoryPath(tree, category.id);
    const haystack = normalise(path.map(c => c.name).join(' '));
    if (!words.every(word => haystack.includes(word))) continue;
    const name = normalise(category.name);
    const rank = name === words.join(' ') ? 0 : words.every(word => name.includes(word)) ? 1 : words.some(word => name.includes(word)) ? 2 : 3;
    results.push({ category, path: path.map(c => c.name).join(PATH_SEPARATOR), rank, depth: path.length });
  }
  results.sort((a, b) => a.rank - b.rank || a.depth - b.depth || a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));
  return results.slice(0, limit).map(({ category, path }) => ({ category, path }));
}

// A proposed name that matches an existing sibling is reused by the server; the
// picker selects that sibling instead of sending a duplicate proposal.
export function findSibling(tree: CategoryTree, parentId: string | null, name: string): InventoryCategory | undefined {
  const wanted = normalise(name);
  return childCategories(tree, parentId).find(c => normalise(c.name) === wanted);
}
