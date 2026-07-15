---
name: "Learned: Connection Lifecycle"
globs: ["src/**/*.routes.ts", "src/**/*stream*.ts"]
topics: ["connection-lifecycle", "sse", "streaming", "async"]
priority: low
evidence_count: 1
last_updated: 2026-07-15
auto_generated: true
---

# Connection Lifecycle

- For long-lived server→client connections (SSE/WebSocket/streaming), register the disconnect-cleanup handler (`req.on('close')`) *before* any `await` in the handler, guarded by an idempotent `closed` flag that gates every subsequent write (heartbeat included) — a disconnect mid-backfill otherwise leaks the subscription/timer and risks a write-after-close crash.
- Subscribe to the event source *before* the backfill read and dedupe the flushed backfill against live events by a monotonic cursor/id, so no event is dropped or duplicated in the connect→backfill→live window; validate any client-supplied resume cursor (`Last-Event-ID`) and fall back to a full backfill on malformed input rather than coercing to `NaN`.

## Evidence

| Learning | Source | Date |
|----------|--------|------|
| SSE `activity.routes.ts`: Phase 2 code review caught close-registered-after-await subscription/heartbeat leak + NaN-cursor dropping buffered live events; fixed with pre-await cleanup + idempotent `closed` flag + `parseCursor()` validation (3 regression tests) | [reflection-TASK-005.md](../../reflection/reflection-TASK-005.md) | 2026-07-15 |
