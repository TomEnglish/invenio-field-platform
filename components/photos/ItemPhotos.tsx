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
// What the device last found for the item shows at once, offline too; the server is asked again for anything new.
const startFor = (receipt: string): Shown => {
  const found = keptItemPhotos(receipt);
  return found ? { receipt, status: 'ready', ...found } : { receipt, status: 'loading' };
};

// What an item looks like: the photos taken when it was received, and when it
// was counted. Tapping one opens it full screen. Photos come from the server:
// those already seen on this phone show offline too, and the rest load when the
// phone is online. Photos on screen stay until a newer answer replaces them.
export function ItemPhotos({ receivingRecordId }: { receivingRecordId: string | null | undefined }) {
  const receipt = receivingRecordId ?? '';
  const online = useNetworkStore(s => s.isOnline);
  const [state, setState] = useState<Shown>(() => startFor(receipt));
  const [refresh, setRefresh] = useState(0);
  const [open, setOpen] = useState<{ receipt: string; index: number } | null>(null);
  // Thumbnails whose image did not download (no signal, or a link past its hour), by link: a new
  // link for the photo is a new chance to load. And the link the full-screen view could not show.
  const [broken, setBroken] = useState<{ receipt: string; uris: Set<string> }>({ receipt, uris: new Set() });
  const [viewerBroken, setViewerBroken] = useState<string | null>(null);
  // The check behind photos already shown: under way, waiting for a signal, or failed.
  const [check, setCheck] = useState<{ receipt: string; status: 'idle' | 'checking' | 'pending' | 'failed' }>({ receipt, status: 'idle' });
  const resign = useRef<string[]>([]);  // photos the next load asks new links for
  const dropped = useRef(false);        // the signal dropped while this load was under way
  const latest = useRef<Shown>(state);
  latest.current = state;

  const load = (ids: string[] = []) => { resign.current = [...new Set([...resign.current, ...ids])]; setRefresh(n => n + 1); };

  useEffect(() => {
    if (!receipt) return;
    let live = true;
    const fresh = resign.current;
    resign.current = [];
    dropped.current = false;
    const before = latest.current.receipt === receipt ? latest.current : startFor(receipt);
    if (before !== latest.current) setState(before);
    const showing = () => latest.current.receipt === receipt && latest.current.status === 'ready';
    if (before.status !== 'ready') setState({ receipt, status: 'loading' });
    setCheck({ receipt, status: before.status === 'ready' ? 'checking' : 'idle' });
    fetchItemPhotos(receipt, { resign: fresh })
      .then(found => {
        if (!live) return;
        if (found) {
          setState({ receipt, status: 'ready', ...found });
          setCheck({ receipt, status: 'idle' });
          // A failed link no longer in use is forgotten; a photo with a new link loads again.
          setBroken(now => ({ receipt, uris: new Set(now.receipt !== receipt ? [] : [...now.uris].filter(uri => found.photos.some(photo => photo.uri === uri))) }));
        } else if (showing()) {
          // Offline: what is shown stays, and is checked again when the signal returns.
          setCheck({ receipt, status: 'pending' });
        } else {
          setState({ receipt, status: 'offline' });
        }
      })
      .catch(() => {
        if (!live) return;
        const online = useNetworkStore.getState().isOnline;
        // The signal went and came back during the load: try once more now it's back.
        if (online && dropped.current) { load(fresh); return; }
        if (showing()) setCheck({ receipt, status: online ? 'failed' : 'pending' });
        else setState({ receipt, status: online ? 'error' : 'offline' });
      });
    return () => { live = false; };
  }, [receipt, refresh]);

  const shown = state.receipt === receipt ? state : startFor(receipt);
  const checking = check.receipt === receipt ? check.status : 'idle';
  const failedUris = broken.receipt === receipt ? broken.uris : new Set<string>();
  const shownPhotos = shown.status === 'ready' ? shown.photos : [];
  const failedIds = shownPhotos.filter(photo => failedUris.has(photo.uri)).map(photo => photo.id);
  const viewerFailedId = shownPhotos.find(photo => photo.uri === viewerBroken)?.id;
  // Back online: load or check what didn't finish, and what didn't show. Photos already shown stay when the signal drops.
  useEffect(() => {
    if (!online) { if (shown.status === 'loading' || checking === 'checking') dropped.current = true; return; }
    if (shown.status === 'offline' || shown.status === 'error' || checking === 'pending' || checking === 'failed' || failedIds.length || viewerFailedId) {
      load([...failedIds, ...(viewerFailedId ? [viewerFailedId] : [])]);
    }
  }, [online]);

  if (!receipt) return null;
  const photos = shown.status === 'ready' ? shown.photos : [];
  const at = open && open.receipt === receipt && open.index < photos.length ? open.index : null;
  const current = at === null ? null : photos[at];
  const close = () => setOpen(null);
  const step = (by: number) => setOpen(now => now && { receipt: now.receipt, index: (now.index + by + photos.length) % photos.length });
  const markBroken = (uri: string) => setBroken(now => now.receipt === receipt && now.uris.has(uri) ? now : { receipt, uris: new Set(now.receipt === receipt ? now.uris : []).add(uri) });
  const reloadBroken = () => load(failedIds);

  return (
    <View style={styles.section}>
      <Text style={styles.title} accessibilityRole="header">Photos</Text>
      {shown.status === 'loading' ? <Text style={styles.note}>Loading photos…</Text> : null}
      {shown.status === 'offline' ? <Text style={styles.note}>Photos show when this phone is online.</Text> : null}
      {shown.status === 'error' ? (
        <View style={styles.retry}>
          <Text style={styles.note} accessibilityRole="alert">Photos could not be loaded.</Text>
          <Button title="Try again" variant="secondary" onPress={() => load()} />
        </View>
      ) : null}
      {shown.status === 'ready' && !photos.length && !shown.missing ? <Text style={styles.note}>No photos were taken for this item.</Text> : null}
      {shown.status === 'ready' && checking === 'checking' ? <Text style={styles.note}>Checking for new photos…</Text> : null}
      {shown.status === 'ready' && checking === 'pending' ? <Text style={styles.note}>Showing what this phone found earlier. New photos load when it is online.</Text> : null}
      {shown.status === 'ready' && checking === 'failed' ? (
        <View style={styles.retry}>
          <Text style={styles.note} accessibilityRole="alert">Showing what this phone found earlier. New photos could not be checked.</Text>
          <Button title="Check again" variant="secondary" onPress={() => load(failedIds)} />
        </View>
      ) : null}
      {photos.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {photos.map((photo, index) => {
            const unavailable = failedUris.has(photo.uri);
            return (
              <Pressable
                key={`${photo.id}|${photo.uri}`}
                accessibilityRole="imagebutton"
                accessibilityLabel={unavailable
                  ? `Photo ${index + 1} of ${photos.length}, unavailable: ${caption(photo)}`
                  : `Open photo ${index + 1} of ${photos.length}: ${caption(photo)}`}
                onPress={() => { setViewerBroken(null); setOpen({ receipt, index }); }}
                style={({ pressed }) => [styles.thumb, pressed && styles.pressed]}
              >
                {unavailable ? (
                  <View style={[styles.thumbImage, styles.thumbMissing]}><Text style={styles.missingText}>Unavailable</Text></View>
                ) : (
                  <Image source={{ uri: photo.uri }} style={styles.thumbImage} onError={() => markBroken(photo.uri)} accessibilityIgnoresInvertColors />
                )}
                <Text style={styles.thumbLabel} numberOfLines={1}>{photo.short}</Text>
                <Text style={styles.thumbDate} numberOfLines={1}>{shortDate(photo.takenAt)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      {shown.status === 'ready' && shown.missing ? (
        <Text style={styles.note}>{shown.missing === 1 ? '1 photo could not be opened.' : `${shown.missing} photos could not be opened.`}</Text>
      ) : null}
      {failedIds.length ? (
        <View style={styles.retry}>
          <Text style={styles.note}>{failedIds.length === 1 ? '1 photo did not load.' : `${failedIds.length} photos did not load.`}</Text>
          <Button title="Reload photos" variant="secondary" onPress={reloadBroken} />
        </View>
      ) : null}

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
            {viewerBroken === current.uri ? (
              <View style={styles.viewerMissing}>
                <Text style={styles.viewerNote} accessibilityRole="alert">This photo could not be opened.</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Try this photo again" onPress={() => load([current.id])} style={styles.navButton}>
                  <Text style={styles.navText}>Try again</Text>
                </Pressable>
              </View>
            ) : (
              <Image key={current.uri} source={{ uri: current.uri }} style={styles.viewerImage} resizeMode="contain" onError={() => setViewerBroken(current.uri)} accessibilityLabel={caption(current)} accessibilityIgnoresInvertColors />
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
  viewerMissing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[3], paddingHorizontal: space[6] },
  viewerNote: { fontSize: fontSize.md, color: colors.navInk, textAlign: 'center' },
  viewerNav: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space[4], paddingTop: space[3] },
  navButton: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: touchTarget, paddingHorizontal: space[3] },
  navText: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.navInk },
});
