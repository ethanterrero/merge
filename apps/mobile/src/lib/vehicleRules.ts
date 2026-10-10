// Vehicle form rules (M-21). Pure: no react-native, expo or Supabase imports, so
// node:test can run them. The limits mirror public.vehicles after 0008
// (supabase/migrations/0001_initial.sql, 0008_commute_privacy.sql), so a draft
// that passes here also passes the database checks once M-34 saves it.

/** vehicles.passenger_seats check: between 1 and 8. */
export const PASSENGER_SEATS_MIN = 1;
export const PASSENGER_SEATS_MAX = 8;

/** The "Seats to offer" stepper's maximum before a vehicle is added (the prototype's existing bound). */
export const SEATS_OFFERED_MAX_WITHOUT_VEHICLE = 6;

/** App-side cap for make and model; the columns have no length check. */
export const NAME_MAX = 40;
/** vehicles_color_length: 1–30 characters after trimming. */
export const COLOR_MAX = 30;
/** Oldest model year the form accepts; the newest is next year. */
export const MODEL_YEAR_MIN = 1900;

/** A saved vehicle on the local commute draft. Field-for-field with public.vehicles. */
export type Vehicle = {
  make: string;
  model: string;
  /** vehicles.model_year (nullable). */
  modelYear: number | null;
  /** Trimmed; null when blank (vehicles_normalize). */
  color: string | null;
  /** Uppercase letters and digits, 2–8 long; null when blank. Owner-only until a ride is confirmed. */
  plate: string | null;
  passengerSeats: number;
  /** vehicles.accepts_foldable_scooters: the trunk fits one folded scooter (D-04). */
  acceptsFoldableScooters: boolean;
};

/** What the form holds while the person types. */
export type VehicleForm = {
  make: string;
  model: string;
  year: string;
  color: string;
  plate: string;
  passengerSeats: number;
  acceptsFoldableScooters: boolean;
};

export type VehicleField = 'make' | 'model' | 'year' | 'color' | 'plate' | 'passengerSeats';
export type VehicleErrors = Partial<Record<VehicleField, string>>;

export type VehicleResult = { ok: true; vehicle: Vehicle } | { ok: false; errors: VehicleErrors };

const PLATE_FORMAT = /^[A-Z0-9]{2,8}$/;
const PLATE_CHARS = /^[A-Z0-9]*$/;

/** Character count the way Postgres char_length counts (code points). */
function length(text: string): number {
  return [...text].length;
}

/** Uppercase, without spaces or dashes: the same rewrite as the vehicles_normalize trigger. */
export function normalizePlate(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

export function emptyVehicleForm(): VehicleForm {
  return {
    make: '',
    model: '',
    year: '',
    color: '',
    plate: '',
    passengerSeats: 4,
    // Column default is false: a driver opts in to carrying a scooter.
    acceptsFoldableScooters: false,
  };
}

export function vehicleToForm(vehicle: Vehicle | undefined): VehicleForm {
  if (!vehicle) return emptyVehicleForm();
  return {
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.modelYear === null ? '' : String(vehicle.modelYear),
    color: vehicle.color ?? '',
    plate: vehicle.plate ?? '',
    passengerSeats: vehicle.passengerSeats,
    acceptsFoldableScooters: vehicle.acceptsFoldableScooters,
  };
}

/**
 * Checks every field and returns either the normalized vehicle or one message
 * per invalid field. `currentYear` is injected so tests don't depend on the clock.
 */
export function validateVehicle(form: VehicleForm, { currentYear }: { currentYear: number }): VehicleResult {
  const errors: VehicleErrors = {};

  const make = form.make.trim();
  if (!make) errors.make = 'Enter the make, like Toyota.';
  else if (length(make) > NAME_MAX) errors.make = `Use ${NAME_MAX} characters or fewer.`;

  const model = form.model.trim();
  if (!model) errors.model = 'Enter the model, like Prius.';
  else if (length(model) > NAME_MAX) errors.model = `Use ${NAME_MAX} characters or fewer.`;

  const yearText = form.year.trim();
  let modelYear: number | null = null;
  if (yearText) {
    const maxYear = currentYear + 1;
    const year = /^\d{4}$/.test(yearText) ? Number(yearText) : NaN;
    if (Number.isInteger(year) && year >= MODEL_YEAR_MIN && year <= maxYear) modelYear = year;
    else errors.year = `Enter a year from ${MODEL_YEAR_MIN} to ${maxYear}.`;
  }

  const colorText = form.color.trim();
  if (length(colorText) > COLOR_MAX) errors.color = `Use ${COLOR_MAX} characters or fewer.`;

  const plateText = normalizePlate(form.plate);
  if (plateText) {
    if (!PLATE_CHARS.test(plateText)) errors.plate = 'Use letters and numbers only.';
    else if (!PLATE_FORMAT.test(plateText)) errors.plate = 'Use 2 to 8 letters and numbers.';
  }

  const seats = form.passengerSeats;
  if (!Number.isInteger(seats) || seats < PASSENGER_SEATS_MIN || seats > PASSENGER_SEATS_MAX) {
    errors.passengerSeats = `Choose ${PASSENGER_SEATS_MIN} to ${PASSENGER_SEATS_MAX} passenger seats.`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    vehicle: {
      make,
      model,
      modelYear,
      color: colorText || null,
      plate: plateText || null,
      passengerSeats: seats,
      acceptsFoldableScooters: form.acceptsFoldableScooters,
    },
  };
}

/** The "Seats to offer" maximum: the vehicle's seats (commutes_check_seats), or today's bound without one. */
export function maxSeatsOffered(vehicle: Pick<Vehicle, 'passengerSeats'> | undefined): number {
  return vehicle ? vehicle.passengerSeats : SEATS_OFFERED_MAX_WITHOUT_VEHICLE;
}

/** Keeps an offer within 1 and the maximum, like vehicles_clamp_seats does when a car loses seats. */
export function clampSeatsOffered(seatsOffered: number, vehicle: Pick<Vehicle, 'passengerSeats'> | undefined): number {
  return Math.max(1, Math.min(seatsOffered, maxSeatsOffered(vehicle)));
}

/** One line for the Preferences row, e.g. "Silver 2019 Toyota Prius · 4 seats". Never includes the plate. */
export function vehicleSummary(vehicle: Vehicle): string {
  const name = [vehicle.color, vehicle.modelYear, vehicle.make, vehicle.model].filter((part) => part !== null && part !== '').join(' ');
  const seats = `${vehicle.passengerSeats} ${vehicle.passengerSeats === 1 ? 'seat' : 'seats'}`;
  return `${name} · ${seats}`;
}
