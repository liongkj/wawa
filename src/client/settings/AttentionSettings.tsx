import type { Notify } from '../../shared/useNotice.js';
import { useEffect, useState } from 'react';
import { AttentionPreferencesSchema, type AttentionPreferences } from '../../shared/schema.js';
import { api } from '../api.js';
import { errorMessage } from '../../shared/errors.js';
import { AttentionPreferencesEditor } from '../AttentionPreferences.js';
import { SettingsGroup, SettingsRow } from './primitives.js';

export function AttentionSettings({ notify }: { notify: Notify }) {
  const [value, setValue] = useState<AttentionPreferences | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api('preferences', AttentionPreferencesSchema)
      .then(setValue)
      .catch((error) => notify(errorMessage(error), 'error'));
  }, [notify]);
  async function save() {
    if (!value) return;
    setBusy(true);
    try {
      setValue(await api('preferences', AttentionPreferencesSchema, value));
      notify('Attention preferences saved.');
    } catch (error) {
      notify(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <SettingsGroup
      title="What needs attention"
      description="Choose how new conversation evidence is organized."
    >
      {value && <AttentionPreferencesEditor value={value} onChange={setValue} />}
      <SettingsRow title="Existing items and your corrections stay in place.">
        <button className="button secondary" disabled={!value || busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save preferences'}
        </button>
      </SettingsRow>
    </SettingsGroup>
  );
}
