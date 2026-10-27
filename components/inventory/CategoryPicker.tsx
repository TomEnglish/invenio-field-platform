import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  buildCategoryTree, categoryPath, categoryPathLabel, childCategories, findSibling, hasChildren, searchCategories,
  PATH_SEPARATOR, type InventoryCategory,
} from '@/lib/inventory/categories';
import type { CountCategoryChoice } from '@/lib/inventory/count';
import { colors, radius, space, fontSize, fontWeight, touchTarget } from '@/lib/design/tokens';

interface Props {
  categories: InventoryCategory[];
  value: CountCategoryChoice;
  onChange: (value: CountCategoryChoice) => void;
}

// Office-managed tree: drill down with a breadcrumb, search the whole tree,
// or propose a missing category under the current level.
export function CategoryPicker({ categories, value, onChange }: Props) {
  const tree = useMemo(() => buildCategoryTree(categories), [categories]);
  const startAt = value.proposed ? value.proposed.parentId : value.categoryId ? tree.byId.get(value.categoryId)?.parent_id ?? null : null;
  const [parentId, setParentId] = useState<string | null>(startAt && tree.byId.has(startAt) ? startAt : null);
  const [query, setQuery] = useState('');
  const [proposing, setProposing] = useState(false);
  const [proposal, setProposal] = useState('');
  const [notice, setNotice] = useState('');

  const crumbs = categoryPath(tree, parentId);
  const current = parentId ? tree.byId.get(parentId) ?? null : null;
  const children = childCategories(tree, parentId);
  const results = query.trim() ? searchCategories(tree, query) : [];
  const currentPath = categoryPathLabel(tree, parentId);

  const select = (category: InventoryCategory) => {
    onChange({ categoryId: category.id, proposed: null, label: categoryPathLabel(tree, category.id) });
    setNotice('');
  };
  const open = (id: string | null) => { setParentId(id); setQuery(''); setProposing(false); setNotice(''); };
  const propose = () => {
    const name = proposal.trim().replace(/\s+/g, ' ');
    if (!name) { setNotice('Enter a name for the new category.'); return; }
    if (name.length > 120) { setNotice('Keep the name under 120 characters.'); return; }
    const existing = findSibling(tree, parentId, name);
    if (existing) {
      select(existing);
      setNotice(`"${existing.name}" already exists here, so it was selected.`);
    } else {
      onChange({ categoryId: null, proposed: { parentId, name }, label: [currentPath, name].filter(Boolean).join(PATH_SEPARATOR) });
      setNotice('');
    }
    setProposing(false); setProposal('');
  };

  return (
    <View style={styles.container}>
      <View style={styles.selected} accessibilityLiveRegion="polite">
        <Text style={styles.selectedLabel}>{value.proposed ? 'Proposed category' : 'Category'}</Text>
        <Text style={styles.selectedValue}>{value.label || 'None chosen yet'}</Text>
        {value.proposed ? <Text style={styles.hint}>The office will review this new category. The item is saved under it now.</Text> : null}
      </View>

      <Input label="Search all categories" value={query} onChangeText={setQuery} placeholder="e.g. oil valve" autoCorrect={false} autoCapitalize="none" returnKeyType="search" />

      {query.trim() ? (
        <View style={styles.list}>
          {results.length === 0 ? <Text style={styles.hint}>No category matches "{query.trim()}". Clear the search to browse, or propose one.</Text> : null}
          {results.map(({ category, path }) => (
            <Pressable key={category.id} accessibilityRole="button" accessibilityLabel={`Choose ${path}`} onPress={() => { select(category); open(category.parent_id && tree.byId.has(category.parent_id) ? category.parent_id : null); }} style={({ pressed }) => [styles.row, value.categoryId === category.id && styles.rowSelected, pressed && styles.rowPressed]}>
              <View style={styles.rowText}>
                <Text style={styles.rowName}>{category.name}{category.status === 'proposed' ? <Text style={styles.badge}>  Proposed</Text> : null}</Text>
                <Text style={styles.rowPath}>{path}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : (
        <>
          <View style={styles.breadcrumb} accessibilityRole="toolbar" accessibilityLabel="Category path">
            <Pressable accessibilityRole="button" onPress={() => open(null)} style={styles.crumb}><Text style={[styles.crumbText, !parentId && styles.crumbCurrent]}>All</Text></Pressable>
            {crumbs.map(crumb => (
              <View key={crumb.id} style={styles.crumbGroup}>
                <Text style={styles.crumbSeparator}>›</Text>
                <Pressable accessibilityRole="button" onPress={() => open(crumb.id)} style={styles.crumb}><Text style={[styles.crumbText, crumb.id === parentId && styles.crumbCurrent]}>{crumb.name}</Text></Pressable>
              </View>
            ))}
          </View>

          {current ? <Button title={`Use "${current.name}"`} variant={value.categoryId === current.id ? 'primary' : 'secondary'} onPress={() => select(current)} /> : null}

          <View style={styles.list}>
            {children.length === 0 ? <Text style={styles.hint}>{categories.length === 0 ? 'The office has not added categories yet. Propose one below.' : 'No subcategories here.'}</Text> : null}
            {children.map(category => {
              const branch = hasChildren(tree, category.id);
              const chosen = value.categoryId === category.id;
              return (
                <Pressable key={category.id} accessibilityRole="button" accessibilityState={{ selected: chosen }}
                  accessibilityLabel={branch ? `Open ${category.name}` : `Choose ${category.name}`}
                  onPress={() => (branch ? open(category.id) : select(category))}
                  style={({ pressed }) => [styles.row, chosen && styles.rowSelected, pressed && styles.rowPressed]}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowName}>{category.name}{category.status === 'proposed' ? <Text style={styles.badge}>  Proposed</Text> : null}</Text>
                  </View>
                  {chosen ? <FontAwesome name="check" size={16} color={colors.brandPrimary} /> : null}
                  {branch ? <FontAwesome name="chevron-right" size={14} color={colors.textSubtle} /> : null}
                </Pressable>
              );
            })}
          </View>

          {proposing ? (
            <View style={styles.proposal}>
              <Input label={`New category under ${currentPath || 'the top level'}`} value={proposal} onChangeText={setProposal} autoFocus maxLength={120} onSubmitEditing={propose} />
              <View style={styles.actions}>
                <Button title="Propose" onPress={propose} style={styles.action} />
                <Button title="Cancel" variant="secondary" onPress={() => { setProposing(false); setProposal(''); }} style={styles.action} />
              </View>
            </View>
          ) : (
            <Button title="Propose new category here" variant="ghost" onPress={() => { setProposing(true); setNotice(''); }} />
          )}
        </>
      )}
      {notice ? <Text style={styles.notice} accessibilityRole="alert">{notice}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space[3] },
  selected: { padding: space[3], gap: space[1], borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  selectedLabel: { fontSize: fontSize.xs, color: colors.textMuted },
  selectedValue: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  hint: { fontSize: fontSize.sm, color: colors.textMuted, lineHeight: 18 },
  notice: { fontSize: fontSize.sm, color: colors.warnDeep },
  breadcrumb: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  crumbGroup: { flexDirection: 'row', alignItems: 'center' },
  crumb: { minHeight: touchTarget, justifyContent: 'center', paddingHorizontal: space[1] },
  crumbText: { fontSize: fontSize.body, color: colors.brandPrimary, fontWeight: fontWeight.medium },
  crumbCurrent: { color: colors.textPrimary, fontWeight: fontWeight.semibold },
  crumbSeparator: { fontSize: fontSize.body, color: colors.textSubtle },
  list: { gap: space[2] },
  row: { minHeight: touchTarget, flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  rowSelected: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimarySoft },
  rowPressed: { backgroundColor: colors.raised },
  rowText: { flex: 1, gap: 2 },
  rowName: { fontSize: fontSize.md, color: colors.textPrimary },
  rowPath: { fontSize: fontSize.xs, color: colors.textMuted },
  badge: { fontSize: fontSize.xs, color: colors.warnDeep, fontWeight: fontWeight.semibold },
  proposal: { gap: space[2] },
  actions: { flexDirection: 'row', gap: space[2] },
  action: { flex: 1 },
});
