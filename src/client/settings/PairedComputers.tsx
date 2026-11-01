import type { Notify } from '../../shared/useNotice.js';
import { useCallback, useEffect, useState } from 'react';
import { Copy, Link2, LoaderCircle, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { api, OkSchema, time } from '../api.js';
import { errorMessage } from '../../shared/errors.js';
import {
  ComputerCodeSchema,
  ComputersSchema,
  PairingLifetimeSchema,
  pairingLifetimeDays,
  type PairingLifetime,
} from '../../shared/pairing.js';
import { SettingsGroup, SettingsRow } from './primitives.js';

const lifetimeLabel = (days: PairingLifetime) => (days === 365 ? '1 year' : `${days} days`);

export function PairedComputers({ notify }: { notify: Notify }) {
  const [computers, setComputers] = useState<z.infer<typeof ComputersSchema> | null>(null),
    [pairing, setPairing] = useState<z.infer<typeof ComputerCodeSchema> | null>(null),
    [days, setDays] = useState<PairingLifetime>(365),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setComputers(await api('pair/computers', ComputersSchema));
    } catch (error) {
      notify(errorMessage(error), 'error');
    }
  }, [notify]);
  useEffect(() => void refresh(), [refresh]);
  async function createCode() {
    setBusy(true);
    try {
      setPairing(await api('pair/code', ComputerCodeSchema, { days }));
      await refresh();
    } catch (error) {
      notify(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  }
  async function disconnect(id: string) {
    setBusy(true);
    try {
      await api('pair/computers/' + encodeURIComponent(id) + '/disconnect', OkSchema, {});
      await refresh();
      notify('Computer disconnected');
    } catch (error) {
      notify(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <SettingsGroup
      title="Paired computers"
      description="Each computer gets its own connection, so you can disconnect one without changing the workspace password."
      action={
        <button className="button secondary" onClick={() => void refresh()}>
          Refresh paired computers
        </button>
      }
    >
      {computers?.lockedOutAt && (
        <SettingsRow
          title="Pairing code deleted"
          description={`Too many wrong codes were entered, so the last code was deleted ${time(computers.lockedOutAt)}. Create a new code when you are ready to pair.`}
        />
      )}
      <SettingsRow
        title="Stay connected while unused for"
        htmlFor="computer-lifetime"
        description="A computer that goes unused this long must pair again. Regular use keeps it connected."
      >
        <select
          id="computer-lifetime"
          value={days}
          onChange={(event) => setDays(PairingLifetimeSchema.parse(Number(event.target.value)))}
        >
          {pairingLifetimeDays.map((value) => (
            <option key={value} value={value}>
              {lifetimeLabel(value)}
            </option>
          ))}
        </select>
      </SettingsRow>
      <SettingsRow
        title="Pair another computer"
        htmlFor={pairing ? 'computer-code' : undefined}
        description={
          pairing
            ? `Enter this code in the Wawa app on the other computer. It works once and expires ${time(pairing.expiresAt)}. Creating another code replaces it.`
            : 'In the Wawa app on the other computer, choose Use another computer and enter the code.'
        }
      >
        {pairing && (
          <div className="secret-input">
            <input id="computer-code" value={pairing.code} readOnly spellCheck={false} />
            <button
              className="icon-btn"
              aria-label="Copy pairing code"
              onClick={() => {
                void navigator.clipboard
                  .writeText(pairing.code)
                  .then(() => notify('Pairing code copied'))
                  .catch(() => notify('Select the pairing code and copy it manually.', 'error'));
              }}
            >
              <Copy size={15} />
            </button>
          </div>
        )}
        <button className="button secondary" disabled={busy} onClick={() => void createCode()}>
          {busy ? <LoaderCircle className="spin" size={14} /> : <Link2 size={14} />}{' '}
          {pairing ? 'New code' : 'Create pairing code'}
        </button>
      </SettingsRow>
      {computers?.devices.map((device) => (
        <SettingsRow
          key={device.id}
          title={device.name}
          description={
            <>
              Paired {time(device.created)} ·{' '}
              {device.lastUsed ? 'Last used ' + time(device.lastUsed) : 'Not used yet'}
            </>
          }
        >
          <button
            className="text-button danger-text"
            disabled={busy}
            aria-label={`Disconnect ${device.name}`}
            onClick={() => void disconnect(device.id)}
          >
            <Trash2 size={13} /> Disconnect
          </button>
        </SettingsRow>
      ))}
      {computers && !computers.devices.length && <SettingsRow title="No computers paired yet." />}
    </SettingsGroup>
  );
}
