import type { Notify } from '../../shared/useNotice.js';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { api } from '../api.js';
import { errorMessage } from '../../shared/errors.js';
import { DesktopSharingStatusSchema } from '../../shared/desktop-sharing.js';
import { Pill, SettingsGroup, SettingsRow } from './primitives.js';

export function DesktopSharingSettings({ notify }: { notify: Notify }) {
  const [status, setStatus] = useState<z.infer<typeof DesktopSharingStatusSchema> | null>(null);
  const [origin, setOrigin] = useState('');
  const [port, setPort] = useState(2786);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api('desktop/sharing', DesktopSharingStatusSchema)
      .then((value) => {
        setStatus(value);
        if (value.configured.kind === 'enabled') {
          setOrigin(value.configured.origin);
          setPort(value.configured.port);
        }
      })
      .catch((error) => notify(errorMessage(error)));
  }, [notify]);
  async function save(kind: 'enabled' | 'disabled') {
    setBusy(true);
    try {
      const value = await api(
        'desktop/sharing',
        DesktopSharingStatusSchema,
        kind === 'enabled' ? { kind, origin: origin.trim(), port, password } : { kind },
      );
      setStatus(value);
      setPassword('');
      notify(
        value.restartRequired
          ? 'Saved. Quit and reopen the app to apply sharing.'
          : 'Sharing saved.',
      );
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  const configured = status?.configured;
  const enabled = configured?.kind === 'enabled';
  const httpsPort = configured?.kind === 'enabled' ? new URL(configured.origin).port || '443' : '';
  return (
    <SettingsGroup
      title="Connect other computers"
      description="Share this workspace through a private HTTPS address. This computer must stay awake."
    >
      {status && (
        <>
          <SettingsRow
            title={
              <>
                Sharing <Pill tone={enabled ? 'accent' : 'neutral'}>{enabled ? 'On' : 'Off'}</Pill>
              </>
            }
            description={
              status.restartRequired ? (
                <span role="status">
                  {status.unavailableReason === 'port_in_use'
                    ? 'Sharing is off because the local port is in use. Choose another port, then quit and reopen Wawa.'
                    : 'Quit Wawa from its menu or tray, then reopen it to apply this change.'}
                </span>
              ) : enabled ? (
                'Other computers can open this workspace at the address below.'
              ) : (
                'Fill in the details below, then enable sharing.'
              )
            }
          >
            {enabled && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void save('disabled')}
              >
                Stop sharing
              </button>
            )}
          </SettingsRow>
          <SettingsRow
            title="Private HTTPS address"
            htmlFor="sharing-origin"
            description="From Tailscale Serve or your private HTTPS proxy."
          >
            <input
              id="sharing-origin"
              type="url"
              autoComplete="url"
              placeholder="https://your-server.tailnet.ts.net:8443"
              value={origin}
              onChange={(event) => setOrigin(event.target.value)}
            />
          </SettingsRow>
          <SettingsRow title="Local server port" htmlFor="sharing-port">
            <input
              id="sharing-port"
              type="number"
              min={1024}
              max={65535}
              value={port}
              onChange={(event) => setPort(Number(event.target.value))}
            />
          </SettingsRow>
          <SettingsRow
            title="Workspace password"
            htmlFor="sharing-password"
            description="At least 12 characters. Enter it again when changing sharing."
          >
            <input
              id="sharing-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </SettingsRow>
          {configured?.kind === 'enabled' && (
            <SettingsRow
              title="Private network setup"
              stacked
              description={
                <>
                  Check <code>tailscale serve status</code> first and use a free HTTPS port. Then
                  run this on the server computer. Install Tailscale on each computer and connect
                  them to the same tailnet.
                </>
              }
            >
              <code>{`tailscale serve --bg --https=${httpsPort} http://127.0.0.1:${configured.port}`}</code>
            </SettingsRow>
          )}
          <SettingsRow title={enabled ? 'Apply changes' : 'Turn on sharing'}>
            <button
              className="button primary"
              disabled={
                busy || !origin.trim() || password.length < 12 || port < 1024 || port > 65535
              }
              onClick={() => void save('enabled')}
            >
              {busy ? 'Saving…' : enabled ? 'Update sharing' : 'Enable sharing'}
            </button>
          </SettingsRow>
        </>
      )}
    </SettingsGroup>
  );
}
