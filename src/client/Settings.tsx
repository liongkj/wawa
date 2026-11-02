import type { Notify } from '../shared/useNotice.js';
import { useEffect, useRef, useState } from 'react';

import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  MessageSquare,
  Plus,
  Radio,
  RefreshCw,
  Save,
  ShieldCheck,
  X,
} from 'lucide-react';
import { z } from 'zod';
import {
  PublicSettingsSchema,
  type Chat,
  type PublicSettings,
  type Settings,
  type SoundPreferences,
} from '../shared/schema.js';
import { SoundPreferencesEditor } from '../shared/SoundPreferences.js';
import { api, OkSchema } from './api.js';
import { errorMessage } from '../shared/errors.js';
import { CompanionSettings } from './CompanionSettings.js';

import type { SettingsSection } from './taskLocation.js';
import { openWorkspacePicker } from './tauri.js';
import { DesktopSharingSettings } from './settings/DesktopSharingSettings.js';
import { AttentionSettings } from './settings/AttentionSettings.js';
import { WorkspaceTransfer } from './settings/WorkspaceTransfer.js';
import { AppLockSettings } from './settings/AppLockSettings.js';
import { PairedComputers } from './settings/PairedComputers.js';
import { ProfileCard } from './settings/ProfileCard.js';
import { ChatDialog, type DiscoveredEntry } from './settings/ChatDialog.js';
import { ModelDialog } from './settings/ModelDialog.js';
import { Callout, Pill, SettingsGroup, SettingsRow, StatusDot } from './settings/primitives.js';

type Props = {
  section: SettingsSection;
  config: PublicSettings;
  sound: SoundPreferences;
  onSoundSave: (value: SoundPreferences) => Promise<void>;
  onSave: (config: PublicSettings) => void;
  notify: Notify;
  onImportWorkspace?: () => void;
  /** Reports whether the draft differs from what is saved, so the shell can guard navigation. */
  onDirty?: (dirty: boolean) => void;
};
const WhatsappStatus = z.object({ status: z.string(), qr: z.string().nullable() });
const sectionCopy: Record<SettingsSection, { title: string; description: string }> = {
  conversations: {
    title: 'WhatsApp & chats',
    description: 'Manage your WhatsApp server and choose which conversations to follow.',
  },
  models: { title: 'AI models', description: 'Choose and manage your AI connections.' },
  automation: {
    title: 'Automation',
    description: 'Choose when Wawa reviews new messages.',
  },
  attention: {
    title: 'Attention',
    description: 'Choose what appears in your workspace.',
  },
  workspace: {
    title: 'Workspaces',
    description: 'Choose where work happens or keep an encrypted backup.',
  },
  browser: {
    title: 'Browser companion',
    description: 'Connect the browser extension to this workspace.',
  },
};
export function SettingsPanel({
  section,
  config,
  sound,
  onSoundSave,
  onSave,
  notify,
  onImportWorkspace,
  onDirty,
}: Props) {
  const page = useRef<HTMLDivElement>(null);
  useEffect(() => {
    page.current?.scrollTo({ top: 0 });
  }, [section]);
  const [draft, setDraft] = useState(config.settings),
    [secrets, setSecrets] = useState<Record<string, string>>({}),
    [remove, setRemove] = useState<string[]>([]);
  const [shownSecrets, setShownSecrets] = useState<Set<string>>(() => new Set());
  const [pendingChat, setPendingChat] = useState<{
    id: string;
    action: 'pausing' | 'resuming';
  } | null>(null);
  const [whatsapp, setWhatsapp] = useState<z.infer<typeof WhatsappStatus> | null>(null);
  const [linkingWhatsapp, setLinkingWhatsapp] = useState(false);
  const [saving, setSaving] = useState(false),
    [addingChat, setAddingChat] = useState(false),
    [addingModel, setAddingModel] = useState(false);
  const [discovering, setDiscovering] = useState<'sessions' | 'chats' | null>(null),
    [sessionId, setSessionId] = useState(''),
    [sessions, setSessions] = useState<DiscoveredEntry[]>([]),
    [discovered, setDiscovered] = useState<{ sessionId: string; chats: DiscoveredEntry[] } | null>(
      null,
    ),
    [discoveryError, setDiscoveryError] = useState('');
  async function save(settings: Settings = draft, credentialChanges = secrets, removed = remove) {
    setSaving(true);
    try {
      const next = await api('settings', PublicSettingsSchema, {
        settings,
        secrets: credentialChanges,
        removeSecrets: removed,
      });
      onSave(next);
      setDraft(next.settings);
      setSecrets({});
      setRemove([]);
      notify('Workspace settings saved');
      return true;
    } catch (e) {
      notify(errorMessage(e), 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }
  function credential(id: string, label: string) {
    const exists = config.configuredSecrets.includes(id) && !remove.includes(id);
    const shown = shownSecrets.has(id);
    return (
      <SettingsRow
        title={label}
        htmlFor={'secret-' + id}
        description={
          remove.includes(id) ? (
            <span className="danger-text">Key will be removed when you save.</span>
          ) : exists ? (
            <>
              <ShieldCheck size={11} /> Saved securely · leave blank to keep
            </>
          ) : undefined
        }
      >
        <div className="secret-input">
          <KeyRound size={14} />
          <input
            id={'secret-' + id}
            type={shown ? 'text' : 'password'}
            autoComplete="new-password"
            value={secrets[id] ?? ''}
            placeholder={exists ? '••••••••••••' : 'Paste a key…'}
            onChange={(e) => {
              setSecrets({ ...secrets, [id]: e.target.value });
              setRemove(remove.filter((key) => key !== id));
            }}
          />
          <button
            type="button"
            className="icon-btn"
            aria-label={shown ? `Hide ${label}` : `Show ${label}`}
            aria-pressed={shown}
            onClick={() =>
              setShownSecrets((current) => {
                const next = new Set(current);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
          >
            {shown ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        {exists && (
          <button
            className="text-button danger-text"
            onClick={() => {
              setRemove([...remove, id]);
              setSecrets({ ...secrets, [id]: '' });
            }}
          >
            Remove saved key
          </button>
        )}
      </SettingsRow>
    );
  }
  async function discover(session?: string) {
    setDiscovering(session ? 'chats' : 'sessions');
    setDiscoveryError('');
    try {
      if (!(await save())) return;
      const entries = await api(
        'discover',
        z.array(z.object({ id: z.string(), name: z.string() })),
        session ? { sessionId: session } : {},
      );
      if (session) setDiscovered({ sessionId: session, chats: entries });
      else {
        setSessions(entries);
        setDiscovered(null);
        setSessionId((current) =>
          entries.some((entry) => entry.id === current)
            ? current
            : entries.length === 1
              ? entries[0]!.id
              : '',
        );
      }
      if (!entries.length)
        notify('No conversations found. You can add one by session and chat ID.');
    } catch (e) {
      const message = errorMessage(e);
      setDiscoveryError(message);
      notify(message, 'error');
    } finally {
      setDiscovering(null);
    }
  }
  async function toggle(chat: Chat) {
    const saved = config.settings.chats.find((item) => item.id === chat.id);
    if (!saved) return;
    const next = {
      ...config.settings,
      chats: config.settings.chats.map((c) =>
        c.id === chat.id ? { ...c, enabled: !saved.enabled } : c,
      ),
    };
    setPendingChat({ id: chat.id, action: saved.enabled ? 'pausing' : 'resuming' });
    setSaving(true);
    try {
      const updated = await api('settings', PublicSettingsSchema, {
        settings: next,
        secrets: {},
        removeSecrets: [],
      });
      onSave(updated);
      setDraft((current) => ({
        ...current,
        chats: current.chats.map((item) =>
          item.id === chat.id ? { ...item, enabled: !saved.enabled } : item,
        ),
      }));
      notify(`${chat.name} ${saved.enabled ? 'paused' : 'activated'}.`);
    } catch (error) {
      notify(errorMessage(error), 'error');
    } finally {
      setPendingChat(null);
      setSaving(false);
    }
  }
  const activeCount = draft.chats.filter((c) => c.enabled).length;
  const desktop = Boolean(window.chat2tasksDesktop || window.chat2tasksTauri);
  const gatewayPending =
    desktop &&
    (config.desktopGatewayRestartRequired ||
      draft.desktopGateway.mode !== config.settings.desktopGateway.activeMode ||
      (draft.desktopGateway.mode === 'local' &&
        draft.desktopGateway.engine !== config.settings.desktopGateway.activeEngine) ||
      (config.settings.desktopGateway.activeMode === 'remote' &&
        (draft.desktopGateway.remoteUrl !== config.settings.desktopGateway.remoteUrl ||
          Boolean(secrets['remote-openwa']?.trim()) ||
          remove.includes('remote-openwa'))));
  useEffect(() => {
    if (
      section !== 'conversations' ||
      !desktop ||
      gatewayPending ||
      config.settings.desktopGateway.activeMode !== 'local'
    )
      return;
    const refresh = () =>
      void api('desktop/whatsapp/status', WhatsappStatus)
        .then((next) => {
          setWhatsapp(next);
          if (['ready', 'failed', 'disconnected', 'action_required'].includes(next.status))
            setLinkingWhatsapp(false);
        })
        .catch(() => undefined);
    refresh();
    if (!linkingWhatsapp) return;
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [
    section,
    desktop,
    gatewayPending,
    config.settings.desktopGateway.activeMode,
    linkingWhatsapp,
  ]);
  const savesSettings = ['conversations', 'models', 'automation'].includes(section);
  const hasChanges =
    JSON.stringify(draft) !== JSON.stringify(config.settings) ||
    Object.values(secrets).some((value) => value.trim().length > 0) ||
    remove.length > 0;
  useEffect(() => {
    onDirty?.(hasChanges);
    if (!hasChanges) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      onDirty?.(false);
    };
  }, [hasChanges, onDirty]);
  const whatsappTone =
    whatsapp?.status === 'ready'
      ? 'ok'
      : whatsapp && ['failed', 'disconnected', 'action_required'].includes(whatsapp.status)
        ? 'warning'
        : 'muted';
  const whatsappText =
    whatsapp?.status === 'ready'
      ? 'Connected'
      : whatsappTone === 'warning'
        ? 'Not connected · try linking again'
        : linkingWhatsapp || whatsapp?.qr
          ? 'Waiting for your phone'
          : 'Not linked yet';
  const localServer = desktop && config.settings.desktopGateway.activeMode === 'local';
  return (
    <div className="settings-page" ref={page}>
      <div className="settings-page-heading">
        <div>
          <h1>{sectionCopy[section].title}</h1>
          <p className="page-description">{sectionCopy[section].description}</p>
        </div>
        {section === 'models' && (
          <button className="button secondary" onClick={() => setAddingModel(true)}>
            <Plus size={14} /> Add connection
          </button>
        )}
        {savesSettings && (
          <button
            className="button primary"
            onClick={() => void save()}
            disabled={saving || !hasChanges}
          >
            {saving ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}{' '}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        )}
      </div>
      {!savesSettings && hasChanges && (
        <p className="settings-unsaved" role="status">
          You have unsaved changes in other settings.
        </p>
      )}
      {section === 'conversations' && (
        <>
          <SettingsGroup
            title="Server"
            description={
              desktop
                ? 'Where your WhatsApp connection runs. Wawa never sends a reply to WhatsApp.'
                : 'Your WhatsApp session, connected to your own OpenWA server.'
            }
            note={
              desktop ? (
                <>
                  Your tasks stay here. Each connection keeps its own WhatsApp session and followed
                  chats; switching does not move or sign out a session. Unofficial connections can
                  lead to account restrictions.
                  {draft.desktopGateway.mode === 'remote' &&
                    ' This workspace still pauses when this computer sleeps. To keep processing, switch to an always-on workspace under Workspaces.'}
                </>
              ) : (
                'Keys stay on your server and are never sent back to this browser.'
              )
            }
          >
            {desktop ? (
              <>
                <SettingsRow
                  title="Runs on"
                  htmlFor="gateway-mode"
                  description={
                    draft.desktopGateway.mode === 'local'
                      ? 'Wawa runs its own WhatsApp server on this computer.'
                      : 'Use an existing OpenWA server, such as Legion.'
                  }
                >
                  <select
                    id="gateway-mode"
                    value={draft.desktopGateway.mode}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        desktopGateway: {
                          ...draft.desktopGateway,
                          mode: e.target.value === 'remote' ? 'remote' : 'local',
                        },
                      })
                    }
                  >
                    <option value="local">This computer</option>
                    <option value="remote">Another server</option>
                  </select>
                </SettingsRow>
                {draft.desktopGateway.mode === 'local' && (
                  <SettingsRow
                    title="Connection type"
                    htmlFor="gateway-engine"
                    description={
                      draft.desktopGateway.engine === 'baileys'
                        ? 'No browser; tested offline only. Account restriction risk may be higher.'
                        : 'Uses a browser in the background.'
                    }
                  >
                    <select
                      id="gateway-engine"
                      value={draft.desktopGateway.engine}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          desktopGateway: {
                            ...draft.desktopGateway,
                            engine: e.target.value === 'baileys' ? 'baileys' : 'whatsapp-web.js',
                          },
                        })
                      }
                    >
                      <option value="whatsapp-web.js">Standard</option>
                      <option value="baileys">Lightweight · experimental</option>
                    </select>
                  </SettingsRow>
                )}
                {draft.desktopGateway.mode === 'remote' && (
                  <>
                    <SettingsRow
                      title="Server address"
                      htmlFor="remote-openwa-url"
                      description="The OpenWA address reachable from this computer."
                    >
                      <input
                        id="remote-openwa-url"
                        placeholder="https://your-server.example"
                        value={draft.desktopGateway.remoteUrl}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            desktopGateway: { ...draft.desktopGateway, remoteUrl: e.target.value },
                          })
                        }
                      />
                    </SettingsRow>
                    {credential('remote-openwa', 'Server API key')}
                  </>
                )}
                {gatewayPending && (
                  <div className="settings-row">
                    <p className="gateway-restart" role="status">
                      {config.desktopGatewayRestartRequired && !hasChanges
                        ? 'Restart Wawa to use the saved connection.'
                        : 'Save your changes, then restart Wawa to use this connection.'}
                      {config.desktopGatewayRestartRequired &&
                        !hasChanges &&
                        window.chat2tasksDesktop && (
                          <button
                            className="text-button"
                            onClick={() => void window.chat2tasksDesktop?.restart()}
                          >
                            Restart Wawa
                          </button>
                        )}
                    </p>
                  </div>
                )}
                {localServer && !gatewayPending && (
                  <SettingsRow
                    title="WhatsApp"
                    description={<StatusDot tone={whatsappTone}>{whatsappText}</StatusDot>}
                  >
                    {whatsapp?.status !== 'ready' && (
                      <button
                        className="button secondary"
                        disabled={linkingWhatsapp}
                        onClick={() => {
                          setLinkingWhatsapp(true);
                          void api('desktop/whatsapp/start', z.object({ status: z.string() }), {})
                            .then(() => api('desktop/whatsapp/status', WhatsappStatus))
                            .then(setWhatsapp)
                            .catch((error) => {
                              setLinkingWhatsapp(false);
                              notify(errorMessage(error));
                            });
                        }}
                      >
                        {linkingWhatsapp ? 'Preparing connection…' : 'Link WhatsApp'}
                      </button>
                    )}
                  </SettingsRow>
                )}
                {desktop && !gatewayPending && whatsapp?.qr && (
                  <div className="settings-row stacked">
                    <div className="onboarding-qr">
                      <img src={whatsapp.qr} alt="WhatsApp pairing QR code" />
                      <p>
                        On your phone, open WhatsApp → Linked devices → Link a device, then scan
                        this code.
                      </p>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <SettingsRow
                  title="OpenWA API URL"
                  htmlFor="openwa-url"
                  description="The address reachable from this Docker container."
                >
                  <input
                    id="openwa-url"
                    placeholder="http://openwa-api:2785"
                    value={draft.openwaUrl}
                    onChange={(e) => setDraft({ ...draft, openwaUrl: e.target.value })}
                  />
                </SettingsRow>
                {credential('openwa', 'OpenWA API key')}
              </>
            )}
            <SettingsRow
              title="Sessions"
              description={
                sessions.length
                  ? `${sessions.length} session${sessions.length === 1 ? '' : 's'} found on this server.`
                  : 'Look up the WhatsApp sessions this server knows about.'
              }
            >
              <button
                className="button secondary"
                disabled={Boolean(discovering) || !draft.openwaUrl || gatewayPending}
                onClick={() => void discover()}
              >
                {discovering === 'sessions' ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <RefreshCw size={14} />
                )}{' '}
                {discovering === 'sessions' ? 'Finding sessions…' : 'Find sessions'}
              </button>
            </SettingsRow>
          </SettingsGroup>
          <SettingsGroup
            title="Followed conversations"
            description={
              gatewayPending
                ? 'These are the chats for your currently connected server.'
                : `${activeCount} of ${draft.chats.length} active. Only active chats are sent to your selected AI connection.`
            }
            action={
              <button
                className="button secondary"
                disabled={gatewayPending}
                onClick={() => setAddingChat(true)}
              >
                <Plus size={14} /> Add chat
              </button>
            }
          >
            {sessions.length > 0 && (
              <SettingsRow
                title="Browse a session"
                htmlFor="discover-session"
                description="Pick a WhatsApp session, then list its chats."
              >
                <select
                  id="discover-session"
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                >
                  <option value="">Choose a session…</option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button
                  className="button secondary"
                  disabled={!sessionId || Boolean(discovering)}
                  onClick={() => void discover(sessionId)}
                >
                  {discovering === 'chats' ? 'Finding chats…' : 'Find chats'}
                </button>
              </SettingsRow>
            )}
            {discovered?.sessionId === sessionId &&
              discovered.chats.map((c) => {
                const added = draft.chats.some(
                  (chat) => chat.chatId === c.id && chat.sessionId === sessionId,
                );
                return (
                  <div className="settings-row discovered-row" key={c.id}>
                    <MessageSquare size={15} />
                    <div className="settings-row-text">
                      <span className="settings-row-title">{c.name}</span>
                      <p>{c.id}</p>
                    </div>
                    <div className="settings-row-control">
                      {added ? (
                        <Pill>Added</Pill>
                      ) : (
                        <button
                          className="text-button"
                          onClick={() => {
                            setDraft({
                              ...draft,
                              chats: [
                                ...draft.chats,
                                {
                                  id: crypto.randomUUID(),
                                  name: c.name,
                                  sessionId,
                                  chatId: c.id,
                                  enabled: false,
                                },
                              ],
                            });
                            notify(
                              'Chat added as paused. Save changes, then activate it when ready.',
                            );
                          }}
                        >
                          Add paused <Plus size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            {draft.chats.length ? (
              draft.chats.map((c) => (
                <div className="settings-row chat-activator" key={c.id}>
                  <span className="conversation-avatar">{c.name.slice(0, 1)}</span>
                  <div className="settings-row-text activator-info">
                    <input
                      className="activator-name"
                      aria-label={`Conversation name: ${c.name}`}
                      value={c.name}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          chats: draft.chats.map((chat) =>
                            chat.id === c.id ? { ...chat, name: e.target.value } : chat,
                          ),
                        })
                      }
                    />
                    <p aria-live="polite">
                      {pendingChat?.id === c.id
                        ? pendingChat.action === 'pausing'
                          ? 'Pausing…'
                          : 'Resuming…'
                        : c.enabled
                          ? 'Following this conversation'
                          : 'Paused · saved tasks remain available'}
                      <span className="chat-id"> · {c.chatId}</span>
                    </p>
                  </div>
                  <Pill tone={c.enabled ? 'accent' : 'neutral'}>
                    {c.enabled ? 'Active' : 'Paused'}
                  </Pill>
                  <button
                    className={`toggle ${c.enabled ? 'on' : ''}`}
                    role="switch"
                    aria-busy={pendingChat?.id === c.id}
                    aria-checked={c.enabled}
                    aria-label={`Activate ${c.name}`}
                    disabled={saving || !config.settings.chats.some((chat) => chat.id === c.id)}
                    onClick={() => void toggle(c)}
                  >
                    <span />
                  </button>
                  <button
                    className="icon-btn danger-text"
                    aria-label={`Remove ${c.name} from followed chats`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        chats: draft.chats.filter((chat) => chat.id !== c.id),
                      })
                    }
                  >
                    <X size={15} />
                  </button>
                </div>
              ))
            ) : (
              <SettingsRow
                title="No conversations yet"
                description="Add a conversation you want to follow. You control what’s active."
              >
                <button className="button secondary" onClick={() => setAddingChat(true)}>
                  <Plus size={14} /> Add a conversation
                </button>
              </SettingsRow>
            )}
          </SettingsGroup>
          {!desktop && (
            <SettingsGroup
              title="Live message delivery"
              description="OpenWA sends signed events when a message arrives, changes, or is sent."
            >
              <SettingsRow
                title="Webhook callback URL"
                htmlFor="webhook-url"
                description="The address reachable from OpenWA. Private hosts must be allowed in OpenWA’s SSRF host allowlist."
              >
                <input
                  id="webhook-url"
                  value={draft.webhookUrl}
                  placeholder="http://chat2tasks:2786/api/webhooks/openwa"
                  onChange={(e) => setDraft({ ...draft, webhookUrl: e.target.value })}
                />
              </SettingsRow>
              <SettingsRow
                title={
                  <>
                    Webhooks{' '}
                    <Pill tone={config.webhook.registeredSessions ? 'accent' : 'neutral'}>
                      {config.webhook.registeredSessions ? 'Registered' : 'Not connected'}
                    </Pill>
                  </>
                }
                description={
                  config.webhook.lastReceivedAt
                    ? 'Last signed event: ' +
                      new Date(config.webhook.lastReceivedAt * 1000).toLocaleString()
                    : 'No signed event received yet.'
                }
              >
                <button
                  className="button secondary"
                  disabled={saving || !draft.webhookUrl || !draft.chats.length}
                  onClick={async () => {
                    if (!(await save())) return;
                    setSaving(true);
                    try {
                      const next = await api('webhooks/connect', PublicSettingsSchema, {});
                      onSave(next);
                      notify('Webhooks connected. OpenWA delivered a signed test successfully.');
                    } catch (e) {
                      notify(errorMessage(e), 'error');
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  <Radio size={14} /> Connect & test webhooks
                </button>
              </SettingsRow>
            </SettingsGroup>
          )}
          <Callout>
            Pausing a chat stops new AI processing. Existing tasks, ticks, notes, and cached
            messages stay available. Wawa never sends a reply to WhatsApp.
          </Callout>
          <ChatDialog
            open={addingChat}
            onClose={() => {
              setAddingChat(false);
              setDiscoveryError('');
            }}
            sessions={sessions}
            sessionId={sessionId}
            onSessionChange={setSessionId}
            discovered={discovered?.sessionId === sessionId ? discovered.chats : null}
            discovering={discovering}
            discoveryError={discoveryError}
            canDiscover={Boolean(draft.openwaUrl) && !gatewayPending}
            onDiscoverSessions={() => discover()}
            onDiscoverChats={() => discover(sessionId)}
            existingChats={draft.chats}
            onAdd={async (chat) => {
              const next = { ...draft, chats: [...draft.chats, chat] };
              if (await save(next)) setAddingChat(false);
            }}
          />
        </>
      )}
      {section === 'models' && (
        <>
          <section className="settings-group">
            <div className="settings-group-heading">
              <div>
                <h2>Connections</h2>
                <p>
                  Codex, an OpenAI-compatible API, or a Cloudflare AI Gateway. Conversations go only
                  to the connection in use.
                </p>
              </div>
            </div>
            {draft.profiles.map((profile) => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                active={draft.activeProfileId === profile.id}
                onActivate={() => {
                  if (profile.kind !== 'decision')
                    setDraft({ ...draft, activeProfileId: profile.id });
                }}
                onChange={(updated) =>
                  setDraft({
                    ...draft,
                    profiles: draft.profiles.map((p) => (p.id === updated.id ? updated : p)),
                  })
                }
                onRemove={() => {
                  if (draft.profiles.length === 1) return;
                  const profiles = draft.profiles.filter((p) => p.id !== profile.id);
                  const first = profiles.find((p) => p.kind !== 'decision');
                  if (first)
                    setDraft({
                      ...draft,
                      profiles,
                      trigger:
                        draft.trigger.decisionProfileId === profile.id
                          ? { ...draft.trigger, decisionProfileId: null }
                          : draft.trigger,
                      activeProfileId:
                        draft.activeProfileId === profile.id ? first.id : draft.activeProfileId,
                    });
                }}
                canRemove={
                  profile.kind === 'decision' ||
                  draft.profiles.filter((p) => p.kind !== 'decision').length > 1
                }
                credential={credential}
                onTest={async () => {
                  if (await save()) {
                    await api('test-model', OkSchema, { profileId: profile.id });
                    notify('Connection works. This test used one small AI request.');
                  }
                }}
                onModels={async () => {
                  if (!(await save())) return [];
                  const result = await api(
                    'models',
                    z.object({ models: z.array(z.string()), error: z.string().optional() }),
                    { profileId: profile.id },
                  );
                  if (result.error) notify(result.error, 'error');
                  return result.models;
                }}
                notify={notify}
              />
            ))}
          </section>
          <Callout>
            {window.chat2tasksDesktop || window.chat2tasksTauri
              ? 'API keys are encrypted on this computer and are not shown after saving. Use Workspaces to create an encrypted backup.'
              : 'API keys are encrypted on your server and never sent back to this browser. Keep the data volume and its vault key backed up together.'}
          </Callout>
          <ModelDialog
            open={addingModel}
            onClose={() => setAddingModel(false)}
            onAdd={(profile) => {
              setDraft({ ...draft, profiles: [...draft.profiles, profile] });
              setAddingModel(false);
              notify('Connection added. Enter its details and save changes.');
            }}
          />
        </>
      )}
      {section === 'automation' && (
        <SettingsGroup
          title="Task analysis"
          description="Wait for a quiet moment before turning a burst of messages into tasks."
        >
          <SettingsRow title="When to run" htmlFor="trigger-mode">
            <select
              id="trigger-mode"
              value={draft.trigger.mode}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  trigger:
                    e.target.value === 'manual'
                      ? {
                          mode: 'manual',
                          decisionProfileId: draft.trigger.decisionProfileId ?? null,
                        }
                      : {
                          mode: 'automatic',
                          decisionProfileId: draft.trigger.decisionProfileId ?? null,
                        },
                })
              }
            >
              <option value="automatic">Automatically · debounce, then decide</option>
              <option value="manual">Only when I choose Run now</option>
            </select>
          </SettingsRow>
          <SettingsRow
            title="Decision connection"
            htmlFor="decision-connection"
            description="Reviews item categories and proposed completions. In automatic mode it also decides when to run. Uncertain results keep work visible or ask for confirmation."
          >
            <select
              id="decision-connection"
              value={draft.trigger.decisionProfileId ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  trigger: { ...draft.trigger, decisionProfileId: e.target.value || null },
                })
              }
            >
              <option value="">Use the task model for reviews</option>
              {draft.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.model}
                </option>
              ))}
            </select>
          </SettingsRow>
          <SettingsRow title="Wait for a quiet period of" htmlFor="quiet">
            <select
              id="quiet"
              value={draft.quietSeconds}
              onChange={(e) => setDraft({ ...draft, quietSeconds: Number(e.target.value) })}
            >
              {[0, 15, 30, 45, 60, 120].map((v) => (
                <option key={v} value={v}>
                  {v ? `${v} seconds` : 'Process immediately'}
                </option>
              ))}
            </select>
          </SettingsRow>
          <SettingsRow
            title="Message delivery"
            description={
              desktop
                ? 'New messages trigger work as they arrive.'
                : 'OpenWA webhooks trigger work as messages arrive; no periodic message polling.'
            }
          />
        </SettingsGroup>
      )}
      <div hidden={section !== 'browser'}>
        <CompanionSettings notify={notify} />
      </div>
      <div hidden={section !== 'attention'}>
        <AttentionSettings notify={notify} />
        <SettingsGroup
          title="Sounds"
          description="Choose sounds for this workspace and its paired browser companion."
        >
          <SoundPreferencesEditor value={sound} onSave={onSoundSave} />
        </SettingsGroup>
      </div>
      <div hidden={section !== 'workspace'}>
        {window.chat2tasksTauri && (
          <SettingsGroup title="Where work happens">
            <SettingsRow
              title="This computer"
              description="This workspace runs here. Connect to an always-on server to keep processing while it sleeps."
            >
              <button
                className="button secondary"
                onClick={() =>
                  void openWorkspacePicker().catch((error) => notify(errorMessage(error), 'error'))
                }
              >
                Switch workspace
              </button>
            </SettingsRow>
          </SettingsGroup>
        )}
        {window.chat2tasksTauri && !window.chat2tasksTauri.demo && (
          <DesktopSharingSettings notify={notify} />
        )}
        {!window.chat2tasksTauri && <PairedComputers notify={notify} />}
        {!window.chat2tasksTauri?.demo && <AppLockSettings notify={notify} />}
        <WorkspaceTransfer notify={notify} onImport={onImportWorkspace} />
      </div>
      {savesSettings && (
        <div className="settings-save-bottom">
          <button
            className="button primary"
            disabled={saving || !hasChanges}
            onClick={() => void save()}
          >
            <Check size={14} />
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <span>{hasChanges ? 'You have unsaved changes.' : 'All changes saved.'}</span>
        </div>
      )}
    </div>
  );
}
