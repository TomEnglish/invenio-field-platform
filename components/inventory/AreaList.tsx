import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, type ViewStyle } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Input } from '@/components/ui/Input';
import type { SiteMapZone } from '@/lib/api/inventory';
import { areaPath, areaPathLabel, buildAreaTree, searchAreas, visibleAreaRows } from '@/lib/inventory/areas';
import { colors, radius, space, fontSize, fontWeight, touchTarget } from '@/lib/design/tokens';

interface Props {
  // The active areas of the plan on screen.
  areas: SiteMapZone[];
  selectedId: string | null;
  // Set when the plan was tapped: open the tree to that area and scroll to it.
  reveal: { areaId: string; nonce: number } | null;
  onSelect: (area: SiteMapZone) => void;
  style?: ViewStyle;
}

// The plan's areas as a collapsible tree with a breadcrumb and a search across
// every level. The same tree is drawn on the plan above it.
export function AreaList({ areas, selectedId, reveal, onSelect, style }: Props) {
  const tree = useMemo(() => buildAreaTree(areas), [areas]);
  // Each area's full path, worked out once per tree rather than per row.
  const paths = useMemo(() => new Map(areas.map(area => [area.id, areaPathLabel(tree, area.id)])), [areas, tree]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const rowY = useRef(new Map<string, number>());
  const pendingScroll = useRef<string | null>(null);

  const crumbs = areaPath(tree, selectedId);
  // The chosen area's parents are always open, whatever chose it.
  useEffect(() => {
    const parents = areaPath(tree, selectedId).slice(0, -1).map(area => area.id);
    if (parents.some(id => !expanded.has(id))) setExpanded(current => new Set([...current, ...parents]));
  }, [selectedId, tree]);
  const rows = visibleAreaRows(tree, expanded);
  // Positions of rows that are no longer shown are out of date.
  useEffect(() => {
    const shown = new Set(rows.map(row => row.area.id));
    for (const id of [...rowY.current.keys()]) if (!shown.has(id)) rowY.current.delete(id);
  });
  useEffect(() => {
    if (!reveal) return;
    setQuery(''); setSearching(false);
    const y = rows.some(row => row.area.id === reveal.areaId) ? rowY.current.get(reveal.areaId) : undefined;
    if (y !== undefined) {
      pendingScroll.current = null;
      scrollRef.current?.scrollTo({ y: Math.max(0, y - space[2]), animated: true });
    } else {
      // The row appears once its parents open; it scrolls when laid out.
      pendingScroll.current = reveal.areaId;
    }
  }, [reveal?.nonce]);

  const results = query.trim() ? searchAreas(tree, query) : [];
  const toggle = (id: string) => setExpanded(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const choose = (area: SiteMapZone) => { setQuery(''); setSearching(false); onSelect(area); };

  return (
    <View style={[styles.container, style]}>
      <View style={styles.header}>
      <View style={styles.breadcrumb} accessibilityRole="toolbar" accessibilityLabel="Chosen location">
        <Pressable accessibilityRole="button" accessibilityLabel="Show all areas" style={styles.crumb}
          onPress={() => { setExpanded(new Set(crumbs.slice(0, -1).map(area => area.id))); setQuery(''); scrollRef.current?.scrollTo({ y: 0, animated: true }); }}>
          <Text style={[styles.crumbText, crumbs.length === 0 && styles.crumbCurrent]}>All areas</Text>
        </Pressable>
        {crumbs.map(area => (
          <View key={area.id} style={styles.crumbGroup}>
            <Text style={styles.crumbSeparator}>›</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Choose ${area.name}`} style={styles.crumb} onPress={() => choose(area)}>
              <Text style={[styles.crumbText, area.id === selectedId && styles.crumbCurrent]}>{area.name}</Text>
            </Pressable>
          </View>
        ))}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={searching ? 'Close search' : 'Search areas'} accessibilityState={{ expanded: searching }} hitSlop={8} style={styles.searchToggle}
        onPress={() => { setSearching(!searching); setQuery(''); }}>
        <FontAwesome name={searching ? 'times' : 'search'} size={16} color={colors.brandPrimary} />
      </Pressable>
      </View>
      {searching ? <Input label="Search areas" value={query} onChangeText={setQuery} placeholder="e.g. rack 2" autoFocus autoCorrect={false} autoCapitalize="none" returnKeyType="search" /> : null}
      <ScrollView ref={scrollRef} style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
        {query.trim() ? (
          results.length === 0
            ? <Text style={styles.hint}>No area matches "{query.trim()}".</Text>
            : results.map(({ area, path }) => (
              <Pressable key={area.id} accessibilityRole="button" accessibilityLabel={`Choose ${path}`} onPress={() => choose(area)}
                style={({ pressed }) => [styles.row, area.id === selectedId && styles.rowSelected, pressed && styles.rowPressed]}>
                <View style={styles.rowText}>
                  <Text style={styles.rowName}>{area.name}</Text>
                  <Text style={styles.rowPath}>{path}</Text>
                </View>
              </Pressable>
            ))
        ) : rows.map(({ area, depth, hasChildren }) => {
          const chosen = area.id === selectedId;
          const open = expanded.has(area.id);
          return (
            <View key={area.id} style={[styles.row, { paddingLeft: space[2] + depth * space[5] }, chosen && styles.rowSelected]}
              onLayout={e => {
                rowY.current.set(area.id, e.nativeEvent.layout.y);
                if (pendingScroll.current === area.id) {
                  pendingScroll.current = null;
                  scrollRef.current?.scrollTo({ y: Math.max(0, e.nativeEvent.layout.y - space[2]), animated: true });
                }
              }}>
              {hasChildren ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`${open ? 'Collapse' : 'Expand'} ${area.name}`} accessibilityState={{ expanded: open }}
                  hitSlop={8} onPress={() => toggle(area.id)} style={styles.chevron}>
                  <FontAwesome name={open ? 'chevron-down' : 'chevron-right'} size={12} color={colors.textMuted} />
                </Pressable>
              ) : <View style={styles.chevron} />}
              <Pressable accessibilityRole="button" accessibilityState={{ selected: chosen }} accessibilityLabel={`Choose ${paths.get(area.id) ?? area.name}`}
                onPress={() => choose(area)} style={({ pressed }) => [styles.rowMain, pressed && styles.rowPressed]}>
                <Text style={[styles.rowName, chosen && styles.rowNameSelected]}>{area.name}</Text>
                {chosen ? <FontAwesome name="check" size={14} color={colors.brandPrimary} /> : null}
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space[1] },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  breadcrumb: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  searchToggle: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  crumbGroup: { flexDirection: 'row', alignItems: 'center' },
  crumb: { minHeight: touchTarget, justifyContent: 'center', paddingHorizontal: space[1] },
  crumbText: { fontSize: fontSize.body, color: colors.brandPrimary, fontWeight: fontWeight.medium },
  crumbCurrent: { color: colors.textPrimary, fontWeight: fontWeight.semibold },
  crumbSeparator: { fontSize: fontSize.body, color: colors.textSubtle },
  list: { flex: 1, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  listContent: { paddingVertical: space[1] },
  row: { minHeight: touchTarget, flexDirection: 'row', alignItems: 'center', paddingRight: space[3] },
  rowSelected: { backgroundColor: colors.brandPrimarySoft },
  rowPressed: { backgroundColor: colors.raised },
  chevron: { width: 28, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  rowMain: { flex: 1, minHeight: touchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  rowText: { flex: 1, gap: 2, paddingHorizontal: space[3], paddingVertical: space[2] },
  rowName: { fontSize: fontSize.md, color: colors.textPrimary },
  rowNameSelected: { fontWeight: fontWeight.semibold, color: colors.brandPrimary },
  rowPath: { fontSize: fontSize.xs, color: colors.textMuted },
  hint: { fontSize: fontSize.sm, color: colors.textMuted, padding: space[3] },
});
