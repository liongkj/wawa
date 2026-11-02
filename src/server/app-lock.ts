import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Store, now } from './store.js';
import { UserError } from './errors.js';
import {
  AppLockDisableSchema,
  AppLockSettingsSchema,
  IdleMinutesSchema,
  PinSchema,
  UnlockRequestSchema,
  unlockHeader,
  type AppLockStatus,
} from '../shared/app-lock.js';

export const addressFailureLimit = 5;
export const globalFailureLimit = 20;
export const failureWindow = 15 * 60;
const metaKey = 'app_lock';

const SavedLock = z.object({
  salt: z.string(),
  hash: z.string(),
  /** Bumped whenever the PIN changes, so every earlier unlock stops working. */
  version: z.number().int(),
  idleMinutes: IdleMinutesSchema,
});

export class AppLockError extends UserError {
  constructor(statusCode: number, message: string) {
    super(message, statusCode);
  }
}

const hashPin = (pin: string, salt: string) =>
  scryptSync(pin, Buffer.from(salt, 'base64'), 32, { N: 16384, r: 8, p: 1 }).toString('base64');

/**
 * An optional PIN that locks the workspace UI and its API. Unlocking returns a short-lived
 * token that each window keeps in memory and renews only while a person is using it.
 */
export class AppLock {
  private readonly failures = new Map<string, { count: number; until: number }>();
  private recent: number[] = [];
  constructor(readonly store: Store) {}

  private saved() {
    const value = SavedLock.safeParse(this.store.metaValue(metaKey));
    return value.success ? value.data : undefined;
  }

  status(): AppLockStatus {
    const saved = this.saved();
    return { enabled: Boolean(saved), idleMinutes: saved?.idleMinutes ?? 15 };
  }

  private matches(pin: string) {
    const saved = this.saved();
    if (!saved || !/^\d{6,12}$/.test(pin)) return false;
    const expected = Buffer.from(saved.hash, 'base64'),
      actual = Buffer.from(hashPin(pin, saved.salt), 'base64');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  /** Checks a PIN with lockouts per address and across all addresses. */
  private check(pin: string, address: string) {
    const timestamp = now();
    this.recent = this.recent.filter((at) => at > timestamp - failureWindow);
    const prior = this.failures.get(address);
    if (
      (prior && prior.until > timestamp && prior.count >= addressFailureLimit) ||
      this.recent.length >= globalFailureLimit
    )
      throw new AppLockError(429, 'Too many wrong PINs. Wait 15 minutes and try again.');
    if (this.matches(pin)) {
      this.failures.delete(address);
      return;
    }
    for (const [key, value] of this.failures)
      if (value.until <= timestamp) this.failures.delete(key);
    const current = this.failures.get(address) ?? { count: 0, until: timestamp + failureWindow };
    current.count++;
    if (current.count >= addressFailureLimit) current.until = timestamp + failureWindow;
    this.failures.set(address, current);
    this.recent.push(timestamp);
    throw new AppLockError(401, 'That PIN is not right.');
  }

  private token(saved: z.infer<typeof SavedLock>) {
    const expiresAt = Math.floor(now()) + saved.idleMinutes * 60,
      value = `${saved.version}.${expiresAt}.${randomBytes(18).toString('hex')}`;
    return { token: `${value}.${this.sign(value)}`, expiresAt };
  }

  private sign(value: string) {
    return createHmac('sha256', this.store.key)
      .update('wawa-app-lock\0')
      .update(value)
      .digest('hex');
  }

  /** Whether a request may use the workspace: the lock is off, or the token is current. */
  allows(token: string | undefined) {
    const saved = this.saved();
    if (!saved) return true;
    const match = /^(\d+)\.(\d{1,12})\.([a-f0-9]{36})\.([a-f0-9]{64})$/.exec(token ?? '');
    if (!match) return false;
    const [, version, expiry, nonce, supplied = ''] = match;
    if (Number(version) !== saved.version || Number(expiry) <= now()) return false;
    const expected = Buffer.from(this.sign(`${version}.${expiry}.${nonce}`), 'hex'),
      actual = Buffer.from(supplied, 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  unlock(pin: string, address: string) {
    const saved = this.saved();
    if (!saved) throw new AppLockError(409, 'There is no PIN to unlock.');
    this.check(pin, address);
    return this.token(saved);
  }

  /** Renews a current token; called by the window only when a person used it. */
  touch(token: string | undefined) {
    const saved = this.saved();
    if (!saved) throw new AppLockError(409, 'The lock is off.');
    if (!this.allows(token)) throw new AppLockError(423, 'Wawa is locked. Enter your PIN.');
    return this.token(saved);
  }

  save(input: z.infer<typeof AppLockSettingsSchema>, address: string) {
    const saved = this.saved();
    if (saved) this.check(input.currentPin ?? '', address);
    else if (!input.pin) throw new AppLockError(400, 'Choose a PIN to turn on the lock.');
    const next = input.pin
      ? {
          salt: randomBytes(16).toString('base64'),
          hash: '',
          version: (saved?.version ?? 0) + 1,
          idleMinutes: input.idleMinutes,
        }
      : { ...saved!, idleMinutes: input.idleMinutes };
    if (input.pin) next.hash = hashPin(PinSchema.parse(input.pin), next.salt);
    this.store.setMeta(metaKey, next);
    return { ...this.status(), unlock: this.token(next) };
  }

  disable(currentPin: string, address: string) {
    if (!this.saved()) return { ...this.status(), unlock: null };
    this.check(currentPin, address);
    this.store.setMeta(metaKey, null);
    return { ...this.status(), unlock: null };
  }

  /** For the server shell when the PIN is forgotten. */
  reset() {
    this.store.setMeta(metaKey, null);
  }
}

/** API paths that work while locked: reading the lock state and unlocking. */
export function isLockFree(method: string, path: string) {
  return (
    (method === 'GET' && path === '/api/lock') || (method === 'POST' && path === '/api/lock/unlock')
  );
}

export function unlockToken(headers: Record<string, string | string[] | undefined>) {
  const value = headers[unlockHeader];
  return typeof value === 'string' ? value : undefined;
}

export function registerAppLock(server: FastifyInstance, lock: AppLock) {
  server.get('/api/lock', () => lock.status());
  server.post('/api/lock/unlock', (request) =>
    lock.unlock(UnlockRequestSchema.parse(request.body).pin, request.ip),
  );
  server.post('/api/lock/touch', (request) => lock.touch(unlockToken(request.headers)));
  server.post('/api/lock/settings', (request) =>
    lock.save(AppLockSettingsSchema.parse(request.body), request.ip),
  );
  server.post('/api/lock/disable', (request) =>
    lock.disable(AppLockDisableSchema.parse(request.body).currentPin, request.ip),
  );
}
