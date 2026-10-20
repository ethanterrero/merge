// Sample data for the Trips tab prototype (M-23) only. Names are fictional, areas
// are generalized labels, and nothing here is real user data. Nothing before
// confirmation carries a pickup spot. The arrays are read-only seeds: the data-layer
// mock backends of M-35 and M-47 may seed from them, and the session store below
// copies them.

import { createTripsSession, type DrivingDay, type ReceivedInvite, type SentItem, type TripRide } from '../lib/trips';

/** The prototype's fixed clock: Sat, Oct 10, 2026, 2:00 PM LA (owner question 9). */
export const MOCK_TRIPS_TODAY = '2026-10-10';
export const MOCK_TRIPS_NOW_MINUTES = 14 * 60;

/** When a driving day created from an accepted request leaves. */
export const MOCK_LEAVE_TIME = '7:35 AM';

const person = (id: string, name: string, initials: string, verified = true) => ({ id, name, initials, verified });

/** My driving days before any request is accepted. Riders are confirmed. */
export const DRIVING_DAYS: readonly DrivingDay[] = [
  {
    date: '2026-10-12',
    leaveTime: MOCK_LEAVE_TIME,
    riders: [{ id: 'ride-sam', person: person('sam', 'Sam R.', 'SR'), pickupTime: '7:38 AM', spot: '[Pickup spot]', seats: 1, cargo: false, justBooked: false }],
  },
  {
    date: '2026-10-13',
    leaveTime: MOCK_LEAVE_TIME,
    riders: [{ id: 'ride-morgan', person: person('morgan', 'Morgan D.', 'MD'), pickupTime: '7:40 AM', spot: '[Pickup spot]', seats: 1, cargo: false, justBooked: false }],
  },
];

/** Invites I sent as a driver (driving side). */
export const SENT_INVITES: readonly SentItem[] = [
  {
    id: 'inv-riley',
    type: 'invite',
    sender: 'me',
    person: person('riley', 'Riley P.', 'RP'),
    rideDate: '2026-10-13',
    kind: 'first_ride',
    pickupArea: 'Lincoln Park area, Alameda',
    pickupTime: '7:45 AM',
    status: 'pending',
  },
];

/** Requests I sent as a passenger (riding side). */
export const SENT_REQUESTS: readonly SentItem[] = [
  {
    id: 'sreq-marcus',
    type: 'request',
    sender: 'me',
    person: person('marcus', 'Marcus L.', 'ML'),
    rideDate: '2026-10-14',
    kind: 'first_ride',
    pickupArea: 'Park St area, Alameda',
    pickupTime: '7:55 AM',
    status: 'pending',
  },
  {
    // For example Dana's seats filled for that date (D-02). The UI type can't say why.
    id: 'sreq-dana',
    type: 'request',
    sender: 'me',
    person: person('dana', 'Dana W.', 'DW', false),
    rideDate: '2026-10-15',
    kind: 'first_ride',
    pickupArea: 'Park St area, Alameda',
    pickupTime: '7:45 AM',
    status: 'unavailable',
  },
];

/** Drivers' invites to me (riding side). */
export const RECEIVED_INVITES: readonly ReceivedInvite[] = [
  {
    id: 'rinv-lena',
    person: person('lena', 'Lena M.', 'LM'),
    rideDate: '2026-10-15',
    kind: 'first_ride',
    pickupArea: 'Park St area, Alameda',
    pickupTime: '7:40 AM',
  },
];

/** Rides as a passenger besides this session's bookings. */
export const RIDING_RIDES: readonly TripRide[] = [
  {
    id: 'ride-kai',
    person: person('kai', 'Kai O.', 'KO'),
    rideDate: '2026-10-16',
    kind: 'first_ride',
    pickupTime: '7:50 AM',
    myRole: 'passenger',
    status: 'cancelled',
    matchId: null,
  },
];

export const PAST_RIDES: readonly TripRide[] = [
  {
    id: 'ride-taylor',
    person: person('taylor', 'Taylor B.', 'TB'),
    rideDate: '2026-10-08',
    kind: 'first_ride',
    pickupTime: '7:40 AM',
    myRole: 'driver',
    status: 'completed',
    matchId: null,
  },
  {
    id: 'ride-avery',
    person: person('avery', 'Avery J.', 'AJ'),
    rideDate: '2026-10-07',
    kind: 'first_ride',
    pickupTime: '7:45 AM',
    myRole: 'passenger',
    status: 'completed',
    matchId: null,
  },
  {
    id: 'ride-noor',
    person: person('noor', 'Noor A.', 'NA'),
    rideDate: '2026-10-06',
    kind: 'first_ride',
    pickupTime: '7:50 AM',
    myRole: 'passenger',
    status: 'cancelled',
    matchId: null,
  },
];

/** The one prototype session store. Resets on reload, like all prototype state. */
export const mockTripsSession = createTripsSession({
  sent: [...SENT_INVITES, ...SENT_REQUESTS],
  invites: RECEIVED_INVITES,
});
