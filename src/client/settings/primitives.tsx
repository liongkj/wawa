import type { ReactNode } from 'react';
import { Info } from 'lucide-react';

/** A titled group of settings: small heading, muted description, then a card of rows. */
export function SettingsGroup({
  title,
  description,
  action,
  note,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** Muted footnote rendered under the card. */
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="settings-group">
      <div className="settings-group-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      <div className="settings-list">{children}</div>
      {note && <p className="settings-group-note">{note}</p>}
    </section>
  );
}

/**
 * One row inside a settings card: title and description on the left, control on the right.
 * Pass `htmlFor` to make the title the label of the control, or `stacked` to put the control
 * underneath the text for wide content.
 */
export function SettingsRow({
  title,
  description,
  htmlFor,
  stacked,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  stacked?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={`settings-row ${stacked ? 'stacked' : ''}`}>
      <div className="settings-row-text">
        {htmlFor ? (
          <label htmlFor={htmlFor}>{title}</label>
        ) : (
          <span className="settings-row-title">{title}</span>
        )}
        {description && <p>{description}</p>}
      </div>
      {children && <div className="settings-row-control">{children}</div>}
    </div>
  );
}

/** Small rounded badge, as used next to list items. */
export function Pill({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'accent' | 'warning';
  children: ReactNode;
}) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

/** Coloured dot plus text, for connection status lines. */
export function StatusDot({
  tone,
  children,
}: {
  tone: 'ok' | 'warning' | 'muted';
  children: ReactNode;
}) {
  return (
    <span className={`status-dot status-${tone}`}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}

/** Grey informational callout with an info icon. */
export function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="settings-callout">
      <Info size={16} />
      <div>{children}</div>
    </div>
  );
}
