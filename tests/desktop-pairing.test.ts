import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store, now } from '../src/server/store.js';
import { Companion } from '../src/server/companion.js';
import {
  DesktopPairing,
  PairingError,
  addressFailureLimit,
  codeFailureLimit,
  registerDesktopPairing,
  trustedProxies,
} from '../src/server/desktop-pairing.js';
import { registerDesktopSignIn } from '../src/server/desktop-sign-in.js';
import {
  desktopSignInCsp,
  desktopSignInPage,
  deviceSessionId,
} from '../src/server/desktop-session.js';
import { routeServer } from './route-fixture.js';

const day = 86400;
const extensionId = 'a'.repeat(32);

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'wawa-desktop-pairing-')),
    store = new Store(dir),
    pairing = new DesktopPairing(store);
  return {
    dir,
    store,
    pairing,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const status = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    if (error instanceof PairingError) return error.statusCode;
    throw error;
  }
  return 200;
};

test('a desktop code is eight digits, works once, and expires', () => {
  const f = fixture();
  try {
    const code = f.pairing.createCode();
    assert.match(code.code, /^\d{4} \d{4}$/);
    assert.ok(code.expiresAt > now() + 9 * 60 && code.expiresAt <= now() + 10 * 60);
    const paired = f.pairing.pair(code.code.replace(' ', '-'), 'Mac', '10.0.0.1');
    assert.equal(f.pairing.authenticate(paired.token), paired.deviceId);
    assert.equal(
      status(() => f.pairing.pair(code.code, 'Mac', '10.0.0.1')),
      401,
    );
    const expired = f.pairing.createCode();
    f.store.db.prepare("UPDATE companion_codes SET expires=? WHERE kind='desktop'").run(now() - 1);
    assert.equal(
      status(() => f.pairing.pair(expired.code, 'Mac', '10.0.0.1')),
      401,
    );
    assert.ok(
      !JSON.stringify(f.store.db.prepare('SELECT * FROM companion_devices').all()).includes(
        paired.token,
      ),
    );
  } finally {
    f.close();
  }
});

test('a new code replaces the live one', () => {
  const f = fixture();
  try {
    const first = f.pairing.createCode(),
      second = f.pairing.createCode();
    assert.notEqual(first.code, second.code);
    assert.equal(
      status(() => f.pairing.pair(first.code, 'Mac', '10.0.0.1')),
      401,
    );
    f.pairing.pair(second.code, 'Mac', '10.0.0.1');
  } finally {
    f.close();
  }
});

test('browser and computer codes and devices stay apart', () => {
  const f = fixture();
  try {
    const companion = new Companion(f.store, { notify() {}, wake() {}, reconfigure() {} }, false);
    const browserCode = companion.createCode(),
      desktopCode = f.pairing.createCode();
    assert.equal(
      status(() => f.pairing.pair(browserCode.code, 'Mac', '10.0.0.1')),
      401,
    );
    assert.throws(() => companion.pair(desktopCode.code, 'Chrome', extensionId));
    // Creating one kind of code must not delete the other.
    const browser = companion.pair(browserCode.code, 'Chrome', extensionId);
    const desktop = f.pairing.pair(desktopCode.code, 'Mac', '10.0.0.1');
    assert.equal(f.pairing.authenticate(browser.token), undefined);
    assert.throws(() => companion.authenticate(desktop.token, extensionId));
    assert.deepEqual(
      f.pairing.computers().devices.map((d) => d.name),
      ['Mac'],
    );
    assert.deepEqual(
      companion.devices().devices.map((d) => d.name),
      ['Chrome'],
    );
    companion.revoke(desktop.deviceId);
    assert.equal(f.pairing.authenticate(desktop.token), desktop.deviceId);
    f.pairing.revoke(browser.deviceId);
    assert.equal(companion.authenticate(browser.token, extensionId), browser.deviceId);
  } finally {
    f.close();
  }
});

test('existing companion rows survive the migration as browsers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wawa-pairing-migration-'));
  try {
    new Store(dir).close();
    const db = new DatabaseSync(join(dir, 'tasks.sqlite'));
    db.exec(`CREATE TABLE companion_codes(digest TEXT PRIMARY KEY,expires REAL NOT NULL);
      CREATE TABLE companion_devices(id TEXT PRIMARY KEY,name TEXT NOT NULL,token_digest TEXT NOT NULL UNIQUE,origin TEXT NOT NULL,created REAL NOT NULL,last_used REAL,expires REAL NOT NULL,revoked REAL);
      INSERT INTO companion_devices VALUES('old','Old Chrome','digest','chrome-extension://${extensionId}',1,NULL,${now() + day},NULL);`);
    db.close();
    const store = new Store(dir);
    try {
      new DesktopPairing(store);
      const companion = new Companion(store, { notify() {}, wake() {}, reconfigure() {} }, false);
      assert.deepEqual(
        companion.devices().devices.map((d) => d.id),
        ['old'],
      );
      assert.deepEqual(
        { ...store.db.prepare("SELECT kind FROM companion_devices WHERE id='old'").get() },
        { kind: 'browser' },
      );
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the lifetime chosen on the code is carried to the device and renewed by use', () => {
  const f = fixture();
  try {
    const paired = f.pairing.pair(f.pairing.createCode(30).code, 'Mac', '10.0.0.1');
    const row = () =>
      f.store.db
        .prepare('SELECT expires,lifetime FROM companion_devices WHERE id=?')
        .get(paired.deviceId) as { expires: number; lifetime: number };
    assert.equal(row().lifetime, 30 * day);
    assert.ok(Math.abs(paired.expiresAt - (now() + 30 * day)) < 5);
    // More than a third left: use does not move the expiry.
    f.store.db
      .prepare('UPDATE companion_devices SET expires=? WHERE id=?')
      .run(now() + 20 * day, paired.deviceId);
    assert.ok(f.pairing.sessionValid(paired.deviceId));
    assert.ok(row().expires < now() + 21 * day);
    // Less than a third left: use pushes the expiry a full lifetime ahead.
    f.store.db
      .prepare('UPDATE companion_devices SET expires=? WHERE id=?')
      .run(now() + 2 * day, paired.deviceId);
    assert.equal(f.pairing.authenticate(paired.token), paired.deviceId);
    assert.ok(row().expires > now() + 29 * day);
    // Past expiry: no renewal.
    f.store.db
      .prepare('UPDATE companion_devices SET expires=? WHERE id=?')
      .run(now() - 1, paired.deviceId);
    assert.equal(f.pairing.authenticate(paired.token), undefined);
    assert.equal(f.pairing.sessionValid(paired.deviceId), false);
  } finally {
    f.close();
  }
});

test('revoking a computer ends its token and its session', () => {
  const f = fixture();
  try {
    const paired = f.pairing.pair(f.pairing.createCode().code, 'Mac', '10.0.0.1');
    assert.ok(f.pairing.sessionValid(paired.deviceId));
    f.pairing.revoke(paired.deviceId);
    assert.equal(f.pairing.authenticate(paired.token), undefined);
    assert.equal(f.pairing.sessionValid(paired.deviceId), false);
    assert.equal(f.pairing.computers().devices.length, 0);
  } finally {
    f.close();
  }
});

test('one address is locked out after repeated wrong codes; others still pair', () => {
  const f = fixture();
  try {
    const code = f.pairing.createCode();
    for (let i = 0; i < addressFailureLimit; i++)
      assert.equal(
        status(() => f.pairing.pair('0000 0000', 'Mac', '10.0.0.66')),
        401,
      );
    assert.equal(
      status(() => f.pairing.pair(code.code, 'Mac', '10.0.0.66')),
      429,
    );
    assert.equal(
      status(() => f.pairing.pair(code.code, 'Mac', '10.0.0.2')),
      200,
    );
  } finally {
    f.close();
  }
});

test('too many wrong codes from anywhere delete the live code and leave a notice', () => {
  const f = fixture();
  try {
    const code = f.pairing.createCode();
    for (let i = 0; i < codeFailureLimit; i++)
      assert.equal(
        status(() => f.pairing.pair('not a code', 'Mac', `10.0.2.${i}`)),
        401,
      );
    assert.equal(
      status(() => f.pairing.pair(code.code, 'Mac', '10.0.3.1')),
      401,
    );
    assert.ok(f.pairing.computers().lockedOutAt);
    f.pairing.createCode();
    assert.equal(f.pairing.computers().lockedOutAt, null);
  } finally {
    f.close();
  }
});

async function routes(origins: string[], trustProxy: ReturnType<typeof trustedProxies> = false) {
  const f = fixture();
  const server = routeServer({ trustProxy });
  registerDesktopSignIn(server, {
    key: f.store.key,
    password: 'open sesame',
    origins: new Set(origins),
    deviceSignedIn: (cookie) => {
      const id = deviceSessionId(cookie, f.store.key);
      return id !== undefined && f.pairing.sessionValid(id);
    },
  });
  registerDesktopPairing(server, f.pairing, { key: f.store.key, origins: new Set(origins) });
  await server.ready();
  return {
    ...f,
    server,
    async close() {
      await server.close();
      f.close();
    },
  };
}

const pairRequest = (code: string, host: string, extra: Record<string, string> = {}) => ({
  method: 'POST' as const,
  url: '/api/pair',
  headers: { host, 'content-type': 'application/json', ...extra },
  payload: { code, name: 'KJ’s MacBook Air' },
});

test('the info endpoint identifies a Wawa server without authentication', async () => {
  const f = await routes(['https://wa.example.ts.net']);
  try {
    const info = await f.server.inject({ method: 'GET', url: '/api/pair/info' });
    assert.deepEqual(info.json(), { pairing: true, name: 'Wawa' });
  } finally {
    await f.close();
  }
});

test('pairing is refused over plain HTTP except on loopback', async () => {
  const f = await routes(['https://wa.example.ts.net', 'http://wa.lan:2786']);
  try {
    const plain = await f.server.inject(pairRequest(f.pairing.createCode().code, 'wa.lan:2786'));
    assert.equal(plain.statusCode, 403);
    const local = await f.server.inject(pairRequest(f.pairing.createCode().code, '127.0.0.1:2786'));
    assert.equal(local.statusCode, 200);
    const secure = await f.server.inject(
      pairRequest(f.pairing.createCode().code, 'wa.example.ts.net'),
    );
    assert.equal(secure.statusCode, 200);
    assert.match(secure.json().token, /^c2t_/);
  } finally {
    await f.close();
  }
});

test('a device token signs the window in, and a revoked one is sent to the disconnected page', async () => {
  const origin = 'https://wa.example.ts.net';
  const f = await routes([origin]);
  try {
    const paired = (
      await f.server.inject(pairRequest(f.pairing.createCode().code, 'wa.example.ts.net'))
    ).json();
    const signIn = (token: string, headers: Record<string, string> = {}) =>
      f.server.inject({
        method: 'POST',
        url: '/desktop-sign-in/device',
        headers: {
          host: 'wa.example.ts.net',
          origin,
          'content-type': 'application/json',
          ...headers,
        },
        payload: { token },
      });
    assert.equal((await signIn(paired.token, { origin: 'https://evil.example' })).statusCode, 403);
    const signedIn = await signIn(paired.token);
    assert.equal(signedIn.statusCode, 200);
    const setCookie = String(signedIn.headers['set-cookie']);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
    const cookie = setCookie.split(';')[0] ?? '';
    assert.equal(deviceSessionId(cookie, f.store.key), paired.deviceId);
    const page = await f.server.inject({
      method: 'GET',
      url: '/desktop-sign-in',
      headers: { host: 'wa.example.ts.net', cookie },
    });
    assert.equal(page.statusCode, 303);
    f.pairing.revoke(paired.deviceId);
    const after = await f.server.inject({
      method: 'GET',
      url: '/desktop-sign-in',
      headers: { host: 'wa.example.ts.net', cookie },
    });
    assert.equal(after.statusCode, 200);
    const refused = await signIn(paired.token);
    assert.equal(refused.statusCode, 401);
    assert.match(String(refused.headers['set-cookie']), /Max-Age=0/);
    const disconnected = await f.server.inject({
      method: 'GET',
      url: '/desktop-sign-in?disconnected=1',
    });
    assert.match(disconnected.body, /This computer was disconnected/);
  } finally {
    await f.close();
  }
});

test('a tampered device cookie is ignored', async () => {
  const f = fixture();
  try {
    const paired = f.pairing.pair(f.pairing.createCode().code, 'Mac', '10.0.0.1');
    const forged = `wawa_device=${paired.deviceId}.${Math.floor(Date.now() / 1000) + 60}.${'a'.repeat(48)}.${'b'.repeat(64)}`;
    assert.equal(deviceSessionId(forged, f.store.key), undefined);
  } finally {
    f.close();
  }
});

test('the sign-in page script is allowed by the page CSP hash', () => {
  const page = desktopSignInPage();
  const script = /<script>([\s\S]*)<\/script>/.exec(page)?.[1] ?? '';
  const hash = createHash('sha256').update(script).digest('base64');
  assert.ok(desktopSignInCsp.includes(`'sha256-${hash}'`));
  assert.match(script, /disconnected=1/);
});

test('behind a trusted proxy, lockouts count the forwarded address, and only from that proxy', async () => {
  const f = await routes(['https://wa.example.ts.net'], trustedProxies('172.18.0.1'));
  try {
    f.pairing.createCode();
    const wrong = (forwarded: string, remoteAddress: string) =>
      f.server.inject({
        ...pairRequest('0000 0000', 'wa.example.ts.net', { 'x-forwarded-for': forwarded }),
        remoteAddress,
      });
    for (let i = 0; i < addressFailureLimit; i++)
      assert.equal((await wrong('203.0.113.9', '172.18.0.1')).statusCode, 401);
    assert.equal((await wrong('203.0.113.9', '172.18.0.1')).statusCode, 429);
    // Another client behind the same proxy is unaffected.
    assert.equal((await wrong('198.51.100.4', '172.18.0.1')).statusCode, 401);
    // A direct client cannot dodge its lockout by inventing a forwarded address.
    for (let i = 0; i < addressFailureLimit; i++) await wrong(`192.0.2.${i}`, '10.9.9.9');
    assert.equal((await wrong('192.0.2.200', '10.9.9.9')).statusCode, 429);
  } finally {
    await f.close();
  }
});

test('TRUSTED_PROXIES accepts addresses, ranges, and keywords only', () => {
  assert.equal(trustedProxies(undefined), false);
  assert.equal(trustedProxies(' '), false);
  assert.deepEqual(trustedProxies('172.18.0.1, 10.0.0.0/8,loopback'), [
    '172.18.0.1',
    '10.0.0.0/8',
    'loopback',
  ]);
  assert.throws(() => trustedProxies('true'));
  assert.throws(() => trustedProxies('*'));
});
