import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { LoaderCircle, Lock } from 'lucide-react';
import { api } from './api.js';
import { currentUnlock, lockedEvent, saveUnlock, unlockChangedEvent } from './lock.js';
import { errorMessage } from '../shared/errors.js';
import { AppLockStatusSchema, UnlockResultSchema, type AppLockStatus } from '../shared/app-lock.js';

const touchEvery = 60_000;

/**
 * Shows the PIN screen instead of the workspace while the lock is on and this window has no
 * current unlock. The server enforces the same rule; this only decides what to render.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AppLockStatus | 'unknown' | null>(null);
  const [locked, setLocked] = useState(false);
  const lastTouch = useRef(Date.now());

  const refresh = useCallback(() => {
    void api('lock', AppLockStatusSchema)
      .then((value) => {
        setStatus(value);
        setLocked(value.enabled && !currentUnlock());
      })
      // An older server, or one that wants its password first: render as before.
      .catch(() => setStatus('unknown'));
  }, []);
  useEffect(refresh, [refresh]);

  useEffect(() => {
    const onLocked = () => {
      setLocked(true);
      refresh();
    };
    window.addEventListener(lockedEvent, onLocked);
    window.addEventListener(unlockChangedEvent, refresh);
    return () => {
      window.removeEventListener(lockedEvent, onLocked);
      window.removeEventListener(unlockChangedEvent, refresh);
    };
  }, [refresh]);

  const enabled = typeof status === 'object' && status?.enabled === true;
  useEffect(() => {
    if (!enabled || locked) return;
    // Only a person using the window keeps it unlocked; background polling does not.
    const onActivity = () => {
      if (Date.now() - lastTouch.current < touchEvery || !currentUnlock()) return;
      lastTouch.current = Date.now();
      void api('lock/touch', UnlockResultSchema, {})
        .then((unlock) => saveUnlock(unlock))
        .catch(() => undefined);
    };
    const expiry = setInterval(() => {
      if (!currentUnlock()) setLocked(true);
    }, 5000);
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const name of events) window.addEventListener(name, onActivity, { passive: true });
    return () => {
      clearInterval(expiry);
      for (const name of events) window.removeEventListener(name, onActivity);
    };
  }, [enabled, locked]);

  if (status === null)
    return (
      <main className="onboarding-loading" role="status">
        <LoaderCircle className="spin" size={20} /> Opening your workspace…
      </main>
    );
  if (locked)
    return (
      <LockScreen
        onUnlock={() => {
          lastTouch.current = Date.now();
          setLocked(false);
        }}
      />
    );
  return <>{children}</>;
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      saveUnlock(await api('lock/unlock', UnlockResultSchema, { pin }));
      onUnlock();
    } catch (reason) {
      setError(errorMessage(reason));
      setPin('');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="lock-screen">
      <form className="lock-screen-card" onSubmit={(event) => void submit(event)}>
        <Lock size={22} aria-hidden="true" />
        <h1>Wawa is locked</h1>
        <label htmlFor="unlock-pin">Enter your PIN</label>
        <input
          id="unlock-pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          maxLength={12}
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
        />
        {error && (
          <p className="lock-screen-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" type="submit" disabled={busy || pin.length < 6}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
    </main>
  );
}
