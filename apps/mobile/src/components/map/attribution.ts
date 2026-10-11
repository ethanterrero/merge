// The credit every real map shows (D-08). Kept in step with the Map section of
// site/attributions.html (M-40); a test checks the two match.

export type Credit = { label: string; url: string };

export const MAP_ATTRIBUTION: readonly Credit[] = [
  { label: '© Stadia Maps', url: 'https://stadiamaps.com/' },
  { label: '© OpenMapTiles', url: 'https://openmaptiles.org/' },
  { label: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
];

export function attributionText(): string {
  return MAP_ATTRIBUTION.map((c) => c.label).join(' ');
}
