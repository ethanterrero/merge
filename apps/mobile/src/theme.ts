// Merge design tokens — "Chili spice" palette.
// Keep every color, radius and spacing value here so screens never hard-code hexes.

export const colors = {
  // Brand
  chili: '#CD1C18', // primary actions, selected states, map pins
  peach: '#FFA896', // logo tile, celebratory accents
  ember: '#9B1313', // links, icons and destructive outlines on light surfaces
  maroon: '#38000A', // headers, dark segmented controls

  // Tints
  blush: '#FFE8E2', // selected backgrounds, info callouts, badges

  // Neutrals (warm)
  background: '#F8F4F3',
  surface: '#FFFFFF',
  border: '#EEE5E3',
  borderStrong: '#D6C9C6',
  textPrimary: '#241417',
  textSecondary: '#4A3A3C',
  textMuted: '#6B5A5C',
  textFaint: '#968A8B',
  onDark: '#FFFFFF',
  onDarkMuted: '#FFE8E2',

  // Status
  success: '#1F9D55',
  successText: '#1A7F45',
  successBg: '#CDEFD9',

  // Map
  water: '#D5DEE2',
  land: '#EEE5E3',
  road: '#968A8B',
  chiliZone: 'rgba(205,28,24,0.18)',
  maroonZone: 'rgba(56,0,10,0.10)',
} as const;

export const radius = { sm: 4, md: 8, lg: 12, xl: 16, xxl: 24, pill: 999 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

export const type = {
  display: { fontSize: 30, lineHeight: 34, fontWeight: '700' as const, letterSpacing: -0.6 },
  title: { fontSize: 26, lineHeight: 30, fontWeight: '700' as const, letterSpacing: -0.5 },
  heading: { fontSize: 19, lineHeight: 24, fontWeight: '700' as const },
  subheading: { fontSize: 15, lineHeight: 20, fontWeight: '700' as const },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' as const },
  small: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' as const },
  eyebrow: { fontSize: 12, lineHeight: 16, fontWeight: '700' as const, letterSpacing: 0.5, textTransform: 'uppercase' as const },
  stat: { fontSize: 20, lineHeight: 24, fontWeight: '700' as const },
} as const;

export const shadow = {
  sm: {
    shadowColor: '#38000A',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  md: {
    shadowColor: '#38000A',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
} as const;

/** Minimum touch target, per platform accessibility guidance. */
export const TOUCH = 44;
