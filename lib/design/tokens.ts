/**
 * Invenio unified design tokens.
 *
 * Single source of truth for color, type, spacing, radius, shadow, and motion
 * across the Expo app and the HTML marketing surfaces.
 *
 * If you find a hex literal in a component file — it should live here instead.
 * Every component under /components/ui/* imports from this module.
 *
 * See /docs/prototype.html for the rendered showcase, and /docs/brand.html for
 * brand asset usage.
 */
import { Platform } from 'react-native';
import type { ViewStyle } from 'react-native';

// ─────────────────────────────────────────────────────────────
// Colors — light (primary theme for the Expo app today)
// ─────────────────────────────────────────────────────────────

export const colors = {
  // Surfaces — values match the Invenio Portal (portal.inveniotech.org)
  canvas: '#F6F8FB',        // page background
  surface: '#FFFFFF',       // card / panel
  raised: '#EDF4FF',        // subtle fill (hover, row-stripe, table head)

  // Borders
  border: '#DDE5EF',
  borderStrong: '#CBD5E1',

  // Text
  textPrimary: '#122C4C',
  textMuted: '#566983',
  textSubtle: '#5F6E83',
  textInverse: '#FFFFFF',

  // Brand
  brandPrimary: '#174FDA',   // Invenio blue — primary CTA, focus ring
  brandPrimaryHover: '#1E40AF',
  brandPrimaryPressed: '#BFDBFE', // pressed-state fill for secondary buttons
  brandPrimarySoft: '#EDF4FF',
  brandAccent: '#0891B2',    // cyan-600 — secondary accent
  brandAccentSoft: '#CFFAFE',

  // Status
  success: '#059669',
  successSoft: '#D1FAE5',
  warn: '#D97706',
  warnSoft: '#FEF3C7',
  danger: '#DC2626',
  dangerHover: '#B91C1C',
  dangerSoft: '#FEE2E2',
  dangerDeep: '#991B1B',
  successDeep: '#166534',
  warnDeep: '#92400E',
  info: '#7C3AED',
  infoSoft: '#EDE9FE',

  // Navigation chrome — the portal's navy sidebar, used for app headers.
  // Navy in both themes.
  navBg: '#0D294A',
  navInk: '#F1F5F9',
  navMuted: '#B4C2D6',
  navHover: '#14325F',
  navBorder: '#26426B',
  navAccent: '#60A5FA',

  // Sign-in backdrop gradient stops
  heroStart: '#0B2545',
  heroEnd: '#1A56DB',

  // Overlay
  overlay: 'rgba(0, 0, 0, 0.5)',
} as const;

// Dark-theme counterparts. Every key in `colors` has a pair.
// Used by the HTML surfaces today; wire into the Expo app when dark mode ships.
export const colorsDark = {
  canvas: '#0B1220',
  surface: '#121D30',
  raised: '#1B304C',

  border: '#2B3B54',
  borderStrong: '#475569',

  textPrimary: '#EDF4FF',
  textMuted: '#ACBDD5',
  textSubtle: '#8595AB',
  textInverse: '#0B1220',

  brandPrimary: '#60A4FF',       // lighter Invenio blue for dark contrast
  brandPrimaryHover: '#91BFFF',
  brandPrimaryPressed: '#27456A',
  brandPrimarySoft: '#1B304C',
  brandAccent: '#0891B2',
  brandAccentSoft: 'rgba(8,145,178,0.18)',

  success: '#10B981',
  successSoft: 'rgba(16,185,129,0.15)',
  warn: '#F59E0B',
  warnSoft: 'rgba(245,158,11,0.15)',
  danger: '#EF4444',
  dangerHover: '#DC2626',
  dangerSoft: 'rgba(239,68,68,0.15)',
  dangerDeep: '#FCA5A5',
  successDeep: '#6EE7B7',
  warnDeep: '#FCD34D',
  info: '#8B5CF6',
  infoSoft: 'rgba(139,92,246,0.15)',

  navBg: '#0D294A',
  navInk: '#F1F5F9',
  navMuted: '#ACBDD5',
  navHover: '#14325F',
  navBorder: '#26426B',
  navAccent: '#60A4FF',

  heroStart: '#0B2545',
  heroEnd: '#1A56DB',

  overlay: 'rgba(0, 0, 0, 0.6)',
} as const;

// ─────────────────────────────────────────────────────────────
// Typography
// ─────────────────────────────────────────────────────────────

export const fontFamily = {
  base: Platform.select({
    ios: 'System',
    android: 'sans-serif',
    default: "'Segoe UI', Arial, sans-serif",
  }) as string,
  mono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  }) as string,
};

export const fontSize = {
  xs: 12,
  sm: 13,
  body: 14,
  md: 16,
  lg: 20,
  xl: 24,
  h2: 32,
  h1: 48,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
} as const;

export const lineHeight = {
  tight: 1.2,
  snug: 1.35,
  normal: 1.5,
  relaxed: 1.65,
} as const;

// ─────────────────────────────────────────────────────────────
// Spacing (4px base)
// ─────────────────────────────────────────────────────────────

export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

// ─────────────────────────────────────────────────────────────
// Radius
// ─────────────────────────────────────────────────────────────

export const radius = {
  sm: 6,    // small badges, toasts
  md: 6,    // buttons, inputs (portal controls)
  lg: 8,    // cards, panels, modals (portal surfaces)
  xl: 12,   // large hero surfaces
  pill: 999,
} as const;

// ─────────────────────────────────────────────────────────────
// Shadows (RN + web-compatible via Platform.select)
// ─────────────────────────────────────────────────────────────

const webShadow = (value: string): ViewStyle =>
  Platform.OS === 'web' ? ({ boxShadow: value } as unknown as ViewStyle) : {};

export const shadow = {
  sm: {
    shadowColor: '#122C4C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
    ...webShadow('0 2px 8px rgba(18,44,76,0.04)'),
  } as ViewStyle,
  md: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
    ...webShadow('0 4px 12px rgba(15,23,42,0.08)'),
  } as ViewStyle,
  lg: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 32,
    elevation: 8,
    ...webShadow('0 12px 32px rgba(15,23,42,0.12)'),
  } as ViewStyle,
};

// ─────────────────────────────────────────────────────────────
// Motion
// ─────────────────────────────────────────────────────────────

export const motion = {
  duration: {
    fast: 120,
    standard: 180,
    slow: 260,
  },
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    emphasized: 'cubic-bezier(0.3, 0, 0, 1.2)',
  },
} as const;

// ─────────────────────────────────────────────────────────────
// Focus ring — use on every interactive element
// ─────────────────────────────────────────────────────────────

export const ring = {
  color: colors.brandPrimary,
  width: 2,
  offset: 2,
  // Web-only boxShadow recipe for :focus-visible
  boxShadow: `0 0 0 2px ${colors.canvas}, 0 0 0 4px ${colors.brandPrimary}`,
} as const;

// ─────────────────────────────────────────────────────────────
// Touch target minimum (WCAG 2.5.5 AAA, Apple HIG)
// ─────────────────────────────────────────────────────────────

export const touchTarget = 44;

// ─────────────────────────────────────────────────────────────
// Aggregate — matches the shape used in the prototype pages
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// tint() — blend a token color with an alpha value, returning an
// rgba() string. Use this instead of string-concatenating a hex
// alpha suffix (e.g. `colors.success + '20'`) — the concat trick
// doesn't type-check, skips our lint, and breaks dark-mode swaps.
// ─────────────────────────────────────────────────────────────

/**
 * Return a semi-transparent version of a hex color.
 * @param hex  A #RRGGBB string. Short (#RGB) and #RRGGBBAA are accepted.
 * @param alpha 0-1 opacity. Values outside [0,1] are clamped.
 */
export function tint(hex: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  // Expand #RGB → #RRGGBB
  let h = hex.replace(/^#/, '');
  if (h.length === 3) {
    h = h.split('').map((c) => c + c).join('');
  }
  // Strip optional alpha
  if (h.length === 8) h = h.slice(0, 6);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export const tokens = {
  color: colors,
  colorDark: colorsDark,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  space,
  radius,
  shadow,
  motion,
  ring,
  touchTarget,
} as const;

export type Tokens = typeof tokens;
export type ColorToken = keyof typeof colors;
export default tokens;
