import type { Notify } from '../../shared/useNotice.js';
import { useState } from 'react';
import { appFetch } from '../api.js';
import { errorMessage } from '../../shared/errors.js';
import { SettingsGroup, SettingsRow } from './primitives.js';

export function WorkspaceTransfer({ notify, onImport }: { notify: Notify; onImport?: () => void }) {
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const mismatch = confirmation.length > 0 && confirmation !== passphrase;
  async function downloadTransfer() {
    setBusy(true);
    try {
      const response = await appFetch('/api/workspace/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      });
      if (!response.ok) throw new Error('Could not create the workspace transfer.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'chat2tasks-workspace.c2t';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setPassphrase('');
      setConfirmation('');
      notify('Encrypted workspace transfer downloaded.');
    } catch (error) {
      notify(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <SettingsGroup
      title="Move your workspace"
      description="Save tasks, notes, conversations, cached images and saved model keys in an encrypted file. This does not move your WhatsApp server or its linked session."
    >
      <SettingsRow
        title="Create a passphrase"
        htmlFor="transfer-passphrase"
        description="At least eight characters. You will need it on your new computer."
      >
        <input
          id="transfer-passphrase"
          type="password"
          autoComplete="new-password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
        />
      </SettingsRow>
      <SettingsRow
        title="Repeat the passphrase"
        htmlFor="transfer-passphrase-confirm"
        description={
          mismatch ? (
            <span id="transfer-passphrase-mismatch" role="alert" className="field-error">
              The passphrases do not match.
            </span>
          ) : undefined
        }
      >
        <input
          id="transfer-passphrase-confirm"
          type="password"
          autoComplete="new-password"
          value={confirmation}
          aria-invalid={mismatch || undefined}
          aria-describedby={mismatch ? 'transfer-passphrase-mismatch' : undefined}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </SettingsRow>
      <SettingsRow title="Download" description="Your transfer file is encrypted.">
        <button
          className="button secondary"
          disabled={busy || passphrase.length < 8 || confirmation !== passphrase}
          onClick={() => void downloadTransfer()}
        >
          {busy ? 'Preparing…' : 'Download transfer'}
        </button>
      </SettingsRow>
      {onImport && (
        <SettingsRow
          title="Bring an existing workspace to this computer"
          description="Choose an encrypted transfer from your other workspace."
        >
          <button className="button secondary" onClick={onImport}>
            Import workspace
          </button>
        </SettingsRow>
      )}
    </SettingsGroup>
  );
}
