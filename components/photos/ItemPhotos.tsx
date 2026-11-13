import { useEffect, useState } from 'react';
import { View, Text, Image, Pressable, ScrollView, Modal, StyleSheet } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Button } from '@/components/ui/Button';
import { fetchItemPhotos, photoTakenText, type ItemPhoto } from '@/lib/api/photos';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { colors, radius, space, fontSize, fontWeight, touchTarget } from '@/lib/design/tokens';

type Shown =
  | { status: 'loading' }
  | { status: 'offline' }
  | { status: 'error' }
  | { status: 'ready'; photos: ItemPhoto[]; missing: number };

const caption = (photo: ItemPhoto) => [photo.label, photoTakenText(photo.takenAt)].filter(Boolean).join(' · ');

// What an item looks like: the photos taken when it was received, and when it
// was counted. Tapping one opens it full screen. Photos come from the server, so
// they show only while the phone is online.
export function ItemPhotos({ receivingRecordId }: { receivingRecordId: string | null | undefined }) {
  const online = useNetworkStore(s => s.isOnline);
  const [shown, setShown] = useState<Shown>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    setShown({ status: 'loading' });
    setOpen(null);
    fetchItemPhotos(receivingRecordId)
      .then(found => { if (live) setShown(found ? { status: 'ready', ...found } : { status: 'offline' }); })
      .catch(() => { if (live) setShown({ status: 'error' }); });
    return () => { live = false; };
  }, [receivingRecordId, attempt]);
  // Back online: try again if the photos were not shown. Photos already shown stay when the signal drops.
  useEffect(() => {
    if (online && (shown.status === 'offline' || shown.status === 'error')) setAttempt(n => n + 1);
  }, [online]);

  if (!receivingRecordId) return null;
  const photos = shown.status === 'ready' ? shown.photos : [];
  const current = open === null ? null : photos[open] ?? null;
  const step = (by: number) => setOpen(at => at === null ? null : (at + by + photos.length) % photos.length);

  return (
    <View style={styles.section}>
      <Text style={styles.title} accessibilityRole="header">Photos</Text>
      {shown.status === 'loading' ? <Text style={styles.note}>Loading photos…</Text> : null}
      {shown.status === 'offline' ? <Text style={styles.note}>Photos show when this phone is online.</Text> : null}
      {shown.status === 'error' ? (
        <View style={styles.retry}>
          <Text style={styles.note} accessibilityRole="alert">Photos could not be loaded.</Text>
          <Button title="Try again" variant="secondary" onPress={() => setAttempt(n => n + 1)} />
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
              onPress={() => setOpen(index)}
              style={({ pressed }) => [styles.thumb, pressed && styles.pressed]}
            >
              <Image source={{ uri: photo.uri }} style={styles.thumbImage} accessibilityIgnoresInvertColors />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {shown.status === 'ready' && shown.missing ? (
        <Text style={styles.note}>{shown.missing === 1 ? '1 photo could not be opened.' : `${shown.missing} photos could not be opened.`}</Text>
      ) : null}

      <Modal visible={!!current} animationType="fade" onRequestClose={() => setOpen(null)} supportedOrientations={['portrait', 'landscape']}>
        {current ? (
          <View style={styles.viewer} accessibilityViewIsModal>
            <View style={styles.viewerBar}>
              <Text style={styles.viewerCaption} numberOfLines={2}>
                {caption(current)}{photos.length > 1 ? ` · ${(open ?? 0) + 1} of ${photos.length}` : ''}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close photos" onPress={() => setOpen(null)} style={styles.iconButton} hitSlop={8}>
                <FontAwesome name="close" size={22} color={colors.navInk} />
              </Pressable>
            </View>
            <Image source={{ uri: current.uri }} style={styles.viewerImage} resizeMode="contain" accessibilityLabel={caption(current)} accessibilityIgnoresInvertColors />
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
  thumb: { width: 96, height: 96, borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised },
  pressed: { opacity: 0.7 },
  thumbImage: { width: '100%', height: '100%' },
  viewer: { flex: 1, backgroundColor: colors.navBg, paddingTop: space[12], paddingBottom: space[8] },
  viewerBar: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingBottom: space[3] },
  viewerCaption: { flex: 1, fontSize: fontSize.body, fontWeight: fontWeight.semibold, color: colors.navInk },
  iconButton: { minWidth: touchTarget, minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  viewerImage: { flex: 1, width: '100%' },
  viewerNav: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space[4], paddingTop: space[3] },
  navButton: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: touchTarget, paddingHorizontal: space[3] },
  navText: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.navInk },
});
