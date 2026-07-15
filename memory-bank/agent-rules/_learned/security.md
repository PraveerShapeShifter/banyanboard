---
name: "Learned: Security"
globs: ["src/**/*.validation.ts", "src/**/*.routes.ts"]
topics: ["security", "ssrf", "validation"]
priority: low
evidence_count: 1
last_updated: 2026-07-16
auto_generated: true
---

# Security

- Treat SSRF exposure from any user-supplied outbound URL (e.g. `webhook_url`) as a mandatory *documented decision*, not an implicit gap: validate the accept-scope explicitly (e.g. absolute `http(s)`-only) and record the accepted-risk boundary (what is NOT blocked — private/loopback/metadata ranges) in the same place the validation rule lives, so the residual risk is traceable rather than silent.

## Evidence

| Learning | Source | Date |
|----------|--------|------|
| `rules.validation.ts` rejects non-`http(s)`/relative/over-length `webhook_url` at `POST`/`PATCH /rules` (`400 INVALID_RULE`) before it can reach the dispatcher; private/loopback/metadata blocking deliberately NOT done — recorded as an accepted internal-MVP risk in the frozen webhook creative decision | [reflection-TASK-006.md](../../reflection/reflection-TASK-006.md) | 2026-07-16 |
