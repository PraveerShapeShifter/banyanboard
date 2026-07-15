import { useState } from 'react';
import type { MutationResult } from '../../api/client';
import type { CreateRuleBody } from '../../api/rules';
import type { AutomationRule, CardStatus } from '../../api/types';
import { STATUS_LABELS } from '../../statusLabels';
import {
  CARD_STATUSES,
  mapServerFieldToControl,
  validateRuleForm,
  type RuleFormErrors,
} from './rulesValidation';

interface RuleFormProps {
  boardId: number;
  onCreate(body: CreateRuleBody): Promise<MutationResult<AutomationRule>>;
  /** Called after a successful create so the parent can announce it. */
  onCreated(rule: AutomationRule): void;
}

const INITIAL_CONDITION: CardStatus = 'todo';
const INITIAL_TARGET: CardStatus = 'in_progress';

/**
 * The rule-creation form (TASK-006 Phase 4). Client validation mirrors the
 * backend field checks (instant inline feedback without a guaranteed-400 round
 * trip) AND server coded `INVALID_RULE.details[].field` still map back onto the
 * matching control (defense in depth). `condition.field`/`operator` are frozen
 * single-value enums, so only the condition VALUE is a control. Never blocks
 * typing; errors show on submit and clear on the next edit of that field.
 */
export default function RuleForm({ boardId, onCreate, onCreated }: RuleFormProps) {
  const [name, setName] = useState('');
  const [conditionValue, setConditionValue] = useState<CardStatus>(INITIAL_CONDITION);
  const [targetStatus, setTargetStatus] = useState<CardStatus>(INITIAL_TARGET);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [enabled, setEnabled] = useState(true);

  const [errors, setErrors] = useState<RuleFormErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function clearFieldError(field: keyof RuleFormErrors) {
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function resetForm() {
    setName('');
    setConditionValue(INITIAL_CONDITION);
    setTargetStatus(INITIAL_TARGET);
    setWebhookUrl('');
    setEnabled(true);
    setErrors({});
  }

  function applyServerErrors(details: { field: string; error: string }[]): boolean {
    const next: RuleFormErrors = {};
    let hadUnmapped = false;
    for (const detail of details) {
      const control = mapServerFieldToControl(detail.field);
      if (control) next[control] = detail.error;
      else hadUnmapped = true;
    }
    setErrors(next);
    return hadUnmapped || Object.keys(next).length === 0;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBanner(null);

    const clientErrors = validateRuleForm({
      name,
      conditionValue,
      target_status: targetStatus,
      webhook_url: webhookUrl,
      enabled,
    });
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      return;
    }
    setErrors({});

    const trimmedWebhook = webhookUrl.trim();
    const body: CreateRuleBody = {
      board_id: boardId,
      name: name.trim(),
      condition: { field: 'status', operator: 'eq', value: conditionValue },
      target_status: targetStatus,
      enabled,
      webhook_url: trimmedWebhook.length > 0 ? trimmedWebhook : null,
    };

    setSubmitting(true);
    const result = await onCreate(body);
    setSubmitting(false);

    if (result.ok) {
      onCreated(result.data);
      resetForm();
      return;
    }
    if (result.kind === 'validation') {
      const showBanner = applyServerErrors(result.error.details ?? []);
      if (showBanner) {
        setBanner(result.error.message || 'Couldn’t create the rule.');
      }
      return;
    }
    // http / network — the form keeps its values; resubmit is the retry.
    setBanner('Couldn’t create the rule. Please try again.');
  }

  return (
    <form className="rule-form" onSubmit={handleSubmit} noValidate>
      {banner && (
        <p className="rule-form__banner" role="alert">
          {banner}
        </p>
      )}

      <div className="rule-form__field">
        <label htmlFor="rule-name">
          Name <span aria-hidden="true">*</span>
          <span className="visually-hidden"> (required)</span>
        </label>
        <input
          id="rule-name"
          type="text"
          value={name}
          maxLength={120}
          onChange={(event) => {
            setName(event.target.value);
            clearFieldError('name');
          }}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? 'rule-name-error' : undefined}
        />
        {errors.name && (
          <p id="rule-name-error" className="rule-form__error">
            {errors.name}
          </p>
        )}
      </div>

      <div className="rule-form__field">
        <label htmlFor="rule-condition">When a card’s status is</label>
        <select
          id="rule-condition"
          value={conditionValue}
          onChange={(event) => {
            setConditionValue(event.target.value as CardStatus);
            clearFieldError('condition');
            clearFieldError('target_status');
          }}
          aria-invalid={errors.condition ? true : undefined}
          aria-describedby={errors.condition ? 'rule-condition-error' : undefined}
        >
          {CARD_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        {errors.condition && (
          <p id="rule-condition-error" className="rule-form__error">
            {errors.condition}
          </p>
        )}
      </div>

      <div className="rule-form__field">
        <label htmlFor="rule-target">move it to</label>
        <select
          id="rule-target"
          value={targetStatus}
          onChange={(event) => {
            setTargetStatus(event.target.value as CardStatus);
            clearFieldError('target_status');
          }}
          aria-invalid={errors.target_status ? true : undefined}
          aria-describedby={errors.target_status ? 'rule-target-error' : undefined}
        >
          {CARD_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        {errors.target_status && (
          <p id="rule-target-error" className="rule-form__error">
            {errors.target_status}
          </p>
        )}
      </div>

      <div className="rule-form__field">
        <label htmlFor="rule-webhook">Webhook URL (optional)</label>
        <input
          id="rule-webhook"
          type="url"
          placeholder="https://…"
          value={webhookUrl}
          onChange={(event) => {
            setWebhookUrl(event.target.value);
            clearFieldError('webhook_url');
          }}
          aria-invalid={errors.webhook_url ? true : undefined}
          aria-describedby={errors.webhook_url ? 'rule-webhook-error' : undefined}
        />
        {errors.webhook_url && (
          <p id="rule-webhook-error" className="rule-form__error">
            {errors.webhook_url}
          </p>
        )}
      </div>

      <div className="rule-form__field rule-form__field--checkbox">
        <label htmlFor="rule-enabled">
          <input
            id="rule-enabled"
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />{' '}
          Enabled
        </label>
      </div>

      <button type="submit" disabled={submitting} aria-busy={submitting}>
        {submitting ? 'Creating…' : 'Create rule'}
      </button>
    </form>
  );
}
