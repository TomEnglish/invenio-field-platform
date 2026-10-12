/**
 * Dark-mode-aware token hook for the Expo app.
 *
 * Usage (simple — when you just need a color):
 *   const c = useTokens();
 *   <View style={{ backgroundColor: c.canvas }} />
 *
 * Usage (typical — when you have a StyleSheet):
 *   const styles = useThemedStyles((c) => ({
 *     container: { backgroundColor: c.canvas },
 *     title:     { color: c.textPrimary, fontSize: 18 },
 *   }));
 *
 * Why the hook shape:
 *   `StyleSheet.create({...})` evaluated at module load freezes colors at
 *   light-mode values. To theme dynamically we either:
 *     (a) inline color props via `style={[base, { backgroundColor: c.X }]}`
 *     (b) build the style sheet inside the component and memoize it
 *   `useThemedStyles` picks (b) — you still write a readable factory.
 *
 * Migration pattern (hand-audited, used for app/(office)/dashboard.tsx in
 * v0.6.0):
 *   1. Move the `const styles = StyleSheet.create({...})` body into a
 *      `useThemedStyles((c) => ({ ... }))` call inside the component.
 *   2. Replace every `colors.X` inside that factory with `c.X`.
 *   3. Any color used outside StyleSheet (e.g. FontAwesome `color=` prop)
 *      reads from `const c = useTokens()` at the top of the component.
 *
 * Root app setup: nothing required. `useColorScheme()` reads from the OS
 * per-user; honors `app.json`'s `userInterfaceStyle: "automatic"`.
 */
import { useMemo } from 'react';
import { useColorScheme, StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { colors as lightColors, colorsDark as darkColors } from './tokens';

// Widened from `as const` hex-literal types to plain `string` — otherwise
// the light and dark token sets have incompatible literal types and can't
// both be returned from the same hook.
export type ThemeColors = { readonly [K in keyof typeof lightColors]: string };

// Named "ThemeColors" to avoid collision with the base `colors` export
// from tokens.ts. Importers should do:
//   import type { ThemeColors } from '@/lib/design/useTokens';

/**
 * Returns the color token set matching the user's active color scheme.
 *
 * Defaults to light on `null` scheme (most desktop browsers, pre-Android-10).
 */
export function useTokens(): ThemeColors {
  const scheme = useColorScheme();
  return DARK_MODE_ENABLED && scheme === 'dark' ? darkColors : lightColors;
}

// Most screens, the shared components (Card, Button, headers), and the tab
// bar still use the static light `colors`. Following the OS dark scheme in
// only the screens that use this hook put light text on white cards, so
// stay light until every surface is migrated, then flip this on.
const DARK_MODE_ENABLED = false;

type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

/**
 * Build a theme-aware StyleSheet. The factory runs once per theme change
 * (rare — OS color scheme toggles at most a few times a session) and the
 * resulting StyleSheet is memoized.
 */
export function useThemedStyles<T extends NamedStyles<T>>(
  factory: (c: ThemeColors) => T
): T {
  const c = useTokens();
  return useMemo(() => StyleSheet.create(factory(c)), [c]);
}
