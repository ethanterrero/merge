// Pure crash-reporting rules: when Sentry starts, the options it starts with, and
// the scrubber every event and breadcrumb passes through before it leaves the
// phone. No React Native or Sentry imports here, so `npm test` can run this file
// under Node; ErrorBoundary.tsx hands these to Sentry.

export const SCRUBBED = '[scrubbed]';

// Order matters: whole tokens go before the patterns that would match pieces of them.
const STRING_RULES: [RegExp, string][] = [
  // JWTs, such as Supabase access tokens
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, SCRUBBED],
  [/\b(Bearer\s+)[^\s"',]+/gi, `$1${SCRUBBED}`],
  [/([?&#](?:api_?key|access_token|refresh_token|id_token|token|code|password)=)[^&#\s]+/gi, `$1${SCRUBBED}`],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, SCRUBBED],
  [/[\w.%+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/gi, SCRUBBED],
  // Long opaque strings: refresh tokens, API keys
  [/[\w-]{32,}/g, SCRUBBED],
  // Decimal degrees: 3+ fractional digits is ~100 m or finer
  [/(^|[^\w.])-?\d{1,3}\.\d{3,}(?![\w.])/g, `$1${SCRUBBED}`],
  // Sign-in codes
  [/(^|\D)\d{6}(?!\d)/g, `$1${SCRUBBED}`],
];

export function scrubString(value: string): string {
  return STRING_RULES.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), value);
}

// Values under these keys are dropped whatever they hold. Keys are compared
// lowercased with `_` and `-` removed.
const SENSITIVE_KEYS = new Set([
  'code', 'otp', 'lat', 'lng', 'lon', 'latitude', 'longitude', 'location', 'coords', 'coordinates',
  'phone', 'address', 'ip', 'ipaddress',
]);
const SENSITIVE_KEY_PARTS = ['email', 'token', 'password', 'secret', 'authorization', 'cookie', 'apikey'];

// Values under these keys are kept as they are: Sentry needs them to group events
// and map stack traces back to source, and none of them holds user data.
const STRUCTURAL_KEYS = new Set([
  'event_id', 'release', 'dist', 'environment', 'platform', 'level', 'type', 'timestamp', 'start_timestamp',
  'sdk', 'debug_meta', 'debug_id', 'filename', 'abs_path', 'module', 'function', 'lineno', 'colno', 'in_app',
  'instruction_addr', 'image_addr', 'symbol_addr', 'package', 'trace_id', 'span_id', 'parent_span_id',
]);

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[_-]/g, '');
  return SENSITIVE_KEYS.has(k) || SENSITIVE_KEY_PARTS.some((part) => k.includes(part));
}

// Coordinates (3+ fractional digits) and anything shaped like a sign-in code.
function isSensitiveNumber(n: number): boolean {
  if (Number.isInteger(n)) return n >= 100000 && n <= 999999;
  return /\.\d{3,}/.test(String(n));
}

function scrubValue(value: unknown): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'number') return isSensitiveNumber(value) ? SCRUBBED : value;
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (STRUCTURAL_KEYS.has(key)) out[key] = inner;
      else if (isSensitiveKey(key)) out[key] = SCRUBBED;
      else out[key] = scrubValue(inner);
    }
    return out;
  }
  return value;
}

/**
 * Sentry `beforeSend`: returns a scrubbed copy. Drops the user (D-17: no user ID
 * or IP) and the device's name, which is often the owner's name.
 */
export function scrubEvent<T extends object>(event: T): T {
  const { user: _user, server_name: _serverName, ...rest } = event as Record<string, unknown>;
  const out = scrubValue(rest) as Record<string, unknown>;
  const contexts = out.contexts as Record<string, Record<string, unknown> | undefined> | undefined;
  if (contexts?.device) {
    const { name: _name, ...device } = contexts.device;
    contexts.device = device;
  }
  return out as T;
}

/** Sentry `beforeBreadcrumb`: returns a scrubbed copy. */
export function scrubBreadcrumb<T extends object>(breadcrumb: T): T {
  return scrubValue(breadcrumb) as T;
}

export type MonitoringOptions = {
  dsn: string;
  environment: string;
  sendDefaultPii: false;
  replaysSessionSampleRate: 0;
  replaysOnErrorSampleRate: 0;
  enableAutoSessionTracking: false;
  attachScreenshot: false;
  attachViewHierarchy: false;
  beforeSend: typeof scrubEvent;
  beforeBreadcrumb: typeof scrubBreadcrumb;
};

/**
 * Sentry starts only in preview and production builds that have a DSN, so local
 * development and the prototype never send anything. Crash reports only: no
 * session replay, tracing, release-health sessions, screenshots or view
 * hierarchy (D-17; analytics are out of scope).
 */
export function monitoringOptions(env: { appEnv?: string; dsn?: string }): MonitoringOptions | null {
  const dsn = env.dsn?.trim();
  if (!dsn) return null;
  if (env.appEnv !== 'preview' && env.appEnv !== 'production') return null;
  return {
    dsn,
    environment: env.appEnv,
    sendDefaultPii: false,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    enableAutoSessionTracking: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
