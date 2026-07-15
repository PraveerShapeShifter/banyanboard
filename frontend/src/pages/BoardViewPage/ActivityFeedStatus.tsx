export type ActivityFeedStatusTone = 'reconnecting' | 'degraded';

interface ActivityFeedStatusProps {
  tone: ActivityFeedStatusTone;
}

/**
 * The reconnecting/degraded banner, layered above the still-visible item list
 * (never replacing it). `role="status"` for the gentler, self-healing
 * reconnecting state (implicit polite + atomic — appropriate for a transient
 * condition); `role="alert"` for the degraded/offline state, matching
 * `ErrorState`'s existing convention exactly. Colocated under
 * `pages/BoardViewPage/` rather than `components/` — this is SSE-connection
 * wording with exactly one consumer today.
 */
export default function ActivityFeedStatus({ tone }: ActivityFeedStatusProps) {
  if (tone === 'degraded') {
    return (
      <p className="activity-feed__status activity-feed__status--degraded" role="alert">
        Activity feed offline
      </p>
    );
  }

  return (
    <p className="activity-feed__status activity-feed__status--reconnecting" role="status">
      Reconnecting…
    </p>
  );
}
