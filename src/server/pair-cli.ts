import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Store } from './store.js';
import { DesktopPairing } from './desktop-pairing.js';
import { PairingLifetimeSchema } from '../shared/pairing.js';

const { values } = parseArgs({ options: { days: { type: 'string', default: '365' } } });
const days = PairingLifetimeSchema.safeParse(Number(values.days));
if (!days.success) {
  console.error('--days must be 30, 90 or 365.');
  process.exit(2);
}
const store = new Store(resolve(process.env.DATA_DIR ?? 'data'));
try {
  const code = new DesktopPairing(store).createCode(days.data);
  const server = process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN).host : undefined;
  console.log(
    [
      ...(server ? [`Server:       ${server}`] : []),
      `Pairing code: ${code.code}`,
      `The code works once and expires in 10 minutes. A computer paired with it stays connected while unused for ${code.days} days.`,
    ].join('\n'),
  );
} finally {
  store.close();
}
