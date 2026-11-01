import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// The real installer runs against stand-in commands that record every call, so each route
// can be checked without Docker, Tailscale, DNS, or the network.
const skip = process.platform === 'win32';
const installer = resolve('scripts/install-server.sh');
const compose = resolve('deploy/server/compose.yml');

const stubs: Record<string, string> = {
  uname: 'echo Linux',
  sleep: 'exit 0',
  docker: `
case "$*" in
  'compose version'|info) exit 0;;
  ps*|'volume ls'*) exit 0;;
esac
case "$*" in
  *' exec -T wawa node dist/server/pair-cli.js'*)
    printf 'Server:       %s\\nPairing code: 1234 5678\\nThe code works once and expires in 10 minutes.\\n' "$STUB_SERVER"
    exit 0;;
  *compose*) exit 0;;
esac
exit 1`,
  tailscale: `
case "$*" in
  'status --json') printf '{"BackendState":"Running","Self":{"Online":true,"DNSName":"wa-test.tail.ts.net."}}';;
  'serve status --json') printf '{}';;
  'serve --bg'*) exit 0;;
  *) exit 1;;
esac`,
  curl: `
url=''
for arg; do case "$arg" in http*) url=$arg;; esac; done
out=''
while [ $# -gt 0 ]; do [ "$1" = -o ] && out=$2; shift; done
case "$url" in
  https://raw.githubusercontent.com/*/deploy/server/compose.yml) cp "$STUB_COMPOSE" "$out";;
  https://checkip.amazonaws.com) echo "$STUB_PUBLIC_IP";;
  http://127.0.0.1:*/api/health) exit 0;;
  */api/pair/info) [ -z "\${STUB_UNREACHABLE:-}" ] || exit 7;;
  *) exit 22;;
esac`,
  getent: 'echo "$STUB_RESOLVED STREAM $2"',
};

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'wawa-installer-')),
    bin = join(root, 'bin'),
    log = join(root, 'calls.log');
  mkdirSync(bin);
  for (const [name, body] of Object.entries(stubs)) {
    writeFileSync(
      join(bin, name),
      `#!/usr/bin/env bash\nprintf '%s %s\\n' ${name} "$*" >> "$STUB_LOG"\n${body}\n`,
    );
    chmodSync(join(bin, name), 0o755);
  }
  const dir = join(root, 'wawa-server');
  const run = (env: Record<string, string>, args: string[] = []) => {
    const result = spawnSync('bash', [installer, ...args], {
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: root,
        TMPDIR: root,
        WAWA_INSTALL_DIR: dir,
        WAWA_AUTO_UPDATE: '0',
        STUB_LOG: log,
        STUB_COMPOSE: compose,
        STUB_SERVER: 'wa-test.tail.ts.net:8443',
        STUB_PUBLIC_IP: '203.0.113.5',
        STUB_RESOLVED: '203.0.113.5',
        ...env,
      },
    });
    return { ...result, output: result.stdout + result.stderr };
  };
  const helper = (args: string[]) =>
    spawnSync('bash', [join(dir, 'update.sh'), ...args], {
      encoding: 'utf8',
      env: { PATH: `${bin}:${process.env.PATH}`, STUB_LOG: log, STUB_SERVER: 'x' },
    });
  return {
    dir,
    run,
    helper,
    env: () =>
      Object.fromEntries(
        readFileSync(join(dir, '.env'), 'utf8')
          .trim()
          .split('\n')
          .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
      ),
    calls: () => (existsSync(log) ? readFileSync(log, 'utf8') : ''),
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

test(
  'a Tailscale install asks nothing, prints a pairing code and the password once',
  { skip },
  () => {
    const f = fixture();
    try {
      const first = f.run({ WAWA_ROUTE: 'tailscale' });
      assert.equal(first.status, 0, first.output);
      const env = f.env();
      assert.equal(env.WAWA_ROUTE, 'tailscale');
      assert.equal(env.WAWA_ORIGIN, 'https://wa-test.tail.ts.net:8443');
      assert.equal(env.WAWA_ENGINE, 'whatsapp-web.js');
      assert.match(env.APP_PASSWORD ?? '', /^[A-Za-z0-9_-]{32}$/);
      assert.equal(env.TRUSTED_PROXIES, undefined);
      assert.equal(statSync(join(f.dir, '.env')).mode & 0o777, 0o600);
      assert.match(first.stdout, /Pairing code: 1234 5678/);
      assert.match(first.stdout, /pick wa-test, and enter the code/);
      assert.ok(
        first.stdout.includes(`Password for signing in from a browser: ${env.APP_PASSWORD}`),
      );
      assert.match(f.calls(), /tailscale serve --bg --https=8443 http:\/\/127\.0\.0\.1:\d+/);
      assert.doesNotMatch(f.calls(), /--profile/);

      const again = f.run({});
      assert.equal(again.status, 0, again.output);
      assert.deepEqual(f.env(), env);
      assert.ok(!again.stdout.includes(env.APP_PASSWORD ?? 'missing'));
      assert.match(again.stdout, /Pairing code: 1234 5678/);
    } finally {
      f.close();
    }
  },
);

test('update.sh creates codes in the container and shows the password', { skip }, () => {
  const f = fixture();
  try {
    assert.equal(f.run({ WAWA_ROUTE: 'tailscale' }).status, 0);
    const pair = f.helper(['pair', '--days', '90']);
    assert.equal(pair.status, 0, pair.stderr);
    assert.match(pair.stdout, /Pairing code: 1234 5678/);
    assert.match(
      f.calls(),
      /docker compose --project-name wawa-server .* exec -T wawa node dist\/server\/pair-cli\.js --days 90/,
    );
    const password = f.helper(['password']);
    assert.equal(password.stdout.trim(), f.env().APP_PASSWORD);
    assert.equal(f.helper(['nonsense']).status, 2);
  } finally {
    f.close();
  }
});

test('a domain install checks DNS, runs Caddy, and trusts only the proxy network', { skip }, () => {
  const f = fixture();
  try {
    const wrong = f.run({
      WAWA_ROUTE: 'domain',
      WAWA_DOMAIN: 'Tasks.Example.com',
      STUB_RESOLVED: '198.51.100.7',
    });
    assert.notEqual(wrong.status, 0);
    assert.match(wrong.stderr, /Point an A record for tasks\.example\.com to 203\.0\.113\.5/);
    assert.ok(!existsSync(join(f.dir, '.env')));

    const ok = f.run({ WAWA_ROUTE: 'domain', WAWA_DOMAIN: 'Tasks.Example.com' });
    assert.equal(ok.status, 0, ok.output);
    const env = f.env();
    assert.equal(env.WAWA_ORIGIN, 'https://tasks.example.com');
    assert.equal(env.WAWA_DOMAIN, 'tasks.example.com');
    assert.equal(env.TRUSTED_PROXIES, '172.16.0.0/12,192.168.0.0/16');
    assert.match(f.calls(), /--profile domain up -d/);
    assert.doesNotMatch(f.calls(), /^tailscale /m);
    assert.match(ok.stdout, /pick tasks\.example\.com, and enter the code/);
    assert.match(f.helper(['pair']).stdout, /Pairing code/);
    assert.match(f.calls(), /--profile domain exec -T wawa/);
  } finally {
    f.close();
  }
});

test(
  'an unreachable domain fails with the fix, and a later run still shows the password',
  { skip },
  () => {
    const f = fixture();
    try {
      const blocked = f.run({
        WAWA_ROUTE: 'domain',
        WAWA_DOMAIN: 'tasks.example.com',
        STUB_UNREACHABLE: '1',
      });
      assert.notEqual(blocked.status, 0);
      assert.match(blocked.stderr, /Open ports 80 and 443/);
      const password = f.env().APP_PASSWORD ?? 'missing';
      assert.ok(!blocked.output.includes(password));
      const fixed = f.run({});
      assert.equal(fixed.status, 0, fixed.output);
      assert.ok(fixed.stdout.includes(password));
      assert.ok(!f.run({}).stdout.includes(password));
    } finally {
      f.close();
    }
  },
);

test(
  'a Cloudflare Tunnel install keeps the token out of commands and runs cloudflared',
  { skip },
  () => {
    const f = fixture();
    try {
      const token = 'eyJ' + 'a'.repeat(120);
      const bad = f.run({
        WAWA_ROUTE: 'cloudflare',
        WAWA_DOMAIN: 'wawa.example.com',
        WAWA_TUNNEL_TOKEN: 'short',
      });
      assert.notEqual(bad.status, 0);
      assert.match(bad.stderr, /does not look like a Cloudflare tunnel token/);
      const ok = f.run({
        WAWA_ROUTE: 'cloudflare',
        WAWA_DOMAIN: 'wawa.example.com',
        WAWA_TUNNEL_TOKEN: token,
      });
      assert.equal(ok.status, 0, ok.output);
      assert.equal(f.env().CLOUDFLARE_TUNNEL_TOKEN, token);
      assert.equal(f.env().WAWA_ORIGIN, 'https://wawa.example.com');
      assert.match(f.calls(), /--profile cloudflare up -d/);
      assert.ok(!f.calls().includes(token));
      assert.ok(!ok.output.includes(token));
      assert.doesNotMatch(f.calls(), /checkip|getent/);
    } finally {
      f.close();
    }
  },
);

test('invalid choices are refused before anything is written', { skip }, () => {
  const f = fixture();
  try {
    const route = f.run({ WAWA_ROUTE: 'carrier-pigeon' });
    assert.match(route.stderr, /WAWA_ROUTE must be tailscale, domain or cloudflare/);
    const domain = f.run({ WAWA_ROUTE: 'domain', WAWA_DOMAIN: 'https://tasks.example.com/x' });
    assert.match(domain.stderr, /Enter a domain such as tasks\.example\.com/);
    const engine = f.run({ WAWA_ROUTE: 'tailscale', WAWA_ENGINE: 'other' });
    assert.match(engine.stderr, /WAWA_ENGINE must be/);
    assert.ok(!existsSync(join(f.dir, '.env')));
  } finally {
    f.close();
  }
});
