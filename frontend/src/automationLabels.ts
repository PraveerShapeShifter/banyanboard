import type { AutomationRule, DeliveryStatus } from './api/types';
import { STATUS_LABELS } from './statusLabels';

/**
 * Shared copy for the Automation tab (TASK-006 Phase 4), mirroring
 * `statusLabels.ts`. Reuses `STATUS_LABELS` so the rule-condition sentence, the
 * form selects, and history rows can never drift from the columns/feed wording.
 * English-only at MVP; isolated here so it is extractable for i18n later.
 */

/**
 * The single phrasing template for one rule, e.g.
 * "When status is In Progress, move to Done." Reuses `STATUS_LABELS` (mirror of
 * `formatActivitySentence`).
 */
export function formatRuleSentence(rule: AutomationRule): string {
  return `When status is ${STATUS_LABELS[rule.condition.value]}, move to ${STATUS_LABELS[rule.target_status]}.`;
}

/** Display labels for the webhook delivery lifecycle (never color-alone). */
export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  pending: 'Pending',
  delivered: 'Delivered',
  failed: 'Failed',
  exhausted: 'Exhausted',
};

/**
 * A short text glyph paired with each delivery status so the badge conveys
 * state by text + icon, never by color alone (WCAG 2.1 AA). Decorative — the
 * label text is the accessible signal; the glyph is `aria-hidden` at the badge.
 */
export const DELIVERY_STATUS_ICONS: Record<DeliveryStatus, string> = {
  pending: '…',
  delivered: '✓',
  failed: '!',
  exhausted: '✕',
};
