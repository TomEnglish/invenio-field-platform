import { useEffect, useState } from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { itemOnLoadNow, packedInNow } from '@/lib/api/logistics';
import { getQueue, type QueueItem } from '@/lib/sync/offlineQueue';
import type { LoadAction } from '@/lib/logistics/crates';
import { groupRoute } from './routes';
import { waitingChanges } from './useLoadReference';
import { colors, radius, space, fontSize, fontWeight, touchTarget } from '@/lib/design/tokens';

// "In crate HU-… at <location>" for a packed item, which opens the crate; for
// a loose item, its current load or where a load left it ("On load L-0003
// (to Gulf Machine)"), which opens the load. Nothing shows otherwise.
export function PackedInNote({ tag }: { tag: string | null | undefined }) {
  const [found, setFound] = useState<{ route: 'crate' | 'load'; params: Record<string, string>; text: string } | null>(null);
  useEffect(() => {
    let live = true;
    setFound(null);
    if (!tag?.trim()) return;
    void (async () => {
      const queue = await getQueue().catch(() => [] as QueueItem[]);
      const pending = waitingChanges(queue).pending.map(item => item.action as LoadAction);
      const crate = await packedInNow(tag, pending).catch(() => null);
      if (crate) { if (live) setFound({ route: 'crate', params: { code: crate.code }, text: crate.text }); return; }
      const load = await itemOnLoadNow(tag, pending).catch(() => null);
      if (live) setFound(load ? { route: 'load', params: { id: load.loadId }, text: load.text } : null);
    })();
    return () => { live = false; };
  }, [tag]);
  if (!found) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${found.text}. Open the ${found.route}.`}
      onPress={() => router.push({ pathname: groupRoute(found.route) as any, params: found.params })}
      style={({ pressed }) => [styles.note, pressed && styles.pressed]}
    >
      <FontAwesome name={found.route === 'crate' ? 'archive' : 'truck'} size={16} color={colors.brandPrimary} />
      <Text style={styles.text}>{found.text}</Text>
      <FontAwesome name="chevron-right" size={12} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  note: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: touchTarget, paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radius.md, backgroundColor: colors.brandPrimarySoft },
  pressed: { opacity: 0.8 },
  text: { flex: 1, fontSize: fontSize.body, fontWeight: fontWeight.medium, color: colors.textPrimary },
});
