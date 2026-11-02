import { z } from 'zod';
import { UnlockResultSchema } from '../shared/app-lock.js';

// The unlock token lives only in this window's session storage, so opening the app again,
// or another window, starts locked.
const storageKey = 'wawa-unlock';
export const lockedEvent = 'wawa-locked';
export const unlockChangedEvent = 'wawa-unlock-changed';

export function currentUnlock() {
  try {
    const saved = UnlockResultSchema.safeParse(
      JSON.parse(sessionStorage.getItem(storageKey) ?? 'null'),
    );
    if (saved.success && saved.data.expiresAt * 1000 > Date.now()) return saved.data.token;
  } catch {
    /* Unreadable storage counts as locked. */
  }
  return undefined;
}

export function saveUnlock(unlock: z.infer<typeof UnlockResultSchema> | null) {
  if (unlock) sessionStorage.setItem(storageKey, JSON.stringify(unlock));
  else sessionStorage.removeItem(storageKey);
  window.dispatchEvent(new Event(unlockChangedEvent));
}

export function lockNow() {
  saveUnlock(null);
  window.dispatchEvent(new Event(lockedEvent));
}
