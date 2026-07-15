import { useRef, useState } from 'react';
import { useRules } from '../../hooks/useRules';
import RuleForm from './RuleForm';
import RuleList from './RuleList';
import HistoryView from './HistoryView';

type TabId = 'rules' | 'history';

const TABS: { id: TabId; label: string }[] = [
  { id: 'rules', label: 'Rules' },
  { id: 'history', label: 'History' },
];

/**
 * In-page Rules / History switch (TASK-006 Phase 4), a true ARIA `tablist`
 * (in-page view switch, NOT a navigation — contrast the BoardHeader
 * Board/Automation nav). Owns the mutable rule state (`useRules`) so the form
 * and list share one source of truth, plus the decoupled visually-hidden
 * `aria-live` announcer (verbatim `ActivityFeed` pattern, keyed by `seq`) for
 * create/update/delete feedback. Rules is the default tab; arrow keys move
 * between tabs (roving tabindex).
 */
export default function AutomationTabs({ boardId }: { boardId: number }) {
  const [active, setActive] = useState<TabId>('rules');
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
    rules: null,
    history: null,
  });

  const { status, rules, pendingIds, reload, create, toggle, remove } = useRules(boardId);

  const [announcement, setAnnouncement] = useState<{ seq: number; text: string } | null>(null);
  const seqRef = useRef(0);
  function announce(text: string) {
    seqRef.current += 1;
    setAnnouncement({ seq: seqRef.current, text });
  }

  function onTabKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (index + delta + TABS.length) % TABS.length;
    const nextTab = TABS[nextIndex];
    setActive(nextTab.id);
    tabRefs.current[nextTab.id]?.focus();
  }

  return (
    <div className="automation-tabs">
      <div role="tablist" aria-label="Automation views" className="automation-tabs__list">
        {TABS.map((tab, index) => (
          <button
            key={tab.id}
            ref={(node) => {
              tabRefs.current[tab.id] = node;
            }}
            role="tab"
            id={`automation-tab-${tab.id}`}
            aria-selected={active === tab.id}
            aria-controls={`automation-panel-${tab.id}`}
            tabIndex={active === tab.id ? 0 : -1}
            className="automation-tabs__tab"
            onClick={() => setActive(tab.id)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {active === 'rules' && (
        <section
          role="tabpanel"
          id="automation-panel-rules"
          aria-labelledby="automation-tab-rules"
          className="automation-tabs__panel"
        >
          <h2>Rules</h2>
          <RuleForm
            boardId={boardId}
            onCreate={create}
            onCreated={(rule) => announce(`Rule "${rule.name}" created`)}
          />
          <RuleList
            status={status}
            rules={rules}
            pendingIds={pendingIds}
            reload={reload}
            onToggle={async (id) => {
              const result = await toggle(id);
              if (result.ok) {
                announce(`Rule ${result.data.enabled ? 'enabled' : 'disabled'}`);
              }
              return result;
            }}
            onRemove={async (id) => {
              const result = await remove(id);
              if (result.ok) announce('Rule deleted');
              return result;
            }}
          />
        </section>
      )}

      {active === 'history' && (
        <section
          role="tabpanel"
          id="automation-panel-history"
          aria-labelledby="automation-tab-history"
          className="automation-tabs__panel"
        >
          <h2>History</h2>
          <HistoryView boardId={boardId} />
        </section>
      )}

      {/*
        The ONLY aria-live element (decoupled announcer, ActivityFeed pattern):
        keyed by `seq` so an identical repeated message still re-announces.
      */}
      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement && <span key={announcement.seq}>{announcement.text}</span>}
      </div>
    </div>
  );
}
