import type { Notify } from '../../shared/useNotice.js';
import { useState } from 'react';
import {
  ArrowUpRight,
  Check,
  LoaderCircle,
  RefreshCw,
  Server,
  Sparkles,
  Trash2,
  Zap,
  Cloud,
} from 'lucide-react';
import { type Profile } from '../../shared/schema.js';
import { errorMessage } from '../../shared/errors.js';
import { Pill, SettingsRow } from './primitives.js';

function kindLabel(profile: Profile) {
  return profile.kind === 'codex'
    ? 'Codex subscription'
    : profile.kind === 'cloudflare'
      ? 'Cloudflare AI Gateway'
      : profile.kind === 'decision'
        ? profile.provider === 'jev'
          ? 'TypeSafe Jev · decision API'
          : 'OpenAI · Decisions API'
        : 'OpenAI-compatible API';
}

export function ProfileCard({
  profile,
  active,
  onActivate,
  onChange,
  onRemove,
  canRemove,
  credential,
  onTest,
  onModels,
  notify,
}: {
  profile: Profile;
  active: boolean;
  onActivate: () => void;
  onChange: (profile: Profile) => void;
  onRemove: () => void;
  canRemove: boolean;
  credential: (id: string, label: string) => React.ReactNode;
  onTest: () => Promise<void>;
  onModels: () => Promise<string[]>;
  notify: Notify;
}) {
  const [testing, setTesting] = useState(false),
    [models, setModels] = useState<string[]>([]),
    [loading, setLoading] = useState(false);
  const Icon = profile.kind === 'codex' ? Sparkles : profile.kind === 'cloudflare' ? Cloud : Server;
  return (
    <section
      className={`settings-list profile-card ${active ? 'active-profile' : ''}`}
      aria-label={`${profile.name} connection`}
    >
      <div className="settings-row profile-head">
        <span className="profile-icon">
          <Icon size={16} />
        </span>
        <div className="settings-row-text">
          <span className="settings-row-title">
            {profile.name}
            {active && (
              <Pill tone="accent">
                <Check size={11} /> In use
              </Pill>
            )}
            {profile.kind === 'decision' && <Pill>Decision only</Pill>}
          </span>
          <p>
            {kindLabel(profile)} · {profile.model || 'no model yet'}
          </p>
        </div>
        <div className="settings-row-control">
          {profile.kind !== 'decision' && !active && (
            <button className="button secondary" onClick={onActivate}>
              Use connection
            </button>
          )}
          {canRemove && (
            <button
              className="icon-btn danger-text"
              aria-label={`Delete ${profile.name} connection`}
              onClick={onRemove}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
      <SettingsRow title="Connection name" htmlFor={`name-${profile.id}`}>
        <input
          id={`name-${profile.id}`}
          value={profile.name}
          onChange={(e) => onChange({ ...profile, name: e.target.value })}
        />
      </SettingsRow>
      <SettingsRow
        title="Model ID"
        htmlFor={`model-${profile.id}`}
        description={
          profile.kind === 'cloudflare' && profile.route === 'unified'
            ? 'Use author/model, for example openai/gpt-4.1.'
            : 'The exact model ID this connection supports.'
        }
      >
        <input
          id={`model-${profile.id}`}
          value={profile.model}
          list={`models-${profile.id}`}
          placeholder="Enter any model ID"
          onChange={(e) => onChange({ ...profile, model: e.target.value })}
        />
        <datalist id={`models-${profile.id}`}>
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </SettingsRow>
      {(profile.kind === 'compatible' || profile.kind === 'decision') && (
        <>
          <SettingsRow title="API base URL" htmlFor={`url-${profile.id}`}>
            <input
              id={`url-${profile.id}`}
              value={profile.baseUrl}
              placeholder="https://api.example.com/v1"
              onChange={(e) => onChange({ ...profile, baseUrl: e.target.value })}
            />
          </SettingsRow>
          {credential(profile.id + ':key', 'Provider API key')}
        </>
      )}
      {profile.kind === 'cloudflare' && (
        <>
          <SettingsRow title="Cloudflare account ID" htmlFor={`account-${profile.id}`}>
            <input
              id={`account-${profile.id}`}
              value={profile.accountId}
              onChange={(e) => onChange({ ...profile, accountId: e.target.value })}
            />
          </SettingsRow>
          <SettingsRow title="Gateway ID" htmlFor={`gateway-${profile.id}`}>
            <input
              id={`gateway-${profile.id}`}
              value={profile.gatewayId}
              onChange={(e) => onChange({ ...profile, gatewayId: e.target.value })}
            />
          </SettingsRow>
          <SettingsRow
            title="Routing"
            htmlFor={`route-${profile.id}`}
            description={
              profile.route === 'proxy'
                ? 'Wawa → Cloudflare Gateway → OpenAI'
                : 'Wawa → Cloudflare Gateway → your selected model'
            }
          >
            <select
              id={`route-${profile.id}`}
              value={profile.route}
              onChange={(e) =>
                onChange({ ...profile, route: e.target.value === 'proxy' ? 'proxy' : 'unified' })
              }
            >
              <option value="proxy">Proxy · use your OpenAI provider key</option>
              <option value="unified">Cloudflare REST API · unified billing</option>
            </select>
          </SettingsRow>
          {profile.route === 'proxy' && credential(profile.id + ':key', 'OpenAI provider API key')}
          {credential(
            profile.id + ':gateway',
            profile.route === 'proxy'
              ? 'Gateway token (for authenticated gateways)'
              : 'Cloudflare token · Workers AI Read',
          )}
        </>
      )}
      {profile.kind === 'codex' && (
        <SettingsRow
          title="Sign-in"
          description={
            window.chat2tasksDesktop || window.chat2tasksTauri ? (
              'Your Codex sign-in is stored on this computer. No API key is needed.'
            ) : (
              <>
                Sign in to Codex inside the container once. Your session lives in the private{' '}
                <code>codex-home</code> volume. No API key is needed.
              </>
            )
          }
        />
      )}
      <div className="settings-row profile-foot">
        <a
          className="text-button"
          href={
            profile.kind === 'cloudflare'
              ? 'https://developers.cloudflare.com/ai-gateway/usage/rest-api/'
              : profile.kind === 'codex'
                ? 'https://developers.openai.com/codex/cli/'
                : 'https://github.com/liongkj/chat2tasks/blob/main/docs/technical-reference.md#model-connections'
          }
          target="_blank"
          rel="noreferrer"
        >
          Connection guide <ArrowUpRight size={12} />
        </a>
        <div className="settings-row-control">
          {profile.kind === 'compatible' && (
            <button
              className="button secondary"
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                try {
                  setModels(await onModels());
                } catch (e) {
                  notify(errorMessage(e), 'error');
                } finally {
                  setLoading(false);
                }
              }}
            >
              {loading ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}{' '}
              {loading ? 'Loading models…' : 'Load models'}
            </button>
          )}
          <button
            className="button secondary"
            disabled={testing}
            onClick={async () => {
              setTesting(true);
              try {
                await onTest();
              } catch (e) {
                notify(errorMessage(e), 'error');
              } finally {
                setTesting(false);
              }
            }}
          >
            {testing ? <LoaderCircle size={14} className="spin" /> : <Zap size={14} />}{' '}
            {testing ? 'Testing connection…' : 'Test connection'}
          </button>
        </div>
      </div>
    </section>
  );
}
