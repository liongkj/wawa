import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { promisify } from 'node:util';
import { z } from 'zod';
import { ComputerPairResultSchema, PairInfoSchema } from '../shared/pairing.js';

const run = promisify(execFile);

/** 443 for a domain or IP behind Caddy, then the range the installer takes for Tailscale Serve. */
export const pairingPorts = [443, ...Array.from({ length: 20 }, (_, i) => 8443 + i)];
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

export type Probe = (origin: string) => Promise<boolean>;
export type Fetch = typeof fetch;

const TailscaleStatusSchema = z.object({
  MagicDNSSuffix: z.string().catch(''),
  Peer: z
    .record(
      z.string(),
      z.object({
        HostName: z.string(),
        DNSName: z.string(),
        Online: z.boolean().catch(false),
      }),
    )
    .nullish()
    .transform((peers) => Object.values(peers ?? {})),
});
export type TailscaleStatus = z.infer<typeof TailscaleStatusSchema>;

export function tailscaleBinaries(platform = process.platform) {
  if (platform === 'win32') return ['C:\\Program Files\\Tailscale\\tailscale.exe', 'tailscale'];
  return [
    '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
    '/opt/homebrew/bin/tailscale',
    '/usr/local/bin/tailscale',
    '/usr/bin/tailscale',
    'tailscale',
  ];
}

/** `tailscale status --json`, or undefined when Tailscale is not installed or not running. */
export async function tailscaleStatus(
  binaries = tailscaleBinaries(),
): Promise<TailscaleStatus | undefined> {
  for (const binary of binaries) {
    if (binary.includes('/') || binary.includes('\\')) if (!existsSync(binary)) continue;
    try {
      const { stdout } = await run(binary, ['status', '--json'], {
        timeout: 5000,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      });
      const parsed = TailscaleStatusSchema.safeParse(JSON.parse(stdout));
      if (parsed.success) return parsed.data;
    } catch {
      /* Try the next location. */
    }
  }
  return undefined;
}

export function httpProbe(fetcher: Fetch = fetch, timeoutMs = 2000): Probe {
  return async (origin) => {
    try {
      const response = await fetcher(origin + '/api/pair/info', {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
      return response.ok && PairInfoSchema.safeParse(await response.json()).success;
    } catch {
      return false;
    }
  };
}

/** The first origin, in order, that answers as a Wawa pairing endpoint. All are probed at once. */
export async function firstWorkspace(origins: string[], probe: Probe) {
  const answers = await Promise.all(origins.map((origin) => probe(origin)));
  return origins[answers.indexOf(true)];
}

/**
 * Turns what a person typed into the origins to try. A full URL is used as is. A host with a
 * port is tried on that port. A bare host is tried on the pairing ports, and a single-label
 * name is completed with the tailnet's MagicDNS suffix because certificates name the full host.
 */
export function candidateOrigins(input: string, magicDnsSuffix = '') {
  const value = input.trim();
  if (!value) throw new Error('Enter the server name or address.');
  const explicit = value.includes('://');
  let url: URL;
  try {
    url = new URL(explicit ? value : 'https://' + value);
  } catch {
    throw new Error(
      'Enter a server name such as wa-service, or an address such as tasks.example.com.',
    );
  }
  const loopback = loopbackHosts.has(url.hostname);
  if (
    !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('Use an HTTPS server address without a path, login, or query.');
  if (explicit || url.port) return [url.origin];
  const host =
    !url.hostname.includes('.') && !url.hostname.startsWith('[') && magicDnsSuffix && !loopback
      ? `${url.hostname}.${magicDnsSuffix.replace(/\.$/, '')}`
      : url.hostname;
  return pairingPorts.map((port) => new URL(`https://${host}:${port}`).origin);
}

/** Wawa servers among the online peers of this computer's tailnet. */
export async function discover(status: TailscaleStatus | undefined, probe: Probe) {
  if (!status) return [];
  const found = await Promise.all(
    status.Peer.filter((peer) => peer.Online && peer.DNSName).map(async (peer) => {
      const host = peer.DNSName.replace(/\.$/, '');
      const origin = await firstWorkspace(
        pairingPorts.slice(1).map((port) => `https://${host}:${port}`),
        probe,
      );
      return origin ? [{ name: peer.HostName, host, origin }] : [];
    }),
  );
  return found.flat().sort((a, b) => a.name.localeCompare(b.name));
}

export async function computerName(platform = process.platform) {
  if (platform === 'darwin')
    try {
      const { stdout } = await run('scutil', ['--get', 'ComputerName'], { timeout: 2000 });
      if (stdout.trim()) return stdout.trim().slice(0, 80);
    } catch {
      /* Fall back to the host name. */
    }
  return (
    hostname()
      .replace(/\.local$/, '')
      .slice(0, 80) || 'This computer'
  );
}

export async function pair(
  input: { server: string; code: string; name: string },
  deps: { status: TailscaleStatus | undefined; probe: Probe; fetcher?: Fetch },
) {
  const origins = candidateOrigins(input.server, deps.status?.MagicDNSSuffix);
  const origin = await firstWorkspace(origins, deps.probe);
  if (!origin)
    throw new Error(
      `No Wawa server answered at ${input.server.trim()}. Check the name and that the server is running.`,
    );
  let response: Response;
  try {
    response = await (deps.fetcher ?? fetch)(origin + '/api/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: input.code, name: input.name }),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
  } catch {
    throw new Error('The server stopped answering while pairing. Try again.');
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok)
    throw new Error(
      z.object({ error: z.string() }).safeParse(body).data?.error ??
        `The server refused the code (HTTP ${response.status}).`,
    );
  return { origin, ...ComputerPairResultSchema.parse(body) };
}
