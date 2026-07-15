import { useActivityStream } from '../../hooks/useActivityStream';
import Loading from '../../components/Loading';
import EmptyState from '../../components/EmptyState';
import ActivityFeedItem from './ActivityFeedItem';
import ActivityFeedStatus from './ActivityFeedStatus';

interface ActivityFeedProps {
  boardId: number | string;
}

/**
 * Board-view region rendering the live realtime activity feed (TASK-005).
 * `<section aria-labelledby>` + `<h2>` mirrors `Column`'s pattern exactly, so
 * heading-navigation screen-reader users find "Activity" the same way they
 * find "To Do"/"In Progress"/"Done" (AC-ENTRY-1). A thin rendering switch
 * over `useActivityStream`'s status, mirroring `BoardViewPage`'s own switch
 * over `useApiResource`.
 *
 * The visible `<ul>` carries no `aria-live` — a sibling visually-hidden
 * element is the ONLY `aria-live="polite"` announcer, decoupled from the
 * list so DOM insertions/reordering never themselves trigger an announcement
 * (see the UI/UX creative's Accessibility Deep-Dive). The list (and
 * announcer) stay rendered through `reconnecting`/`degraded` — nothing is
 * hidden or cleared on a connection drop.
 */
export default function ActivityFeed({ boardId }: ActivityFeedProps) {
  const { status, items, announcement } = useActivityStream(boardId);

  return (
    <section aria-labelledby="activity-feed-heading" className="activity-feed">
      <h2 id="activity-feed-heading">Activity</h2>

      {status === 'reconnecting' && <ActivityFeedStatus tone="reconnecting" />}
      {status === 'degraded' && <ActivityFeedStatus tone="degraded" />}

      {status === 'connecting' ? (
        <Loading label="Loading activity…" />
      ) : (
        <>
          {items.length === 0 && (
            <EmptyState message="No activity yet. Card moves on this board will appear here." />
          )}
          <ul className="activity-feed__list">
            {items.map((item) => (
              <ActivityFeedItem key={item.id} event={item} />
            ))}
          </ul>
          {/*
            The ONLY aria-live element. The inner node is keyed by the
            announcement `seq` so each genuinely-new live event replaces the
            node (a childlist mutation), forcing assistive tech to re-announce
            even when the sentence text is identical to the previous one — e.g.
            a card bouncing to the same column twice (UI/UX creative a11y §5).
          */}
          <div className="visually-hidden" aria-live="polite" aria-atomic="true">
            {announcement && <span key={announcement.seq}>{announcement.text}</span>}
          </div>
        </>
      )}
    </section>
  );
}
