import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PASSENGER_SEATS_MAX,
  PASSENGER_SEATS_MIN,
  SEATS_OFFERED_MAX_WITHOUT_VEHICLE,
  Vehicle,
  VehicleForm,
  clampSeatsOffered,
  emptyVehicleForm,
  maxSeatsOffered,
  normalizePlate,
  validateVehicle,
  vehicleSummary,
  vehicleToForm,
} from './vehicleRules';

const NOW = { currentYear: 2026 };

const filled: VehicleForm = {
  make: 'Toyota',
  model: 'Prius',
  year: '2019',
  color: 'Silver',
  plate: '8abc123',
  passengerSeats: 4,
  acceptsFoldableScooters: true,
};

function errorsOf(form: Partial<VehicleForm>) {
  const result = validateVehicle({ ...filled, ...form }, NOW);
  assert.equal(result.ok, false, 'expected the form to be invalid');
  return result.ok ? {} : result.errors;
}

test('seat bounds match the vehicles.passenger_seats check (1–8)', () => {
  assert.equal(PASSENGER_SEATS_MIN, 1);
  assert.equal(PASSENGER_SEATS_MAX, 8);
});

test('normalizePlate uppercases and drops spaces and dashes, like the vehicles_normalize trigger', () => {
  assert.equal(normalizePlate('8abc123'), '8ABC123');
  assert.equal(normalizePlate(' 8-abc 123 '), '8ABC123');
  assert.equal(normalizePlate('7\tXY-Z'), '7XYZ');
  assert.equal(normalizePlate('   '), '');
  // Other characters are kept, so validation can reject them rather than silently change the plate.
  assert.equal(normalizePlate('ab.c'), 'AB.C');
});

test('a complete form validates into a normalized vehicle', () => {
  const result = validateVehicle({ ...filled, make: '  Toyota ', model: ' Prius  ', color: ' Silver ', plate: '8 abc-123' }, NOW);
  assert.deepEqual(result, {
    ok: true,
    vehicle: {
      make: 'Toyota',
      model: 'Prius',
      modelYear: 2019,
      color: 'Silver',
      plate: '8ABC123',
      passengerSeats: 4,
      acceptsFoldableScooters: true,
    },
  });
});

test('year, color and plate are optional (nullable columns) and blank becomes null', () => {
  const result = validateVehicle({ ...filled, year: ' ', color: '   ', plate: ' - ', acceptsFoldableScooters: false }, NOW);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.vehicle.modelYear, null);
  assert.equal(result.vehicle.color, null);
  assert.equal(result.vehicle.plate, null);
  assert.equal(result.vehicle.acceptsFoldableScooters, false);
});

test('make and model are required and capped at 40 characters', () => {
  assert.equal(errorsOf({ make: '   ' }).make, 'Enter the make, like Toyota.');
  assert.equal(errorsOf({ model: '' }).model, 'Enter the model, like Prius.');
  assert.equal(errorsOf({ make: 'x'.repeat(41) }).make, 'Use 40 characters or fewer.');
  assert.equal(validateVehicle({ ...filled, make: 'x'.repeat(40), model: 'y'.repeat(40) }, NOW).ok, true);
});

test('year must be a four-digit year from 1900 to next year', () => {
  const message = 'Enter a year from 1900 to 2027.';
  assert.equal(errorsOf({ year: '19' }).year, message);
  assert.equal(errorsOf({ year: '2019.5' }).year, message);
  assert.equal(errorsOf({ year: 'abcd' }).year, message);
  assert.equal(errorsOf({ year: '1899' }).year, message);
  assert.equal(errorsOf({ year: '2028' }).year, message);
  const nextYear = validateVehicle({ ...filled, year: ' 2027 ' }, NOW);
  assert.equal(nextYear.ok && nextYear.vehicle.modelYear, 2027);
  const oldest = validateVehicle({ ...filled, year: '1900' }, NOW);
  assert.equal(oldest.ok && oldest.vehicle.modelYear, 1900);
});

test('color is capped at 30 characters after trimming (vehicles_color_length)', () => {
  assert.equal(errorsOf({ color: 'c'.repeat(31) }).color, 'Use 30 characters or fewer.');
  const ok = validateVehicle({ ...filled, color: `  ${'c'.repeat(30)}  ` }, NOW);
  assert.equal(ok.ok, true);
});

test('plate must be 2–8 letters and digits after normalizing (vehicles_plate_format)', () => {
  assert.equal(errorsOf({ plate: 'A' }).plate, 'Use 2 to 8 letters and numbers.');
  assert.equal(errorsOf({ plate: '123456789' }).plate, 'Use 2 to 8 letters and numbers.');
  assert.equal(errorsOf({ plate: 'AB.123' }).plate, 'Use letters and numbers only.');
  assert.equal(errorsOf({ plate: 'ÉCOLE1' }).plate, 'Use letters and numbers only.');
  const shortest = validateVehicle({ ...filled, plate: 'a1' }, NOW);
  assert.equal(shortest.ok && shortest.vehicle.plate, 'A1');
  const longest = validateVehicle({ ...filled, plate: '1234-5678' }, NOW);
  assert.equal(longest.ok && longest.vehicle.plate, '12345678');
});

test('passenger seats must be a whole number from 1 to 8', () => {
  const message = 'Choose 1 to 8 passenger seats.';
  assert.equal(errorsOf({ passengerSeats: 0 }).passengerSeats, message);
  assert.equal(errorsOf({ passengerSeats: 9 }).passengerSeats, message);
  assert.equal(errorsOf({ passengerSeats: 2.5 }).passengerSeats, message);
  assert.equal(validateVehicle({ ...filled, passengerSeats: 1 }, NOW).ok, true);
  assert.equal(validateVehicle({ ...filled, passengerSeats: 8 }, NOW).ok, true);
});

test('every invalid field is reported at once', () => {
  const errors = errorsOf({ make: '', model: '', year: '20', color: 'c'.repeat(31), plate: '!', passengerSeats: 0 });
  assert.deepEqual(Object.keys(errors).sort(), ['color', 'make', 'model', 'passengerSeats', 'plate', 'year']);
});

test('the empty form starts blank, at 4 seats, with the column default for scooters', () => {
  assert.deepEqual(emptyVehicleForm(), {
    make: '',
    model: '',
    year: '',
    color: '',
    plate: '',
    passengerSeats: 4,
    acceptsFoldableScooters: false,
  });
});

test('vehicleToForm round-trips a saved vehicle', () => {
  const vehicle: Vehicle = {
    make: 'Honda',
    model: 'Fit',
    modelYear: null,
    color: null,
    plate: '7XYZ',
    passengerSeats: 3,
    acceptsFoldableScooters: true,
  };
  const form = vehicleToForm(vehicle);
  assert.deepEqual(form, { make: 'Honda', model: 'Fit', year: '', color: '', plate: '7XYZ', passengerSeats: 3, acceptsFoldableScooters: true });
  assert.deepEqual(validateVehicle(form, NOW), { ok: true, vehicle });
  assert.deepEqual(vehicleToForm(undefined), emptyVehicleForm());
});

test('the seats-offered maximum follows the vehicle, with today’s 6 before one is added', () => {
  assert.equal(SEATS_OFFERED_MAX_WITHOUT_VEHICLE, 6);
  assert.equal(maxSeatsOffered(undefined), 6);
  assert.equal(maxSeatsOffered({ passengerSeats: 3 }), 3);
  assert.equal(maxSeatsOffered({ passengerSeats: 8 }), 8);
});

test('clampSeatsOffered lowers the offer to the vehicle’s seats and never below 1', () => {
  assert.equal(clampSeatsOffered(4, { passengerSeats: 2 }), 2);
  assert.equal(clampSeatsOffered(2, { passengerSeats: 7 }), 2);
  assert.equal(clampSeatsOffered(7, undefined), 6);
  assert.equal(clampSeatsOffered(0, { passengerSeats: 3 }), 1);
});

test('vehicleSummary describes the car without the plate', () => {
  assert.equal(
    vehicleSummary({ make: 'Toyota', model: 'Prius', modelYear: 2019, color: 'Silver', plate: '8ABC123', passengerSeats: 4, acceptsFoldableScooters: true }),
    'Silver 2019 Toyota Prius · 4 seats',
  );
  assert.equal(
    vehicleSummary({ make: 'Honda', model: 'Fit', modelYear: null, color: null, plate: null, passengerSeats: 1, acceptsFoldableScooters: false }),
    'Honda Fit · 1 seat',
  );
});
