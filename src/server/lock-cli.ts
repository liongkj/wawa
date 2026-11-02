import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Store } from './store.js';
import { AppLock } from './app-lock.js';

// For a forgotten PIN: whoever can run commands on the server already owns its data.
const { values } = parseArgs({ options: { off: { type: 'boolean', default: false } } });
const store = new Store(resolve(process.env.DATA_DIR ?? 'data'));
try {
  const lock = new AppLock(store);
  if (values.off) {
    lock.reset();
    console.log('The PIN lock is off. Set a new PIN in Settings → Workspaces.');
  } else {
    console.log(
      lock.status().enabled
        ? `The PIN lock is on and locks after ${lock.status().idleMinutes} idle minutes. Run with --off to remove it.`
        : 'The PIN lock is off.',
    );
  }
} finally {
  store.close();
}
