// Which map to draw, and how to reach Stadia Maps (D-08). Pure: no
// react-native or expo imports, so `npm test` runs it under Node.

/**
 * The public Expo variable holding the Stadia Maps display key (O-08). It is
 * baked into the app bundle, so it must be a client key restricted to the app,
 * never a server key. Set it in apps/mobile/.env and in EAS env (O-07).
 */
export const MAP_KEY_ENV = 'EXPO_PUBLIC_STADIA_KEY';

/** Stadia's light, low-contrast style, so the area circles stand out. */
export const STADIA_STYLE = 'alidade_smooth';

const KEY_SHAPE = /^[A-Za-z0-9_-]{8,128}$/;

/** The key, or null when it's missing, blank or obviously a placeholder. */
export function readMapKey(raw: string | undefined): string | null {
  const key = raw?.trim() ?? '';
  return KEY_SHAPE.test(key) ? key : null;
}

export type RendererChoice =
  | { kind: 'native' }
  | { kind: 'web' }
  | { kind: 'fallback'; reason: 'no-key' | 'no-native-module' | 'unsupported-platform' };

/**
 * Real tiles need a key, plus MapLibre's native module on iOS and Android.
 * Expo Go (and a dev build made before MapLibre was added) lacks that module,
 * so it gets the stylized fallback instead of crashing.
 */
export function chooseRenderer(input: { key: string | null; platform: string; nativeMapAvailable: boolean }): RendererChoice {
  if (!input.key) return { kind: 'fallback', reason: 'no-key' };
  if (input.platform === 'web') return { kind: 'web' };
  if (input.platform === 'ios' || input.platform === 'android') {
    return input.nativeMapAvailable ? { kind: 'native' } : { kind: 'fallback', reason: 'no-native-module' };
  }
  return { kind: 'fallback', reason: 'unsupported-platform' };
}

export function stadiaStyleUrl(key: string): string {
  return `https://tiles.stadiamaps.com/styles/${STADIA_STYLE}.json?api_key=${encodeURIComponent(key)}`;
}

function isStadiaHost(host: string): boolean {
  return host === 'stadiamaps.com' || host.endsWith('.stadiamaps.com');
}

/** Adds the key to HTTPS requests for Stadia Maps, and to nothing else. */
export function withStadiaKey(url: string, key: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol !== 'https:' || !isStadiaHost(parsed.hostname)) return url;
  if (parsed.searchParams.has('api_key')) return url;
  return `${url}${parsed.search ? '&' : '?'}api_key=${encodeURIComponent(key)}`;
}
