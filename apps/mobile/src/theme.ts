// Merge design tokens — "Forest" palette (owner-approved).
// Keep every color, radius and spacing value here so screens never hard-code hexes.

const brand = {
  primary: '#2E6B3E', // primary actions, selected states, map pins
  deep: '#14301C', // headers, dark segmented controls, logo glyph
  accent: '#24532F', // links, icons and destructive outlines on light surfaces
  accentLight: '#A9D4B4', // logo tile, celebratory accents
  tint: '#E3F0E6', // selected backgrounds, info callouts, badges
  deepPressed: '#0B1F12', // pressed state for `deep` surfaces
  tintPressed: '#CFE5D6', // pressed state for `tint` surfaces
} as const;

export const colors = {
  // Brand
  ...brand,

  // Deprecated aliases from the "Chili spice" palette, kept so existing screens
  // keep working. deprecated: use primary/deep/accent/accentLight/tint instead.
  chili: brand.primary, // deprecated: use primary
  maroon: brand.deep, // deprecated: use deep
  ember: brand.accent, // deprecated: use accent
  peach: brand.accentLight, // deprecated: use accentLight
  blush: brand.tint, // deprecated: use tint

  // Neutrals (cool green-grey)
  background: '#F5F7F5',
  surface: '#FFFFFF',
  border: '#E3E8E4',
  borderStrong: '#CBD2CD',
  textPrimary: '#1C221E',
  textSecondary: '#3B433E',
  textMuted: '#59625C',
  textFaint: '#8A938D',
  onDark: '#FFFFFF',
  onDarkMuted: '#E3F0E6',

  // Status (teal, so success never blends with the green brand)
  success: '#14918A',
  successText: '#0F766E',
  successBg: '#CCEDE8',
  // Errors and failures: a deep red, so they never read as the green brand
  danger: '#B42318',
  dangerBg: '#FDECEA',

  // Map
  water: '#D5DEE2',
  land: '#E3E8E4',
  road: '#8A938D',
  chiliZone: 'rgba(46,107,62,0.18)',
  maroonZone: 'rgba(20,48,28,0.10)',
  mapLabel: 'rgba(255,255,255,0.85)', // attribution and tag backgrounds over map tiles

  // Welcome map
  mapBg: '#E9EBEF',
  street: '#FFFFFF',
  avenue: '#C5CDE6',
  avenueInner: '#D7DDEE',
  park: '#D3E9CC',
  mapWater: '#CFE0EE',

  // Welcome cars (drawn top-down)
  carLeadBody: '#2E6B3E',
  carLeadSide: '#1C4527',
  carLeadHighlight: '#5E9A6C',
  carSandBody: '#E6DCB6',
  carSandSide: '#BBAE80',
  carSandHighlight: '#F3EDD3',
  carCabin: '#18281E',
  carShine: 'rgba(255,255,255,0.28)',
  carShadow: 'rgba(15,30,20,0.35)',
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
    shadowColor: colors.deep,
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  md: {
    shadowColor: colors.deep,
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
} as const;

/** Minimum touch target, per platform accessibility guidance. */
export const TOUCH = 44;
