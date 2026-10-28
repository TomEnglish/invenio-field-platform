// Site-plan maths. Pins and zone shapes use normalised image coordinates:
// 0–1 on each axis, origin top-left, matching site_map_zones.shape and
// inventory_records.pin_x / pin_y.

export interface Pin { x: number; y: number }
export type Polygon = [number, number][];
export interface ZoneShape { id: string; shape: Polygon }

// Ray casting; points exactly on an edge may fall either side, which is fine
// for a finger tap.
export function pointInPolygon(point: Pin, polygon: Polygon): boolean {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > point.y) !== (yj > point.y) && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function polygonArea(polygon: Polygon): number {
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    sum += polygon[j][0] * polygon[i][1] - polygon[i][0] * polygon[j][1];
  }
  return Math.abs(sum) / 2;
}

export function polygonCentroid(polygon: Polygon): Pin {
  const n = polygon.length || 1;
  return {
    x: polygon.reduce((total, [x]) => total + x, 0) / n,
    y: polygon.reduce((total, [, y]) => total + y, 0) / n,
  };
}

// The smallest zone containing the pin wins, so a bay drawn inside a yard
// zone is chosen over the yard.
export function zoneAt<T extends ZoneShape>(zones: T[], point: Pin): T | null {
  let best: T | null = null;
  let bestArea = Infinity;
  for (const zone of zones) {
    if (!pointInPolygon(point, zone.shape)) continue;
    const area = polygonArea(zone.shape);
    if (area < bestArea) { best = zone; bestArea = area; }
  }
  return best;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// The server stores six decimal places.
export function roundPin(pin: Pin): Pin {
  return { x: Math.round(clamp(pin.x, 0, 1) * 1e6) / 1e6, y: Math.round(clamp(pin.y, 0, 1) * 1e6) / 1e6 };
}

export function isValidPin(pin: unknown): pin is Pin {
  const p = pin as Pin;
  return !!p && typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)
    && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
}

export interface Size { width: number; height: number }
// Zoom and pan of the map inside its frame. x / y are the screen position of
// the image's top-left corner, relative to the frame.
export interface MapView { scale: number; x: number; y: number }

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

// Base size of the image fitted inside the frame at zoom 1.
export function fitContain(image: Size, frame: Size): Size {
  if (image.width <= 0 || image.height <= 0 || frame.width <= 0 || frame.height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(frame.width / image.width, frame.height / image.height);
  return { width: image.width * scale, height: image.height * scale };
}

export function centredView(image: Size, frame: Size): MapView {
  const base = fitContain(image, frame);
  return { scale: 1, x: (frame.width - base.width) / 2, y: (frame.height - base.height) / 2 };
}

// Keep the image on screen: centred on an axis where it is smaller than the
// frame, otherwise no gap at either edge.
export function clampView(view: MapView, image: Size, frame: Size): MapView {
  const base = fitContain(image, frame);
  const scale = clamp(Number.isFinite(view.scale) ? view.scale : 1, MIN_ZOOM, MAX_ZOOM);
  const width = base.width * scale;
  const height = base.height * scale;
  const axis = (position: number, content: number, room: number) =>
    content <= room ? (room - content) / 2 : clamp(Number.isFinite(position) ? position : 0, room - content, 0);
  return { scale, x: axis(view.x, width, frame.width), y: axis(view.y, height, frame.height) };
}

// Zoom to `scale` keeping the image point under `focus` (frame coordinates)
// under the finger. During a pinch the fingers also move: pass their current
// midpoint as `moveTo` to pan with them.
export function zoomAt(view: MapView, scale: number, focus: { x: number; y: number }, image: Size, frame: Size, moveTo = focus): MapView {
  const base = fitContain(image, frame);
  if (base.width === 0) return view;
  const next = clamp(scale, MIN_ZOOM, MAX_ZOOM);
  const u = (focus.x - view.x) / (base.width * view.scale);
  const v = (focus.y - view.y) / (base.height * view.scale);
  return clampView({ scale: next, x: moveTo.x - u * base.width * next, y: moveTo.y - v * base.height * next }, image, frame);
}

export function panBy(view: MapView, dx: number, dy: number, image: Size, frame: Size): MapView {
  return clampView({ scale: view.scale, x: view.x + dx, y: view.y + dy }, image, frame);
}

// Frame point → normalised pin, or null when the tap misses the image.
export function screenToPin(point: { x: number; y: number }, view: MapView, image: Size, frame: Size): Pin | null {
  const base = fitContain(image, frame);
  if (base.width === 0) return null;
  const x = (point.x - view.x) / (base.width * view.scale);
  const y = (point.y - view.y) / (base.height * view.scale);
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return roundPin({ x, y });
}

export function pinToScreen(pin: Pin, view: MapView, image: Size, frame: Size): { x: number; y: number } {
  const base = fitContain(image, frame);
  return { x: view.x + pin.x * base.width * view.scale, y: view.y + pin.y * base.height * view.scale };
}

// SVG "points" attribute for a zone at the current displayed size.
export function polygonPoints(shape: Polygon, size: Size): string {
  return shape.map(([x, y]) => `${(x * size.width).toFixed(1)},${(y * size.height).toFixed(1)}`).join(' ');
}

// Zoom so normalised bounds (an area's outline) fill the frame with a margin,
// centred, within the zoom limits.
export function viewForBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }, image: Size, frame: Size, margin = 0.15): MapView {
  const base = fitContain(image, frame);
  if (base.width === 0) return { scale: 1, x: 0, y: 0 };
  const width = Math.max(bounds.maxX - bounds.minX, 1e-3) * base.width;
  const height = Math.max(bounds.maxY - bounds.minY, 1e-3) * base.height;
  const scale = clamp(Math.min(frame.width / (width * (1 + 2 * margin)), frame.height / (height * (1 + 2 * margin))), MIN_ZOOM, MAX_ZOOM);
  const centreX = ((bounds.minX + bounds.maxX) / 2) * base.width * scale;
  const centreY = ((bounds.minY + bounds.maxY) / 2) * base.height * scale;
  return clampView({ scale, x: frame.width / 2 - centreX, y: frame.height / 2 - centreY }, image, frame);
}
