import type { Notify } from '../shared/useNotice.js';
import { useEffect, useState } from 'react';
import { Copy, Download, Link2, LoaderCircle, Trash2 } from 'lucide-react';
import { SettingsGroup, SettingsRow } from './settings/primitives.js';
import { z } from 'zod';
import { DevicesSchema, PairCodeSchema } from '../shared/companion.js';
import { api, appFetch, OkSchema, time } from './api.js';
import { errorMessage } from '../shared/errors.js';

export function CompanionSettings({ notify }: { notify: Notify }) {
  const [devices, setDevices] = useState<z.infer<typeof DevicesSchema>['devices']>([]);
  const [pairing, setPairing] = useState<z.infer<typeof PairCodeSchema> | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void api('extensions', DevicesSchema)
      .then((result) => setDevices(result.devices))
      .catch((error) => notify(errorMessage(error), 'error'));
  }, [notify]);
  async function createCode() {
    setBusy(true);
    try {
      setPairing(await api('extensions/pairing', PairCodeSchema, {}));
    } catch (error) {
      notify(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    try {
      setDevices((await api('extensions', DevicesSchema)).devices);
    } catch (error) {
      notify(errorMessage(error), 'error');
    }
  }
  async function downloadExtension() {
    try {
      const response = await appFetch('/downloads/chat2tasks-chrome.zip');
      if (!response.ok) throw new Error('Could not download the extension.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'chat2tasks-chrome.zip';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      notify(errorMessage(error), 'error');
    }
  }
  const address = window.chat2tasksTauri?.origin ?? window.location.origin;
  return (
    <div id="chrome-companion">
      <SettingsGroup
        title="Chrome companion"
        description="Quiet TODO links and topic threads in WhatsApp Web. Pair a browser with this workspace."
        note="Updating an existing installation? Replace the files in its current extension folder, reload the extension, and refresh WhatsApp Web. Keeping the folder preserves its pairing."
      >
        <SettingsRow
          title="1. Install the extension"
          description={
            <>
              Unzip it. Open <strong>chrome://extensions</strong>, enable Developer mode, choose{' '}
              <strong>Load unpacked</strong>, and select the unzipped folder. For Edge, use{' '}
              <strong>edge://extensions</strong>.
            </>
          }
        >
          {window.chat2tasksTauri ? (
            <button className="button secondary" onClick={() => void downloadExtension()}>
              <Download size={14} /> Download Chrome extension
            </button>
          ) : (
            <a className="button secondary" href="/downloads/chat2tasks-chrome.zip" download>
              <Download size={14} /> Download Chrome extension
            </a>
          )}
        </SettingsRow>
        <SettingsRow
          title="2. Workspace address"
          htmlFor="companion-address"
          description="Pin Wawa in Chrome, open its side panel and enter this address. Allow access to WhatsApp Web, then refresh that tab to see Chats and Threads."
        >
          <div className="secret-input">
            <input id="companion-address" value={address} readOnly spellCheck={false} />
            <button
              className="icon-btn"
              aria-label="Copy workspace address"
              onClick={() => {
                void navigator.clipboard
                  .writeText(address)
                  .then(() => notify('Workspace address copied'))
                  .catch(() => notify('Select the address and copy it manually.'));
              }}
            >
              <Copy size={15} />
            </button>
          </div>
        </SettingsRow>
        <SettingsRow
          title="3. Pairing code"
          htmlFor={pairing ? 'companion-code' : undefined}
          description={
            pairing
              ? `Expires ${time(pairing.expiresAt)}. Creating another code replaces this one.`
              : 'Paste a one-time code into the side panel to pair that browser.'
          }
        >
          {pairing && (
            <div className="secret-input">
              <input id="companion-code" value={pairing.code} readOnly spellCheck={false} />
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
            {busy ? 'Creating pairing code…' : pairing ? 'New code' : 'Create pairing code'}
          </button>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup
        title="Paired browsers"
        description="Each browser gets a revocable connection, valid for 90 days. Model API keys stay on this server. The extension saves only text you review and submit."
        action={
          <button className="button secondary" onClick={() => void refresh()}>
            Refresh paired browsers
          </button>
        }
      >
        {devices.map((device) => (
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
              aria-label={`Revoke ${device.name}`}
              onClick={() => {
                setBusy(true);
                void api('extensions/' + encodeURIComponent(device.id) + '/revoke', OkSchema, {})
                  .then(async () => {
                    await refresh();
                    notify('Browser access revoked');
                  })
                  .catch((error) => notify(errorMessage(error), 'error'))
                  .finally(() => setBusy(false));
              }}
            >
              <Trash2 size={13} /> Revoke
            </button>
          </SettingsRow>
        ))}
        {!devices.length && <SettingsRow title="No browsers paired yet." />}
      </SettingsGroup>
    </div>
  );
}
