import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/server/store.js';
import {
  AppLock,
  AppLockError,
  addressFailureLimit,
  globalFailureLimit,
  isLockFree,
  registerAppLock,
} from '../src/server/app-lock.js';
import { routeServer } from './route-fixture.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'wawa-app-lock-')),
    store = new Store(dir),
    lock = new AppLock(store);
  return {
    store,
    lock,
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
    if (error instanceof AppLockError) return error.statusCode;
    throw error;
  }
  return 200;
};

test('with no PIN everything is allowed and nothing can be unlocked', () => {
  const f = fixture();
  try {
    assert.deepEqual(f.lock.status(), { enabled: false, idleMinutes: 15 });
    assert.ok(f.lock.allows(undefined));
    assert.equal(
      status(() => f.lock.unlock('123456', 'a')),
      409,
    );
    assert.equal(
      status(() => f.lock.save({ idleMinutes: 15 }, 'a')),
      400,
    );
  } finally {
    f.close();
  }
});

test('turning the lock on stores only a hash and unlocks the window that set it', () => {
  const f = fixture();
  try {
    const saved = f.lock.save({ pin: '246810', idleMinutes: 5 }, 'a');
    assert.deepEqual(
      { enabled: saved.enabled, idleMinutes: saved.idleMinutes },
      {
        enabled: true,
        idleMinutes: 5,
      },
    );
    assert.ok(saved.unlock && f.lock.allows(saved.unlock.token));
    assert.ok(!JSON.stringify(f.store.metaValue('app_lock')).includes('246810'));
    assert.equal(f.lock.allows(undefined), false);
    assert.equal(f.lock.allows('garbage'), false);
  } finally {
    f.close();
  }
});

test('an unlock lasts the idle period, renews on use, and ends when the PIN changes', () => {
  const f = fixture();
  try {
    f.lock.save({ pin: '246810', idleMinutes: 5 }, 'a');
    const unlock = f.lock.unlock('246810', 'a');
    assert.ok(Math.abs(unlock.expiresAt - (Date.now() / 1000 + 300)) < 5);
    assert.ok(f.lock.allows(unlock.token));
    const renewed = f.lock.touch(unlock.token);
    assert.ok(f.lock.allows(renewed.token));
    assert.equal(
      status(() => f.lock.touch('garbage')),
      423,
    );
    // A forged expiry fails the signature.
    const [version, , nonce, signature] = unlock.token.split('.');
    assert.equal(f.lock.allows(`${version}.9999999999.${nonce}.${signature}`), false);
    const changed = f.lock.save({ currentPin: '246810', pin: '135790', idleMinutes: 15 }, 'a');
    assert.equal(f.lock.allows(unlock.token), false);
    assert.equal(f.lock.allows(renewed.token), false);
    assert.ok(changed.unlock && f.lock.allows(changed.unlock.token));
    assert.ok(f.lock.allows(f.lock.unlock('135790', 'a').token));
  } finally {
    f.close();
  }
});

test('changing the idle time keeps the PIN; changes and turning off need the current PIN', () => {
  const f = fixture();
  try {
    f.lock.save({ pin: '246810', idleMinutes: 15 }, 'a');
    assert.equal(
      status(() => f.lock.save({ idleMinutes: 60 }, 'a')),
      401,
    );
    assert.equal(
      status(() => f.lock.save({ currentPin: '000000', idleMinutes: 60 }, 'a')),
      401,
    );
    const kept = f.lock.save({ currentPin: '246810', idleMinutes: 60 }, 'a');
    assert.equal(kept.idleMinutes, 60);
    assert.ok(f.lock.unlock('246810', 'a'));
    assert.equal(
      status(() => f.lock.disable('000000', 'a')),
      401,
    );
    assert.equal(f.lock.disable('246810', 'a').enabled, false);
    assert.ok(f.lock.allows(undefined));
  } finally {
    f.close();
  }
});

test('wrong PINs lock out one address, then everyone', () => {
  const f = fixture();
  try {
    f.lock.save({ pin: '246810', idleMinutes: 15 }, 'a');
    for (let i = 0; i < addressFailureLimit; i++)
      assert.equal(
        status(() => f.lock.unlock('111111', 'attacker')),
        401,
      );
    assert.equal(
      status(() => f.lock.unlock('246810', 'attacker')),
      429,
    );
    assert.equal(
      status(() => f.lock.unlock('246810', 'owner')),
      200,
    );
    for (let i = addressFailureLimit; i < globalFailureLimit; i++)
      assert.equal(
        status(() => f.lock.unlock('111111', `spread-${i}`)),
        401,
      );
    assert.equal(
      status(() => f.lock.unlock('246810', 'owner')),
      429,
    );
  } finally {
    f.close();
  }
});

test('the shell reset removes a forgotten PIN', () => {
  const f = fixture();
  try {
    f.lock.save({ pin: '246810', idleMinutes: 15 }, 'a');
    f.lock.reset();
    assert.equal(f.lock.status().enabled, false);
    assert.ok(f.lock.allows(undefined));
  } finally {
    f.close();
  }
});

test('only reading the lock and unlocking work while locked', () => {
  assert.ok(isLockFree('GET', '/api/lock'));
  assert.ok(isLockFree('POST', '/api/lock/unlock'));
  for (const [method, path] of [
    ['POST', '/api/lock/touch'],
    ['POST', '/api/lock/settings'],
    ['POST', '/api/lock/disable'],
    ['GET', '/api/state'],
  ] as const)
    assert.equal(isLockFree(method, path), false, path);
});

test('the routes unlock with a PIN and renew with the header', async () => {
  const f = fixture();
  const server = routeServer();
  registerAppLock(server, f.lock);
  await server.ready();
  try {
    const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
      server.inject({ method: 'POST', url, payload: payload as object, headers });
    assert.equal(
      (await post('/api/lock/settings', { pin: '12', idleMinutes: 15 })).statusCode,
      400,
    );
    assert.equal(
      (await post('/api/lock/settings', { pin: '246810', idleMinutes: 7 })).statusCode,
      400,
    );
    assert.equal(
      (await post('/api/lock/settings', { pin: '246810', idleMinutes: 15 })).statusCode,
      200,
    );
    assert.deepEqual((await server.inject({ method: 'GET', url: '/api/lock' })).json(), {
      enabled: true,
      idleMinutes: 15,
    });
    const wrong = await post('/api/lock/unlock', { pin: '111111' });
    assert.equal(wrong.statusCode, 401);
    assert.equal(wrong.json().error, 'That PIN is not right.');
    const unlock = (await post('/api/lock/unlock', { pin: '246810' })).json();
    const touched = await post('/api/lock/touch', {}, { 'x-wawa-unlock': unlock.token });
    assert.equal(touched.statusCode, 200);
    assert.ok(f.lock.allows(touched.json().token));
    assert.equal((await post('/api/lock/touch', {})).statusCode, 423);
  } finally {
    await server.close();
    f.close();
  }
});
