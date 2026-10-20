import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCRUBBED, monitoringOptions, scrubBreadcrumb, scrubEvent, scrubString } from './monitoring';

// --- scrubString ---

test('scrubString removes email addresses', () => {
  assert.equal(scrubString('No account for Priya.S+test@example.co.uk, retry'), `No account for ${SCRUBBED}, retry`);
});

test('scrubString removes 6-digit sign-in codes', () => {
  assert.equal(scrubString('verifyOtp failed for 482913'), `verifyOtp failed for ${SCRUBBED}`);
});

test('scrubString keeps numbers that are not 6 digits', () => {
  assert.equal(scrubString('HTTP 500 after 12345 ms, 1234567 bytes'), 'HTTP 500 after 12345 ms, 1234567 bytes');
});

test('scrubString removes decimal coordinates', () => {
  assert.equal(scrubString('POINT(-122.2711 37.7652)'), `POINT(${SCRUBBED} ${SCRUBBED})`);
  assert.equal(scrubString('pickup at 37.765,-122.271'), `pickup at ${SCRUBBED},${SCRUBBED}`);
});

test('scrubString keeps version numbers', () => {
  assert.equal(scrubString('Merge 0.1.0 on RN 0.81.4'), 'Merge 0.1.0 on RN 0.81.4');
});

test('scrubString removes JWTs', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  assert.equal(scrubString(`session ${jwt} expired`), `session ${SCRUBBED} expired`);
});

test('scrubString removes bearer tokens', () => {
  assert.equal(scrubString('Authorization: Bearer abc.def-123'), `Authorization: Bearer ${SCRUBBED}`);
});

test('scrubString removes secret query parameters', () => {
  assert.equal(
    scrubString('https://tiles.example.com/style.json?api_key=k3y&lang=en&access_token=t0k&code=99'),
    `https://tiles.example.com/style.json?api_key=${SCRUBBED}&lang=en&access_token=${SCRUBBED}&code=${SCRUBBED}`,
  );
});

test('scrubString removes long opaque tokens', () => {
  assert.equal(scrubString('refresh v1.MRjSsAa9b7sQkZ2xN4pLmY8tR3wE6uI0oP'), `refresh v1.${SCRUBBED}`);
});

test('scrubString removes UUIDs', () => {
  assert.equal(scrubString('ride 3f2b8c1e-9d4a-4b7e-8f21-0c6d5e4a3b2f not found'), `ride ${SCRUBBED} not found`);
});

test('scrubString keeps ordinary error text', () => {
  const message = "TypeError: Cannot read property 'name' of undefined";
  assert.equal(scrubString(message), message);
});

// --- scrubEvent ---

test('scrubEvent scrubs exception values and the message', () => {
  const event = {
    message: 'Sign-in failed for a@b.co',
    exception: { values: [{ type: 'Error', value: 'code 123456 rejected' }] },
  };
  assert.deepEqual(scrubEvent(event), {
    message: `Sign-in failed for ${SCRUBBED}`,
    exception: { values: [{ type: 'Error', value: `code ${SCRUBBED} rejected` }] },
  });
});

test('scrubEvent drops the user, server name and device name', () => {
  const event = {
    user: { id: 'u1', ip_address: '1.2.3.4', email: 'a@b.co' },
    server_name: "Priya's iPhone",
    contexts: { device: { name: "Priya's iPhone", model: 'iPhone15,2' }, os: { name: 'iOS', version: '18.1' } },
  };
  assert.deepEqual(scrubEvent(event), {
    contexts: { device: { model: 'iPhone15,2' }, os: { name: 'iOS', version: '18.1' } },
  });
});

test('scrubEvent blanks values under sensitive keys', () => {
  const event = {
    extra: {
      email: 'not-an-email-shape',
      access_token: 'x',
      latitude: 37.7,
      lng: -122.2,
      pickup: { lat: 1, lng: 2 },
      Authorization: 'x',
      otp: 1,
      status: 401,
    },
  };
  assert.deepEqual(scrubEvent(event), {
    extra: {
      email: SCRUBBED,
      access_token: SCRUBBED,
      latitude: SCRUBBED,
      lng: SCRUBBED,
      pickup: { lat: SCRUBBED, lng: SCRUBBED },
      Authorization: SCRUBBED,
      otp: SCRUBBED,
      status: 401,
    },
  });
});

test('scrubEvent scrubs coordinate pairs held as numbers', () => {
  assert.deepEqual(scrubEvent({ extra: { origin: [-122.2711, 37.7652], count: 3 } }), {
    extra: { origin: [SCRUBBED, SCRUBBED], count: 3 },
  });
});

test('scrubEvent keeps what symbolication needs', () => {
  const frame = {
    filename: 'app:///index.android.bundle',
    abs_path: 'app:///index.android.bundle',
    function: 'renderRoute',
    lineno: 123456,
    colno: 37,
    in_app: true,
  };
  const event = {
    event_id: 'a3f1c2d4e5b6a7c8d9e0f1a2b3c4d5e6',
    release: 'invalid.placeholder.merge@0.1.0+123456',
    dist: '123456',
    debug_meta: { images: [{ type: 'sourcemap', code_file: 'app:///index.android.bundle', debug_id: '3f2b8c1e-9d4a-4b7e-8f21-0c6d5e4a3b2f' }] },
    exception: { values: [{ type: 'Error', value: 'boom', stacktrace: { frames: [frame] } }] },
  };
  assert.deepEqual(scrubEvent(event), event);
});

test('scrubEvent does not change its input', () => {
  const event = { message: 'a@b.co', user: { id: 'u1' } };
  scrubEvent(event);
  assert.deepEqual(event, { message: 'a@b.co', user: { id: 'u1' } });
});

// --- scrubBreadcrumb ---

test('scrubBreadcrumb scrubs the message and data', () => {
  const crumb = {
    category: 'fetch',
    message: 'GET profiles?email=eq.a@b.co',
    data: { url: 'https://x.supabase.co/rest/v1/rides?id=eq.3f2b8c1e-9d4a-4b7e-8f21-0c6d5e4a3b2f', status_code: 200 },
  };
  assert.deepEqual(scrubBreadcrumb(crumb), {
    category: 'fetch',
    message: `GET profiles?email=${SCRUBBED}`,
    data: { url: `https://x.supabase.co/rest/v1/rides?id=eq.${SCRUBBED}`, status_code: 200 },
  });
});

// --- monitoringOptions ---

test('monitoringOptions is null outside preview and production', () => {
  for (const appEnv of [undefined, '', 'development', 'test']) {
    assert.equal(monitoringOptions({ appEnv, dsn: 'https://k@o1.ingest.us.sentry.io/1' }), null, String(appEnv));
  }
});

test('monitoringOptions is null without a DSN', () => {
  for (const dsn of [undefined, '', '   ']) {
    assert.equal(monitoringOptions({ appEnv: 'production', dsn }), null, JSON.stringify(dsn));
  }
});

test('monitoringOptions turns off PII, replay, tracing, sessions and screenshots', () => {
  const options = monitoringOptions({ appEnv: 'preview', dsn: ' https://k@o1.ingest.us.sentry.io/1 ' });
  assert.ok(options);
  assert.equal(options.dsn, 'https://k@o1.ingest.us.sentry.io/1');
  assert.equal(options.environment, 'preview');
  assert.equal(options.sendDefaultPii, false);
  assert.equal(options.replaysSessionSampleRate, 0);
  assert.equal(options.replaysOnErrorSampleRate, 0);
  assert.equal('tracesSampleRate' in options, false);
  assert.equal(options.enableAutoSessionTracking, false);
  assert.equal(options.attachScreenshot, false);
  assert.equal(options.attachViewHierarchy, false);
  assert.equal(options.beforeSend, scrubEvent);
  assert.equal(options.beforeBreadcrumb, scrubBreadcrumb);
});
