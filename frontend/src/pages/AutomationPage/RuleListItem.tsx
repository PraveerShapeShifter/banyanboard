import type { AutomationRule } from '../../api/types';
import { formatRuleSentence } from '../../automationLabels';

interface RuleListItemProps {
  rule: AutomationRule;
  /** A toggle/delete request is in flight for this row. */
  pending: boolean;
  /** The last toggle for this row failed (show an inline retry hint). */
  toggleFailed: boolean;
  onToggle(): void;
  onDelete(): void;
}

/** Truncate a webhook URL to its host for the badge; full URL in the title/label. */
function webhookHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * One rule row: the condition->target sentence (shared `formatRuleSentence`, so
 * it can never drift from the columns/feed wording), an optional webhook badge,
 * a `role="switch"` enable/disable control whose state is conveyed by TEXT
 * ("Enabled"/"Disabled") not color alone, and a Delete trigger. The switch's
 * pending state is exposed via `aria-busy`.
 */
export default function RuleListItem({
  rule,
  pending,
  toggleFailed,
  onToggle,
  onDelete,
}: RuleListItemProps) {
  const stateText = rule.enabled ? 'Enabled' : 'Disabled';

  return (
    <li className="rule-list__item">
      <div className="rule-list__body">
        <p className="rule-list__name">{rule.name}</p>
        <p className="rule-list__sentence">{formatRuleSentence(rule)}</p>
        {rule.webhook_url && (
          <span
            className="rule-list__webhook"
            title={rule.webhook_url}
            aria-label={`Webhook: ${rule.webhook_url}`}
          >
            Webhook · {webhookHost(rule.webhook_url)}
          </span>
        )}
      </div>

      <div className="rule-list__actions">
        <button
          type="button"
          role="switch"
          aria-checked={rule.enabled}
          aria-busy={pending}
          disabled={pending}
          onClick={onToggle}
          className="rule-list__switch"
        >
          {stateText}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          className="rule-list__delete"
        >
          Delete
        </button>
        {toggleFailed && (
          <span className="rule-list__toggle-error" role="alert">
            Couldn’t update — try again
          </span>
        )}
      </div>
    </li>
  );
}
