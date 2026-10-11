// Row -> UI mapping for profiles. Pure.

import type { RidePref, Role } from '../../state/commute';
import type { ProfileSummary } from './profile.api';
import type { Row } from './types';

/** Explicit columns: a privacy review sees exactly what's read. */
export const PROFILE_COLUMNS = 'id, display_name, role, ride_prefs, discovery_opt_in';

export type ProfileRow = Pick<Row<'profiles'>, 'id' | 'display_name' | 'role' | 'ride_prefs' | 'discovery_opt_in'>;

const ROLES: readonly Role[] = ['driver', 'passenger', 'both'];

// profiles_ride_prefs_known (0008) allows 'quiet' and 'smoke_free'.
const RIDE_PREF_LABELS = new Map<string, RidePref>([
  ['quiet', 'Quiet ride'],
  ['smoke_free', 'Smoke-free'],
]);

/** Unknown values fall back to the column default, 'both'. */
export function toRole(raw: string): Role {
  return ROLES.find((role) => role === raw) ?? 'both';
}

/** Codes the app doesn't know are dropped. */
export function toRidePrefs(raw: readonly string[]): RidePref[] {
  return raw.flatMap((code) => {
    const label = RIDE_PREF_LABELS.get(code);
    return label ? [label] : [];
  });
}

export function toProfileSummary(row: ProfileRow): ProfileSummary {
  return {
    id: row.id,
    displayName: row.display_name,
    role: toRole(row.role),
    ridePrefs: toRidePrefs(row.ride_prefs),
    discoveryOptIn: row.discovery_opt_in,
  };
}
