import { useState } from 'react';
import type { MutationResult } from '../../api/client';
import type { AutomationRule } from '../../api/types';
import type { RulesStatus } from '../../hooks/useRules';
import Loading from '../../components/Loading';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import ConfirmDialog from '../../components/ConfirmDialog';
import RuleListItem from './RuleListItem';

interface RuleListProps {
  status: RulesStatus;
  rules: AutomationRule[];
  pendingIds: Set<number>;
  reload(): void;
  onToggle(id: number): Promise<MutationResult<AutomationRule>>;
  onRemove(id: number): Promise<MutationResult<void>>;
}

/**
 * The per-board rule list (TASK-006 Phase 4). A thin state switch over the
 * `useRules` load status (mirroring `BoardViewPage`), reusing the shared
 * `Loading`/`ErrorState`/`EmptyState`. Owns the delete `ConfirmDialog`'s
 * open/target/pending/error state and tracks per-row toggle failures so a
 * failed optimistic toggle surfaces an inline retry hint on the row.
 */
export default function RuleList({
  status,
  rules,
  pendingIds,
  reload,
  onToggle,
  onRemove,
}: RuleListProps) {
  const [target, setTarget] = useState<AutomationRule | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [toggleErrorIds, setToggleErrorIds] = useState<Set<number>>(new Set());

  async function handleToggle(id: number) {
    setToggleErrorIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    const result = await onToggle(id);
    if (!result.ok) {
      setToggleErrorIds((prev) => new Set(prev).add(id));
    }
  }

  async function handleConfirmDelete() {
    if (!target) return;
    setDeleting(true);
    setDeleteError(null);
    const result = await onRemove(target.id);
    setDeleting(false);
    if (result.ok) {
      setTarget(null);
    } else {
      setDeleteError('Couldn’t delete the rule. Try again.');
    }
  }

  function handleCancelDelete() {
    setTarget(null);
    setDeleteError(null);
  }

  if (status === 'loading') {
    return <Loading label="Loading rules…" />;
  }
  if (status === 'error') {
    return <ErrorState message="Couldn’t load rules." onRetry={reload} />;
  }
  if (rules.length === 0) {
    return <EmptyState message="No rules yet. Create one above to auto-move cards." />;
  }

  return (
    <>
      <ul className="rule-list">
        {rules.map((rule) => (
          <RuleListItem
            key={rule.id}
            rule={rule}
            pending={pendingIds.has(rule.id)}
            toggleFailed={toggleErrorIds.has(rule.id)}
            onToggle={() => handleToggle(rule.id)}
            onDelete={() => {
              setDeleteError(null);
              setTarget(rule);
            }}
          />
        ))}
      </ul>

      {target && (
        <ConfirmDialog
          title="Delete this rule?"
          description={`"${target.name}" will be permanently deleted. This can’t be undone.`}
          confirmLabel="Delete"
          pending={deleting}
          error={deleteError}
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />
      )}
    </>
  );
}
