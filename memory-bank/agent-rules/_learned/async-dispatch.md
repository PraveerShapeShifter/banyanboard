---
name: "Learned: Async Dispatch & Request-Path Latency"
globs: ["src/**/*dispatcher*.ts", "src/**/*.engine.ts", "src/webhooks/**/*.ts", "src/**/*.routes.ts"]
topics: ["async-dispatch", "performance", "latency", "reliability"]
priority: low
evidence_count: 1
last_updated: 2026-07-16
auto_generated: true
---

# Async Dispatch & Request-Path Latency

- Push slow or unreliable work (outbound HTTP, retries) off the request path: make dispatch fire-and-forget with a synchronously-created DB row as the durable source of truth, `.unref()` every retry timer, and guarantee even the dispatcher's own logging call cannot throw out of the async chain (fully fail-safe — never crashes the process, never fails the originating write).
- Bound any synchronous on-path traversal (rule/graph engines) by an existing domain enum's cardinality (e.g. `MAX_HOPS = STATUSES.length`) rather than a bare magic number, so the ceiling self-updates and stays provably correct as the model grows — protecting the p95 latency budget by construction.

## Evidence

| Learning | Source | Date |
|----------|--------|------|
| `HttpWebhookDispatcher.dispatch()` returns `void`; creates the `pending` `webhook_deliveries` row synchronously then runs `fetch` + `setTimeout(30s).unref()` retries off-path; DB row is source of truth; a slow/unreachable webhook never adds latency to `PATCH /cards/:id` | [reflection-TASK-006.md](../../reflection/reflection-TASK-006.md) | 2026-07-16 |
| `CardRuleEngine` bounds its visited-status traversal with `MAX_HOPS = CARD_STATUSES.length = 3` (compile-time-derived, not a literal) to keep synchronous in-request evaluation inside the p95<200ms budget | [reflection-TASK-006.md](../../reflection/reflection-TASK-006.md) | 2026-07-16 |
