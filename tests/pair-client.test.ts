import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Store } from '../src/server/store.js';
import { DesktopPairing, registerDesktopPairing } from '../src/server/desktop-pairing.js';
import {
  candidateOrigins,
  discover,
  firstWorkspace,
  httpProbe,
  pair,
  pairingPorts,
  tailscaleStatus,
  type TailscaleStatus,
} from '../src/server/pair-client.js';
import { routeServer } from './route-fixture.js';

test('a bare tailnet name is completed with the MagicDNS suffix and tried on the pairing ports', () => {
  const origins = candidateOrigins(' wa-service ', 'tailb4401b.ts.net.');
  assert.equal(origins.length, pairingPorts.length);
  assert.equal(origins[0], 'https://wa-service.tailb4401b.ts.net');
  assert.equal(origins[1], 'https://wa-service.tailb4401b.ts.net:8443');
  assert.equal(origins.at(-1), 'https://wa-service.tailb4401b.ts.net:8462');
});

test('domains, IP addresses, ports and full URLs are used as typed', () => {
  assert.equal(
    candidateOrigins('tasks.example.com', 'tail.ts.net')[0],
    'https://tasks.example.com',
  );
  assert.equal(candidateOrigins('203.0.113.5')[0], 'https://203.0.113.5');
  assert.deepEqual(candidateOrigins('wa-service.tail.ts.net:8444'), [
    'https://wa-service.tail.ts.net:8444',
  ]);
  assert.deepEqual(candidateOrigins('https://tasks.example.com/'), ['https://tasks.example.com']);
  assert.deepEqual(candidateOrigins('http://127.0.0.1:2786'), ['http://127.0.0.1:2786']);
  // Without Tailscale there is no suffix to add.
  assert.equal(candidateOrigins('wa-service')[0], 'https://wa-service');
});

test('unsafe or malformed addresses are refused', () => {
  for (const input of [
    '',
    'http://tasks.example.com',
    'https://user:pw@tasks.example.com',
    'https://tasks.example.com/workspace',
    'https://tasks.example.com/?x=1',
    'ftp://tasks.example.com',
  ])
    assert.throws(() => candidateOrigins(input), input);
});

test('the first answering origin in order wins, even if a later one answers first', async () => {
  const origins = ['https://a', 'https://b', 'https://c'];
  const probe = async (origin: string) => {
    if (origin === 'https://c') return true;
    await new Promise((done) => setTimeout(done, 20));
    return origin === 'https://b';
  };
  assert.equal(await firstWorkspace(origins, probe), 'https://b');
  assert.equal(await firstWorkspace(origins, async () => false), undefined);
});

test('discovery lists online tailnet peers that answer as Wawa servers', async () => {
  const status: TailscaleStatus = {
    MagicDNSSuffix: 'tail.ts.net',
    Peer: [
      { HostName: 'fedora', DNSName: 'fedora.tail.ts.net.', Online: true },
      { HostName: 'phone', DNSName: 'phone.tail.ts.net.', Online: true },
      { HostName: 'old-box', DNSName: 'old-box.tail.ts.net.', Online: false },
      { HostName: 'backup', DNSName: 'backup.tail.ts.net.', Online: true },
    ],
  };
  const probed: string[] = [];
  const probe = async (origin: string) => {
    probed.push(origin);
    return (
      origin === 'https://fedora.tail.ts.net:8443' ||
      origin === 'https://backup.tail.ts.net:8450' ||
      origin === 'https://old-box.tail.ts.net:8443'
    );
  };
  assert.deepEqual(await discover(status, probe), [
    { name: 'backup', host: 'backup.tail.ts.net', origin: 'https://backup.tail.ts.net:8450' },
    { name: 'fedora', host: 'fedora.tail.ts.net', origin: 'https://fedora.tail.ts.net:8443' },
  ]);
  assert.ok(!probed.some((origin) => origin.includes('old-box')));
  assert.equal(await discover(undefined, probe).then((list) => list.length), 0);
});

test(
  'Tailscale status is read from the first working binary',
  { skip: process.platform === 'win32' },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wawa-tailscale-'));
    try {
      const broken = join(dir, 'broken'),
        working = join(dir, 'tailscale');
      writeFileSync(broken, '#!/bin/sh\nexit 1\n');
      writeFileSync(
        working,
        `#!/bin/sh\n[ "$1 $2" = "status --json" ] || exit 2\necho '${JSON.stringify({
          MagicDNSSuffix: 'tail.ts.net',
          Peer: { a: { HostName: 'fedora', DNSName: 'fedora.tail.ts.net.', Online: true } },
        })}'\n`,
      );
      chmodSync(broken, 0o755);
      chmodSync(working, 0o755);
      const status = await tailscaleStatus([join(dir, 'missing'), broken, working]);
      assert.equal(status?.MagicDNSSuffix, 'tail.ts.net');
      assert.equal(status?.Peer[0]?.HostName, 'fedora');
      assert.equal(await tailscaleStatus([join(dir, 'missing')]), undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test('a service that is not Wawa does not count as a pairing endpoint', async () => {
  const answer = (body: unknown, status = 200) =>
    httpProbe(async () => new Response(JSON.stringify(body), { status }));
  assert.equal(await answer({ pairing: true, name: 'Wawa' })('https://x'), true);
  assert.equal(await answer({ hello: 'world' })('https://x'), false);
  assert.equal(await answer({ pairing: true, name: 'Wawa' }, 404)('https://x'), false);
});

test('pairing against a running server returns its origin and a device token', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wawa-pair-client-')),
    store = new Store(dir),
    pairing = new DesktopPairing(store),
    server = routeServer();
  registerDesktopPairing(server, pairing, { key: store.key, origins: new Set() });
  await server.listen({ port: 0, host: '127.0.0.1' });
  const origin = `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`;
  try {
    const deps = { status: undefined, probe: httpProbe() };
    assert.equal(await httpProbe()(origin), true);
    assert.equal(await httpProbe()('http://127.0.0.1:9'), false);
    const result = await pair(
      { server: origin, code: pairing.createCode().code, name: 'Test Mac' },
      deps,
    );
    assert.equal(result.origin, origin);
    assert.equal(pairing.authenticate(result.token), result.deviceId);
    await assert.rejects(
      pair({ server: origin, code: '0000 0000', name: 'Test Mac' }, deps),
      /wrong or expired/,
    );
    await assert.rejects(
      pair({ server: 'http://127.0.0.1:9', code: '1234 5678', name: 'Test Mac' }, deps),
      /No Wawa server answered/,
    );
  } finally {
    await server.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the desktop entry point speaks one JSON line over stdin and stdout', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wawa-pair-main-')),
    store = new Store(dir),
    pairing = new DesktopPairing(store),
    server = routeServer();
  registerDesktopPairing(server, pairing, { key: store.key, origins: new Set() });
  await server.listen({ port: 0, host: '127.0.0.1' });
  const origin = `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`;
  const call = (input: unknown) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const child = execFile(
        process.execPath,
        ['--import', 'tsx', 'src/server/pair-client-main.ts'],
        { timeout: 30000 },
        (error, stdout) => {
          if (error) return reject(error);
          const lines = stdout.trim().split('\n');
          assert.equal(lines.length, 1);
          resolve(JSON.parse(lines[0] ?? '') as Record<string, unknown>);
        },
      );
      child.stdin?.end(JSON.stringify(input));
    });
  try {
    const ok = await call({ action: 'pair', server: origin, code: pairing.createCode().code });
    assert.equal(ok.ok, true);
    assert.equal(ok.origin, origin);
    assert.match(String(ok.token), /^c2t_/);
    assert.equal(pairing.computers().devices.length, 1);
    const wrong = await call({ action: 'pair', server: origin, code: '0000 0000' });
    assert.equal(wrong.ok, false);
    assert.match(String(wrong.error), /wrong or expired/);
    const malformed = await call({ action: 'pair', server: origin });
    assert.deepEqual(malformed, {
      ok: false,
      error: 'Check the server name and the pairing code.',
    });
  } finally {
    await server.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
