// The camera reports a code many times a second while it is in view, and two
// labels can be in view at once. Each code is passed on once, then ignored
// until it has been out of view for windowMs.
export const REPEAT_WINDOW_MS = 2000;
export function createRepeatFilter(windowMs = REPEAT_WINDOW_MS) {
  const seen = new Map<string, number>();
  return (raw: string, now = Date.now()): boolean => {
    const code = raw.trim();
    for (const [key, at] of seen) if (now - at >= windowMs) seen.delete(key);
    const fresh = !!code && !seen.has(code);
    if (code) seen.set(code, now);
    return fresh;
  };
}
