import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Polygon as SvgPolygon } from 'react-native-svg';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Button } from '@/components/ui/Button';
import type { SiteMap, SiteMapZone } from '@/lib/api/inventory';
import {
  centredView, clampView, fitContain, panBy, pinToScreen, polygonArea, polygonPoints, screenToPin, viewForBounds, zoomAt,
  MAX_ZOOM, MIN_ZOOM, type MapView, type Pin, type Size,
} from '@/lib/inventory/siteMap';
import { areaBounds, areaPath, buildAreaTree, deepestAreaAt } from '@/lib/inventory/areas';
import { colors, radius, space, fontSize, tint } from '@/lib/design/tokens';

interface Props {
  map: SiteMap;
  imageUri: string | null;
  // The plan's active areas; nested areas are drawn on top of their parents.
  zones: SiteMapZone[];
  pin: Pin | null;
  zoneId: string | null;
  initialView?: MapView | null;
  // Zooms to an area picked from the list; a new nonce repeats the zoom.
  focus?: { areaId: string; nonce: number } | null;
  onChange: (value: { pin: Pin | null; zone: SiteMapZone | null }) => void;
  onViewChange?: (view: MapView) => void;
}

const PIN_SIZE = 32;
const zoneColor = (zone: SiteMapZone) => (zone.color && /^#[0-9A-Fa-f]{6}$/.test(zone.color) ? zone.color : colors.brandPrimary);

// The cached site-plan image with pinch-zoom, pan and tap-to-pin. Areas are
// drawn from their normalised polygons: the chosen area strongly, the areas
// above it faintly. A tap chooses the smallest area under the finger.
export function SiteMapPicker({ map, imageUri, zones, pin, zoneId, initialView, focus, onChange, onViewChange }: Props) {
  const [frame, setFrame] = useState<Size>({ width: 0, height: 0 });
  const [measured, setMeasured] = useState<Size | null>(null);
  const [view, setView] = useState<MapView | null>(null);
  const viewRef = useRef<MapView | null>(null);

  const image: Size | null = map.image_width && map.image_height ? { width: map.image_width, height: map.image_height } : measured;
  useEffect(() => {
    if (map.image_width && map.image_height || !imageUri) return;
    let live = true;
    Image.getSize(imageUri, (width, height) => { if (live) setMeasured({ width, height }); }, () => {});
    return () => { live = false; };
  }, [imageUri, map.image_width, map.image_height]);

  const apply = (next: MapView) => { viewRef.current = next; setView(next); };
  useEffect(() => {
    if (!image || frame.width === 0) return;
    apply(clampView(viewRef.current ?? initialView ?? centredView(image, frame), image, frame));
  // Re-fit only when the frame, plan or image size changes.
  }, [frame.width, frame.height, image?.width, image?.height, map.id]);

  const finish = () => { if (viewRef.current) onViewChange?.(viewRef.current); };
  // A list pick may arrive before the plan has been measured; it waits here.
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => { if (focus) pendingFocus.current = focus.areaId; }, [focus?.nonce]);
  useEffect(() => {
    const area = zones.find(zone => zone.id === pendingFocus.current);
    if (!area || !image || frame.width === 0) return;
    pendingFocus.current = null;
    apply(viewForBounds(areaBounds(area.shape), image, frame));
    finish();
  }, [focus?.nonce, frame.width, frame.height, image?.width, image?.height, zones]);
  // Gesture handlers read the latest props from here, so the gesture itself is
  // built once and is never re-attached in the middle of a pinch.
  const latest = useRef({ image, frame, zones, onChange, finish });
  latest.current = { image, frame, zones, onChange, finish };

  const gesture = useMemo(() => {
    const pinchStart = { current: null as { view: MapView; focus: { x: number; y: number } } | null };
    // A one-finger pan can stay active while a pinch runs (iOS). It pauses
    // during the pinch and then continues from wherever the pinch left the view.
    const panBase = { current: null as { view: MapView; x: number; y: number } | null };
    const panLast = { x: 0, y: 0 };
    let pinching = false;
    const pinch = Gesture.Pinch().runOnJS(true)
      .onStart(e => { pinching = true; pinchStart.current = viewRef.current ? { view: viewRef.current, focus: { x: e.focalX, y: e.focalY } } : null; })
      .onUpdate(e => {
        const start = pinchStart.current, { image: size, frame: box } = latest.current;
        if (!start || !size) return;
        apply(zoomAt(start.view, start.view.scale * e.scale, start.focus, size, box, { x: e.focalX, y: e.focalY }));
      })
      .onFinalize(() => {
        if (!pinching) return;
        pinching = false;
        if (viewRef.current) panBase.current = { view: viewRef.current, x: panLast.x, y: panLast.y };
        latest.current.finish();
      });
    const pan = Gesture.Pan().runOnJS(true).maxPointers(1).minDistance(6)
      .onStart(() => { panLast.x = 0; panLast.y = 0; panBase.current = viewRef.current ? { view: viewRef.current, x: 0, y: 0 } : null; })
      .onUpdate(e => {
        panLast.x = e.translationX; panLast.y = e.translationY;
        const base = panBase.current, { image: size, frame: box } = latest.current;
        if (pinching || !base || !size) return;
        apply(panBy(base.view, e.translationX - base.x, e.translationY - base.y, size, box));
      })
      .onEnd(() => latest.current.finish());
    const tap = Gesture.Tap().runOnJS(true).maxDistance(10).onEnd((e, success) => {
      const { image: size, frame: box, zones: shapes, onChange: change } = latest.current;
      if (!success || !size || !viewRef.current) return;
      const next = screenToPin({ x: e.x, y: e.y }, viewRef.current, size, box);
      if (next) change({ pin: next, zone: deepestAreaAt(shapes, next) });
    });
    return Gesture.Race(tap, Gesture.Simultaneous(pinch, pan));
  }, []);

  const zoomBy = (factor: number) => {
    if (!image || !viewRef.current) return;
    apply(zoomAt(viewRef.current, viewRef.current.scale * factor, { x: frame.width / 2, y: frame.height / 2 }, image, frame));
    finish();
  };
  const reset = () => { if (image) { apply(centredView(image, frame)); finish(); } };

  const base = image ? fitContain(image, frame) : { width: 0, height: 0 };
  const shown = view ? { width: base.width * view.scale, height: base.height * view.scale } : base;
  const pinPoint = pin && view && image ? pinToScreen(pin, view, image, frame) : null;
  const activeZone = zones.find(zone => zone.id === zoneId) ?? null;
  const drawn = useMemo(() => {
    const ancestors = new Set(areaPath(buildAreaTree(zones), zoneId).map(area => area.id));
    // Largest first, so nested areas sit on top and stay tappable to the eye.
    return [...zones].sort((a, b) => polygonArea(b.shape) - polygonArea(a.shape))
      .map(zone => ({ zone, tier: zone.id === zoneId ? 'selected' : ancestors.has(zone.id) ? 'parent' : 'other' } as const));
  }, [zones, zoneId]);

  return (
    <View style={styles.container}>
      {/* The border sits outside the measured frame so taps and the fit use the same box. */}
      <View style={styles.border}>
      <GestureDetector gesture={gesture}>
        <View style={styles.frame} collapsable={false} onLayout={(e: LayoutChangeEvent) => setFrame({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
          accessible accessibilityLabel={`Site plan ${map.name}. Tap an area to choose it and drop a pin; pinch to zoom.`} accessibilityHint={activeZone ? `${activeZone.name} is chosen` : undefined}>
          {!imageUri ? (
            <View style={styles.placeholder}>
              <FontAwesome name="map-o" size={28} color={colors.textSubtle} />
              <Text style={styles.placeholderText}>This site plan isn't on the device yet. Open Count while online to download it, or choose an area from the list.</Text>
            </View>
          ) : view && image ? (
            <View style={[styles.content, { left: view.x, top: view.y, width: shown.width, height: shown.height }]}>
              <Image source={{ uri: imageUri }} style={{ width: shown.width, height: shown.height }} resizeMode="stretch" />
              <Svg width={shown.width} height={shown.height} style={StyleSheet.absoluteFill}>
                {drawn.map(({ zone, tier }) => {
                  const color = zoneColor(zone);
                  return <SvgPolygon key={zone.id} points={polygonPoints(zone.shape, shown)} stroke={color}
                    fill={tint(color, tier === 'selected' ? 0.32 : tier === 'parent' ? 0.1 : 0.06)}
                    strokeWidth={tier === 'selected' ? 3 : tier === 'parent' ? 2 : 1}
                    strokeDasharray={tier === 'parent' ? '6 4' : undefined}
                    strokeOpacity={tier === 'other' ? 0.6 : 1} />;
                })}
              </Svg>
            </View>
          ) : null}
          {pinPoint ? (
            <View style={[styles.pin, { left: pinPoint.x - PIN_SIZE / 2, top: pinPoint.y - PIN_SIZE }]}>
              <FontAwesome name="map-marker" size={PIN_SIZE} color={colors.danger} />
            </View>
          ) : null}
        </View>
      </GestureDetector>
      </View>
      {imageUri ? (
        <View style={styles.controls}>
          <Button title="−" accessibilityLabel="Zoom out" variant="secondary" onPress={() => zoomBy(1 / 1.6)} disabled={!view || view.scale <= MIN_ZOOM} style={styles.control} />
          <Button title="Fit" accessibilityLabel="Fit the whole plan" variant="secondary" onPress={reset} disabled={!view} style={styles.control} />
          <Button title="+" accessibilityLabel="Zoom in" variant="secondary" onPress={() => zoomBy(1.6)} disabled={!view || view.scale >= MAX_ZOOM} style={styles.control} />
          <Button title="Clear pin" variant="ghost" onPress={() => onChange({ pin: null, zone: activeZone })} disabled={!pin} style={styles.control} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: space[2] },
  border: { flex: 1, minHeight: 240, overflow: 'hidden', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised },
  frame: { flex: 1, overflow: 'hidden' },
  content: { position: 'absolute', pointerEvents: 'none' },
  pin: { position: 'absolute', width: PIN_SIZE, height: PIN_SIZE, alignItems: 'center', pointerEvents: 'none' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[3], padding: space[6] },
  placeholderText: { fontSize: fontSize.body, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
  controls: { flexDirection: 'row', gap: space[2] },
  control: { flex: 1, paddingHorizontal: space[2] },
});
