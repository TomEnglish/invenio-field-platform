import { useEffect, useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { itemOnLoadNow, packedInNow } from '@/lib/api/logistics';
import { lookupTag } from '@/lib/api/tags';
import { getQueue, type QueueItem } from '@/lib/sync/offlineQueue';
import type { LoadAction } from '@/lib/logistics/crates';
import { positionNote } from '@/lib/logistics/positions';
import { groupRoute } from './routes';
import { waitingChanges } from './useLoadReference';
import { colors, radius, space, fontSize, fontWeight, touchTarget } from '@/lib/design/tokens';

type Found = { route: 'crate' | 'load' | null; params: Record<string, string>; text: string };

// Where an item is now. Online, the server's answer (022's item_positions):
// in a crate (opens it), on or missing from a load (opens it), or its place
// and area. Offline, before 022, or while a change to it waits in Sync, the
// device's copy with those changes over it: "In crate HU-… at <location>", or
// its current load or where a load left it ("On load L-0003 (to Gulf Machine)").
export function PackedInNote({ tag }: { tag: string | null | undefined }) {
  const [found, setFound] = useState<Found | null>(null);
  useEffect(() => {
    let live = true;
    setFound(null);
    if (!tag?.trim()) return;
    void (async () => {
      const queue = await getQueue().catch(() => [] as QueueItem[]);
      const pending = waitingChanges(queue).pending.map(item => item.action as LoadAction);
      const wanted = tag.trim().toLowerCase();
      const waiting = pending.some(action => JSON.stringify(action.payload ?? '').toLowerCase().includes(wanted));
      const server = waiting ? null : positionNote(await lookupTag(tag).catch(() => null));
      if (server) { if (live) setFound(server); return; }
      const crate = await packedInNow(tag, pending).catch(() => null);
      if (crate) { if (live) setFound({ route: 'crate', params: { code: crate.code }, text: crate.text }); return; }
      const load = await itemOnLoadNow(tag, pending).catch(() => null);
      if (live) setFound(load ? { route: 'load', params: { id: load.loadId }, text: load.text } : null);
    })();
    return () => { live = false; };
  }, [tag]);
  if (!found) return null;
  const icon = <FontAwesome name={found.route === 'crate' ? 'archive' : found.route === 'load' ? 'truck' : 'map-marker'} size={16} color={colors.brandPrimary} />;
  if (!found.route) return <View style={styles.note} accessible accessibilityLabel={`Where it is: ${found.text}`}>{icon}<Text style={styles.text}>{found.text}</Text></View>;
  const route = found.route;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${found.text}. Open the ${route}.`}
      onPress={() => router.push({ pathname: groupRoute(route) as any, params: found.params })}
      style={({ pressed }) => [styles.note, pressed && styles.pressed]}
    >
      {icon}
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
