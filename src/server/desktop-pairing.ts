import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Store, hash, now } from './store.js';
import { migratePairingTables } from './companion.js';
import { UserError } from './errors.js';
import { clearDeviceSessionCookie, deviceSessionCookie } from './desktop-session.js';
import { DeviceSchema } from '../shared/companion.js';
import {
  ComputerCodeRequestSchema,
  ComputerPairRequestSchema,
  type PairingLifetime,
} from '../shared/pairing.js';

export const codeLifetime = 10 * 60;
export const addressFailureLimit = 5;
export const addressLockout = 15 * 60;
export const codeFailureLimit = 20;
const lockoutNotice = 'desktop_pairing_locked_out';
const day = 86400;

export class PairingError extends UserError {
  constructor(statusCode: number, message: string) {
    super(message, statusCode);
  }
}

const DeviceRow = z.object({ id: z.string(), expires: z.number(), lifetime: z.number() });

/** Pairs computers to this workspace with eight-digit codes and tracks their device tokens. */
export class DesktopPairing {
  private readonly failures = new Map<string, { count: number; until: number }>();
  constructor(readonly store: Store) {
    migratePairingTables(store);
  }

  createCode(days: PairingLifetime = 365) {
    const raw = String(randomInt(0, 100_000_000)).padStart(8, '0'),
      expiresAt = now() + codeLifetime;
    this.store.transaction(() => {
      this.store.db.exec("DELETE FROM companion_codes WHERE kind='desktop'");
      this.store.db
        .prepare(
          "INSERT INTO companion_codes(digest,expires,kind,lifetime) VALUES(?,?,'desktop',?)",
        )
        .run(hash(raw), expiresAt, days * day);
      this.store.setMeta(lockoutNotice, null);
    });
    return { code: `${raw.slice(0, 4)} ${raw.slice(4)}`, expiresAt, days };
  }

  pair(code: string, name: string, address: string) {
    const timestamp = now(),
      prior = this.failures.get(address);
    if (prior && prior.until > timestamp && prior.count >= addressFailureLimit)
      throw new PairingError(
        429,
        'Too many wrong codes from this address. Wait 15 minutes and try again.',
      );
    const normalized = code.replace(/[\s-]/g, ''),
      token = 'c2t_' + randomBytes(32).toString('base64url'),
      deviceId = randomUUID();
    const paired = this.store.transaction(() => {
      if (!/^\d{8}$/.test(normalized)) return undefined;
      const row = this.store.db
        .prepare(
          "DELETE FROM companion_codes WHERE digest=? AND expires>? AND kind='desktop' RETURNING lifetime",
        )
        .get(hash(normalized), timestamp);
      if (!row) return undefined;
      const lifetime = z.object({ lifetime: z.number() }).parse(row).lifetime,
        expiresAt = timestamp + lifetime;
      this.store.db
        .prepare(
          "INSERT INTO companion_devices(id,name,token_digest,origin,created,last_used,expires,kind,lifetime) VALUES(?,?,?,'desktop',?,NULL,?,'desktop',?)",
        )
        .run(deviceId, name, hash(token), timestamp, expiresAt, lifetime);
      return { token, deviceId, expiresAt };
    });
    if (!paired) {
      this.recordFailure(address, timestamp);
      throw new PairingError(
        401,
        'That code is wrong or expired. Create a new code on the server and try again.',
      );
    }
    this.failures.delete(address);
    return paired;
  }

  private recordFailure(address: string, timestamp: number) {
    for (const [key, value] of this.failures)
      if (value.until <= timestamp) this.failures.delete(key);
    const current = this.failures.get(address) ?? { count: 0, until: timestamp + addressLockout };
    current.count++;
    if (current.count >= addressFailureLimit) current.until = timestamp + addressLockout;
    this.failures.set(address, current);
    const live = this.store.db
      .prepare(
        "UPDATE companion_codes SET failures=failures+1 WHERE kind='desktop' AND expires>? RETURNING failures",
      )
      .get(timestamp);
    if (live && z.object({ failures: z.number() }).parse(live).failures >= codeFailureLimit)
      this.store.transaction(() => {
        this.store.db.exec("DELETE FROM companion_codes WHERE kind='desktop'");
        this.store.setMeta(lockoutNotice, timestamp);
      });
  }

  /** Returns the device for a token, or undefined when it is unknown, expired, or revoked. */
  authenticate(token: string) {
    const row = DeviceRow.safeParse(
      this.store.db
        .prepare(
          "SELECT id,expires,lifetime FROM companion_devices WHERE token_digest=? AND revoked IS NULL AND expires>? AND kind='desktop'",
        )
        .get(hash(token), now()),
    );
    if (!row.success) return undefined;
    this.touch(row.data);
    return row.data.id;
  }

  /** Whether a device bound to a session cookie may still use the workspace. */
  sessionValid(deviceId: string) {
    const row = DeviceRow.safeParse(
      this.store.db
        .prepare(
          "SELECT id,expires,lifetime FROM companion_devices WHERE id=? AND revoked IS NULL AND expires>? AND kind='desktop'",
        )
        .get(deviceId, now()),
    );
    if (!row.success) return false;
    this.touch(row.data);
    return true;
  }

  private touch(device: z.infer<typeof DeviceRow>) {
    const timestamp = now();
    this.store.db
      .prepare(
        'UPDATE companion_devices SET last_used=? WHERE id=? AND (last_used IS NULL OR last_used<?)',
      )
      .run(timestamp, device.id, timestamp - 60);
    if (device.expires - timestamp < device.lifetime / 3)
      this.store.db
        .prepare('UPDATE companion_devices SET expires=? WHERE id=?')
        .run(timestamp + device.lifetime, device.id);
  }

  computers() {
    const lockedOutAt = z.number().nullish().parse(this.store.metaValue(lockoutNotice));
    return {
      devices: this.store.db
        .prepare(
          "SELECT id,name,created,last_used AS lastUsed,expires AS expiresAt FROM companion_devices WHERE revoked IS NULL AND expires>? AND kind='desktop' ORDER BY created DESC",
        )
        .all(now())
        .map((row) => DeviceSchema.parse(row)),
      lockedOutAt: lockedOutAt ?? null,
    };
  }

  revoke(id: string) {
    this.store.db
      .prepare("UPDATE companion_devices SET revoked=? WHERE id=? AND kind='desktop'")
      .run(now(), id);
  }
}

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Paths a computer reaches before it has a session; the server's auth hook lets them through. */
export function isUnauthenticatedPairingRequest(method: string, path: string) {
  return (
    (method === 'GET' && path === '/api/pair/info') ||
    (method === 'POST' && (path === '/api/pair' || path === '/desktop-sign-in/device'))
  );
}

/**
 * Parses TRUSTED_PROXIES, a comma-separated list of proxy addresses or CIDR ranges (or
 * `loopback`, `uniquelocal`) whose X-Forwarded-For header Fastify may believe. Unset means
 * none, so the client address is the socket address.
 */
export function trustedProxies(value: string | undefined) {
  const entries = (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of entries)
    if (!/^(loopback|linklocal|uniquelocal|[0-9a-fA-F.:]+(\/\d{1,3})?)$/.test(entry))
      throw new Error(
        'TRUSTED_PROXIES must list proxy IP addresses or CIDR ranges, separated by commas.',
      );
  return entries.length ? entries : false;
}

export function registerDesktopPairing(
  server: FastifyInstance,
  pairing: DesktopPairing,
  options: { key: Buffer; origins: ReadonlySet<string> },
) {
  const { key, origins } = options;
  const httpsHosts = new Set(
    [...origins].filter((origin) => origin.startsWith('https://')).map((o) => new URL(o).host),
  );
  const overHttps = (request: FastifyRequest) => {
    const host = request.headers.host ?? '';
    return httpsHosts.has(host) || loopbackHosts.has(URL.parse('http://' + host)?.hostname ?? '');
  };
  server.get('/api/pair/info', () => ({ pairing: true, name: 'Wawa' }));
  server.post('/api/pair', (request, reply) => {
    if (!overHttps(request))
      return reply.code(403).send({ error: 'Pair over HTTPS. This server address is plain HTTP.' });
    const input = ComputerPairRequestSchema.parse(request.body);
    return pairing.pair(input.code, input.name, request.ip);
  });
  server.post('/desktop-sign-in/device', (request, reply) => {
    const origin = request.headers.origin;
    if (!origin || !origins.has(origin) || new URL(origin).host !== request.headers.host)
      return reply.code(403).send({ error: 'Invalid request origin' });
    const secure = origin.startsWith('https://');
    const input = z.object({ token: z.string().max(200) }).safeParse(request.body);
    const deviceId = input.success ? pairing.authenticate(input.data.token) : undefined;
    if (!deviceId)
      return reply
        .code(401)
        .header('Set-Cookie', clearDeviceSessionCookie(secure))
        .send({ error: 'This computer was disconnected from the workspace. Pair it again.' });
    return reply
      .header('Set-Cookie', deviceSessionCookie(key, deviceId, secure))
      .send({ ok: true });
  });
  server.get('/api/pair/computers', () => pairing.computers());
  server.post('/api/pair/code', (request) =>
    pairing.createCode(ComputerCodeRequestSchema.parse(request.body ?? {}).days),
  );
  server.post('/api/pair/computers/:id/disconnect', (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    pairing.revoke(id);
    return { ok: true };
  });
}
