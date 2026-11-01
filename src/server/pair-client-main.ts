import { z } from 'zod';
import { computerName, discover, httpProbe, pair, tailscaleStatus } from './pair-client.js';

// Run by the desktop app with its bundled Bun: one JSON request on stdin, one JSON line out.
const Input = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('discover') }),
  z.strictObject({
    action: z.literal('pair'),
    server: z.string().max(300),
    code: z.string().max(40),
  }),
]);

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk.toString();
    if (raw.length > 4096) throw new Error('The request is too long.');
  }
  const input = Input.parse(JSON.parse(raw));
  const status = await tailscaleStatus(),
    probe = httpProbe();
  if (input.action === 'discover') return { ok: true, servers: await discover(status, probe) };
  return {
    ok: true,
    ...(await pair(
      { server: input.server, code: input.code, name: await computerName() },
      { status, probe },
    )),
  };
}

let result: unknown;
try {
  result = await main();
} catch (error) {
  const message =
    error instanceof z.ZodError
      ? 'Check the server name and the pairing code.'
      : error instanceof Error
        ? error.message
        : 'Pairing could not be completed.';
  result = { ok: false, error: message };
}
// Abandoned probes keep connection attempts open for seconds; the answer is already known.
process.stdout.write(JSON.stringify(result) + '\n', () => process.exit(0));
