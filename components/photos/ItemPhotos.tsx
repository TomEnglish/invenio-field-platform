import { useEffect, useRef, useState } from 'react';
import { View, Text, Image, Pressable, ScrollView, Modal, StyleSheet } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Button } from '@/components/ui/Button';
import { fetchItemPhotos, keptItemPhotos, photoTakenText, type ItemPhoto } from '@/lib/api/photos';
import { shortDate } from '@/lib/inventory/count';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { colors, radius, space, fontSize, fontWeight, touchTarget } from '@/lib/design/tokens';

// What the section shows, and for which receipt: a change of item never shows the last item's photos.
type Shown =
  | { receipt: string; status: 'loading' | 'offline' | 'error' }
  | { receipt: string; status: 'ready'; photos: ItemPhoto[]; missing: number };

const caption = (photo: ItemPhoto) => [photo.label, photoTakenText(photo.takenAt)].filter(Boolean).join(' · ');
// The device's copy when its links still work, so photos already seen show at once, offline too.
const startFor = (receipt: string): Shown => {
  const found = keptItemPhotos(receipt);
  return found ? { receipt, status: 'ready', ...found } : { receipt, status: 'loading' };
};

// What an item looks like: the photos taken when it was received, and when it
// was counted. Tapping one opens it full screen. Photos come from the server, so
// photos not yet seen show only while the phone is online.
export function ItemPhotos({ receivingRecordId }: { receivingRecordId: string | null | undefined }) {
  const receipt = receivingRecordId ?? '';
  const online = useNetworkStore(s => s.isOnline);
  const [state, setState] = useState<Shown>(() => startFor(receipt));
  const [refresh, setRefresh] = useState(0);
  const [open, setOpen] = useState<{ receipt: string; index: number } | null>(null);
  // Photos whose image did not download (no signal, or a link past its hour), by id.
  const [broken, setBroken] = useState<{ receipt: string; ids: Set<string> }>({ receipt, ids: new Set() });
  const fresh = useRef(false);    // the next load asks the server, past the device's copy
  const dropped = useRef(false);  // the signal dropped while this load was under way

  useEffect(() => {
    if (!receipt) return;
    let live = true;
    const kept = fresh.current ? null : keptItemPhotos(receipt);
    fresh.current = false;
    dropped.current = false;
    setBroken({ receipt, ids: new Set() });
    if (kept) { setState({ receipt, status: 'ready', ...kept }); return; }
    setState({ receipt, status: 'loading' });
    fetchItemPhotos(receipt)
      .then(found => { if (live) setState(found ? { receipt, status: 'ready', ...found } : { receipt, status: 'offline' }); })
      .catch(() => {
        if (!live) return;
        if (!useNetworkStore.getState().isOnline) setState({ receipt, status: 'offline' });
        // The signal went and came back during the load: try once more now it's back.
        else if (dropped.current) { fresh.current = true; setRefresh(n => n + 1); }
        else setState({ receipt, status: 'error' });
      });
    return () => { live = false; };
  }, [receipt, refresh]);

  const shown = state.receipt === receipt ? state : startFor(receipt);
  const failedIds = broken.receipt === receipt ? broken.ids : new Set<string>();
  // Back online: load what didn't show. Photos already shown stay when the signal drops.
  useEffect(() => {
    if (!online) { if (shown.status === 'loading') dropped.current = true; return; }
    if (shown.status === 'offline' || shown.status === 'error' || failedIds.size) { fresh.current = true; setRefresh(n => n + 1); }
  }, [online]);

  if (!receipt) return null;
  const photos = shown.status === 'ready' ? shown.photos : [];
  const at = open && open.receipt === receipt && open.index < photos.length ? open.index : null;
  const current = at === null ? null : photos[at];
  const close = () => setOpen(null);
  const step = (by: number) => setOpen(now => now && { receipt: now.receipt, index: (now.index + by + photos.length) % photos.length });
  const markBroken = (id: string) => setBroken(now => now.receipt === receipt && now.ids.has(id) ? now : { receipt, ids: new Set(now.receipt === receipt ? now.ids : []).add(id) });

  return (
    <View style={styles.section}>
      <Text style={styles.title} accessibilityRole="header">Photos</Text>
      {shown.status === 'loading' ? <Text style={styles.note}>Loading photos…</Text> : null}
      {shown.status === 'offline' ? <Text style={styles.note}>Photos show when this phone is online.</Text> : null}
      {shown.status === 'error' ? (
        <View style={styles.retry}>
          <Text style={styles.note} accessibilityRole="alert">Photos could not be loaded.</Text>
          <Button title="Try again" variant="secondary" onPress={() => { fresh.current = true; setRefresh(n => n + 1); }} />
        </View>
      ) : null}
      {shown.status === 'ready' && !photos.length && !shown.missing ? <Text style={styles.note}>No photos were taken for this item.</Text> : null}
      {photos.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {photos.map((photo, index) => (
            <Pressable
              key={photo.id}
              accessibilityRole="imagebutton"
              accessibilityLabel={`Open photo ${index + 1} of ${photos.length}: ${caption(photo)}`}
              onPress={() => setOpen({ receipt, index })}
              style={({ pressed }) => [styles.thumb, pressed && styles.pressed]}
            >
              {failedIds.has(photo.id) ? (
                <View style={[styles.thumbImage, styles.thumbMissing]}><Text style={styles.missingText}>Unavailable</Text></View>
              ) : (
                <Image source={{ uri: photo.uri }} style={styles.thumbImage} onError={() => markBroken(photo.id)} accessibilityIgnoresInvertColors />
              )}
              <Text style={styles.thumbLabel} numberOfLines={1}>{photo.short}</Text>
              <Text style={styles.thumbDate} numberOfLines={1}>{shortDate(photo.takenAt)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {shown.status === 'ready' && shown.missing ? (
        <Text style={styles.note}>{shown.missing === 1 ? '1 photo could not be opened.' : `${shown.missing} photos could not be opened.`}</Text>
      ) : null}
      {failedIds.size ? <Text style={styles.note}>Photos marked Unavailable load again when the signal returns.</Text> : null}

      <Modal visible={!!current} animationType="fade" onRequestClose={close} supportedOrientations={['portrait', 'landscape']}>
        {current ? (
          <View style={styles.viewer} accessibilityViewIsModal>
            <View style={styles.viewerBar}>
              <Text style={styles.viewerCaption} numberOfLines={2}>
                {caption(current)}{photos.length > 1 ? ` · ${(at ?? 0) + 1} of ${photos.length}` : ''}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close photos" onPress={close} style={styles.iconButton} hitSlop={8}>
                <FontAwesome name="close" size={22} color={colors.navInk} />
              </Pressable>
            </View>
            {failedIds.has(current.id) ? (
              <View style={styles.viewerMissing}><Text style={styles.viewerNote} accessibilityRole="alert">This photo could not be opened. Check the connection and try again.</Text></View>
            ) : (
              <Image source={{ uri: current.uri }} style={styles.viewerImage} resizeMode="contain" onError={() => markBroken(current.id)} accessibilityLabel={caption(current)} accessibilityIgnoresInvertColors />
            )}
            {photos.length > 1 ? (
              <View style={styles.viewerNav}>
                <Pressable accessibilityRole="button" accessibilityLabel="Previous photo" onPress={() => step(-1)} style={styles.navButton}>
                  <FontAwesome name="chevron-left" size={16} color={colors.navInk} />
                  <Text style={styles.navText}>Previous</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Next photo" onPress={() => step(1)} style={styles.navButton}>
                  <Text style={styles.navText}>Next</Text>
                  <FontAwesome name="chevron-right" size={16} color={colors.navInk} />
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space[4], borderWidth: 1, borderColor: colors.border, marginBottom: space[4], gap: space[3] },
  title: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  note: { fontSize: fontSize.body, color: colors.textMuted, lineHeight: 20 },
  retry: { gap: space[2], alignItems: 'flex-start' },
  strip: { gap: space[2] },
  thumb: { width: 96, gap: space[1] },
  pressed: { opacity: 0.7 },
  thumbImage: { width: 96, height: 96, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised },
  thumbMissing: { alignItems: 'center', justifyContent: 'center', padding: space[1] },
  missingText: { fontSize: fontSize.xs, color: colors.textMuted, textAlign: 'center' },
  thumbLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  thumbDate: { fontSize: fontSize.xs, color: colors.textMuted },
  viewer: { flex: 1, backgroundColor: colors.navBg, paddingTop: space[12], paddingBottom: space[8] },
  viewerBar: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingBottom: space[3] },
  viewerCaption: { flex: 1, fontSize: fontSize.body, fontWeight: fontWeight.semibold, color: colors.navInk },
  iconButton: { minWidth: touchTarget, minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  viewerImage: { flex: 1, width: '100%' },
  viewerMissing: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space[6] },
  viewerNote: { fontSize: fontSize.md, color: colors.navInk, textAlign: 'center' },
  viewerNav: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space[4], paddingTop: space[3] },
  navButton: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: touchTarget, paddingHorizontal: space[3] },
  navText: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.navInk },
});
