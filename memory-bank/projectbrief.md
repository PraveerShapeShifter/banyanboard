# Project Brief

## Project Overview

**BanyanBoard** — a lightweight kanban board for small teams. Users create boards
with columns (To Do, In Progress, Done) and move cards between them. Cards carry a
title, description, due date, and labels.

Stack: React frontend, TypeScript/Express backend, PostgreSQL database. Runs locally
via Docker Compose. Architecture follows clean-architecture separation but favors
simplicity over clever abstractions.

## Goals

- Deliver the core board → column → card workflow (create, edit, move, delete) as a
  focused MVP
- Keep the product simple and low-overhead — resist enterprise feature creep
- Make it easy to run and self-host (single `docker compose up`)
- Keep the codebase clean and readable so it is easy to extend

## Repository Structure

- **Type**: Poly-repo (single package, no workspace configuration detected)
- **Workspace Tool**: None
- **Workspace Root**: `C:/ShapeShifter_code/Banyan-workshop/BANYAN-APAC-2/banyanboard`

## Git Configuration

- **Repository**: Yes
- **Provider**: None (no remote configured)
- **CLI Available**: gh
- **Remote URL**: none
- **Default Branch**: master
- **Archive Strategy**: local-merge

## Security Debt (Deferred)

- **2026-07-10 (TASK-001 Phase 1)**: `npm audit` reports 5 vulnerabilities (3 moderate, 1 high, 1 critical) in transitive dependencies of the dev/build toolchain. Deferred — not applied automatically because `npm audit fix --force` may introduce breaking major-version changes. Revisit as a dedicated task; run `npm audit` for the current list.
