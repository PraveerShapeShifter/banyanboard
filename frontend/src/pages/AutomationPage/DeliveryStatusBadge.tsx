import type { DeliveryStatus } from '../../api/types';
import { DELIVERY_STATUS_ICONS, DELIVERY_STATUS_LABELS } from '../../automationLabels';

/**
 * Renders a webhook delivery's lifecycle status (`pending | delivered | failed
 * | exhausted`) as TEXT + icon + color — never color alone (WCAG 2.1 AA). The
 * visible label text ("Failed", "Delivered", …) is the accessible signal; the
 * glyph is decorative (`aria-hidden`) and the color is carried on a modifier
 * class, so the badge reads correctly to a screen reader and in monochrome.
 */
export default function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  return (
    <span className={`delivery-badge delivery-badge--${status}`}>
      <span aria-hidden="true" className="delivery-badge__icon">
        {DELIVERY_STATUS_ICONS[status]}
      </span>{' '}
      {DELIVERY_STATUS_LABELS[status]}
    </span>
  );
}
