import type { Notify } from '../../shared/useNotice.js';
import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { api } from '../api.js';
import { lockNow, saveUnlock } from '../lock.js';
import { errorMessage } from '../../shared/errors.js';
import {
  AppLockSavedSchema,
  AppLockStatusSchema,
  IdleMinutesSchema,
  idleMinuteChoices,
  type AppLockStatus,
} from '../../shared/app-lock.js';
import { SettingsGroup, SettingsRow } from './primitives.js';

const digits = (value: string) => value.replace(/\D/g, '').slice(0, 12);

export function AppLockSettings({ notify }: { notify: Notify }) {
  const [status, setStatus] = useState<AppLockStatus | null>(null);
  const [currentPin, setCurrentPin] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [idleMinutes, setIdleMinutes] = useState<AppLockStatus['idleMinutes']>(15);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api('lock', AppLockStatusSchema)
      .then((value) => {
        setStatus(value);
        setIdleMinutes(value.idleMinutes);
      })
      .catch((error) => notify(errorMessage(error), 'error'));
  }, [notify]);
  if (!status) return null;
  const enabled = status.enabled;
  const pinValid = /^\d{6,12}$/.test(pin);
  const newPinReady = pinValid && pin === confirmPin;
  const canSave =
    !busy && (enabled ? currentPin.length >= 6 && (!pin || newPinReady) : newPinReady);

  async function run(action: 'save' | 'disable') {
    setBusy(true);
    try {
      const result =
        action === 'save'
          ? await api('lock/settings', AppLockSavedSchema, {
              ...(enabled && { currentPin }),
              ...(pin && { pin }),
              idleMinutes,
            })
          : await api('lock/disable', AppLockSavedSchema, { currentPin });
      saveUnlock(result.unlock);
      setStatus({ enabled: result.enabled, idleMinutes: result.idleMinutes });
      setCurrentPin('');
      setPin('');
      setConfirmPin('');
      notify(
        action === 'disable'
          ? 'PIN lock turned off'
          : enabled
            ? 'PIN lock saved. Other windows must enter the PIN again.'
            : 'PIN lock turned on',
      );
    } catch (error) {
      notify(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsGroup
      title="PIN lock"
      description="Ask for a PIN when Wawa opens and after it sits unused. It applies to every computer and browser using this workspace. The Chrome companion and WhatsApp keep working while locked."
      action={
        enabled ? (
          <button className="button secondary" onClick={lockNow}>
            <Lock size={14} /> Lock now
          </button>
        ) : undefined
      }
      note="Forgot the PIN? On the server, run update.sh pin-reset, or node dist/server/lock-cli.js --off in the Wawa container."
    >
      {enabled && (
        <SettingsRow
          title="Current PIN"
          htmlFor="lock-current-pin"
          description="Needed for any change."
        >
          <input
            id="lock-current-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={currentPin}
            onChange={(event) => setCurrentPin(digits(event.target.value))}
          />
        </SettingsRow>
      )}
      <SettingsRow
        title={enabled ? 'New PIN' : 'PIN'}
        htmlFor="lock-pin"
        description={enabled ? 'Leave empty to keep the current PIN.' : '6 to 12 digits.'}
      >
        <input
          id="lock-pin"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          value={pin}
          onChange={(event) => setPin(digits(event.target.value))}
        />
      </SettingsRow>
      {(pin || !enabled) && (
        <SettingsRow title="Confirm PIN" htmlFor="lock-confirm-pin">
          <input
            id="lock-confirm-pin"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            value={confirmPin}
            onChange={(event) => setConfirmPin(digits(event.target.value))}
          />
        </SettingsRow>
      )}
      <SettingsRow
        title="Lock after"
        htmlFor="lock-idle"
        description="Minutes without typing, clicking or scrolling in the window."
      >
        <select
          id="lock-idle"
          value={idleMinutes}
          onChange={(event) => setIdleMinutes(IdleMinutesSchema.parse(Number(event.target.value)))}
        >
          {idleMinuteChoices.map((value) => (
            <option key={value} value={value}>
              {value} minutes
            </option>
          ))}
        </select>
      </SettingsRow>
      <SettingsRow title={enabled ? 'Save changes or turn the lock off' : 'Turn on the PIN lock'}>
        {enabled && (
          <button
            className="text-button danger-text"
            disabled={busy || currentPin.length < 6}
            onClick={() => void run('disable')}
          >
            Turn off
          </button>
        )}
        <button className="button primary" disabled={!canSave} onClick={() => void run('save')}>
          {enabled ? 'Save' : 'Turn on PIN lock'}
        </button>
      </SettingsRow>
    </SettingsGroup>
  );
}
