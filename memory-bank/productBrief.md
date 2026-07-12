# Product Brief

> This document captures the business and product context for development teams.
> It ensures all agents understand the product's purpose, users, and constraints.

## Product Overview

- **Name**: BanyanBoard
- **Value Proposition**: A lightweight kanban board that lets small teams organize and track their work visually — boards, columns, and cards — without the complexity and overhead of enterprise project-management tools.
- **Product Type**: SaaS (web application; self-hostable via Docker Compose)
- **Stage**: MVP

## Key Functionality

Core capabilities this product provides:

- Create and manage **boards** with columns (default: To Do, In Progress, Done)
- Create **cards** with titles, descriptions, due dates, and labels
- **Move cards** between columns as work progresses (drag-and-drop)
- Organize and visualize a small team's work at a glance
- Run the whole stack locally with a single `docker compose up`

## Markets Serviced

- **Primary Market**: Small teams and SMBs — startups, software teams, agencies, and cross-functional squads that need simple work tracking
- **Secondary Markets**: Individuals and hobby projects; teams outgrowing spreadsheets/sticky notes
- **Geographic Focus**: Global (English-first)
- **Market Size**: Not formally sized; the broad "lightweight project management" segment is large and crowded — BanyanBoard targets the simplicity-seeking tail

## Competitive Landscape

- **Direct Competitors**: Trello, Jira, Asana, Linear, GitHub Projects, Notion boards
- **Indirect Competitors**: Spreadsheets, shared docs, physical whiteboards / sticky notes
- **Key Differentiators**:
  - Simplicity-first — no feature bloat, minimal setup
  - Self-hostable and portable (Docker Compose), data stays with the team
  - Clean architecture that favors readability over clever abstractions, making it easy to extend
- **Competitive Advantages**: Low cognitive overhead, fast to adopt, own-your-data deployment

## Key Personas

### Primary Users

| Persona | Role | Goals | Pain Points | Success Metrics |
|---------|------|-------|-------------|-----------------|
| **Priya** | Team Lead / Project Coordinator | Organize the team's work, see status at a glance, keep cards flowing to Done | Heavyweight tools are slow and over-configured; hard to get a simple shared view | Everyone knows what's in progress; nothing slips past its due date |
| **Marco** | Team Member / Contributor | See what's assigned, update card status, add detail as work evolves | Context switching; unclear what to pick up next | Cards updated quickly; low friction to move a card |

### Secondary Users

| Persona | Role | Goals |
|---------|------|-------|
| **Sam** | Stakeholder / Observer | Glance at board progress without editing; understand what's shipping |

### Administrators/Operators

| Persona | Role | Responsibilities |
|---------|------|------------------|
| **Devon** | Self-hosting Admin / DevOps | Stand up the stack via Docker Compose, manage the database, back up data, manage team access |

## User Flows

- **Primary Flow**: Create a board → board is seeded with default columns (To Do / In Progress / Done) → add cards → drag cards across columns as work moves forward
- **Onboarding**: Sign up (or spin up locally via Docker Compose) → create first board → default columns pre-created → add the first card
- **Key Workflows**:
  - Add a card with title, description, due date, and labels
  - Move a card between columns (drag-and-drop, with optimistic UI)
  - Edit or delete a card; add/remove labels; set or clear a due date

## Success Metrics & KPIs

### Business Metrics
- Number of active teams / workspaces
- Team retention (teams still active after 4 weeks)
- Conversion from first board created → recurring weekly use

### Product Metrics
- WAU/MAU and active teams
- Boards created per team; cards created per board
- Cards moved per week (core engagement signal — indicates the board is actually being used to track work)
- Time-to-first-card after board creation (onboarding health)

### Technical Metrics
- Uptime ≥ 99.9% (hosted)
- API latency: p95 < 200ms, p99 < 500ms
- Client error rate < 1% of requests
- Board load time < 1s for a typical board

## Non-Functional Requirements

### Performance

- **Response Time**: Card/board API operations p95 < 200ms, p99 < 500ms
- **Perceived Latency**: Drag-and-drop uses optimistic UI — card movement feels instant (< 100ms), reconciled with the server asynchronously
- **Page Load Time**: Initial board render < 1s on broadband
- **Throughput**: Modest — sized for small-team concurrency, not high-volume

### Scalability

- **Users**: Designed for small teams (target: up to ~50 members per team/workspace)
- **Data Volume**: Thousands of cards per board should remain responsive
- **Growth Rate**: Horizontal per-deployment; multi-tenant scaling is a future concern, not an MVP requirement
- **Peak Load**: Low peak-to-average ratio typical of internal team tools

### Security

- **Authentication**: Session/token-based (e.g., JWT or server sessions); email + password to start
- **Authorization**: RBAC scoped to boards — owner vs. member; users only access boards they belong to
- **Compliance**: GDPR-aware (EU users); no regulated-data (HIPAA/PCI) handling assumed at MVP
- **Data Classification**: Internal / Confidential (team work data) — not public
- **Encryption**: TLS in transit; encryption at rest at the database/volume layer

### Availability & Reliability

- **Uptime Target**: 99.9% for hosted deployments (aspirational at MVP)
- **RTO**: < 1 hour
- **RPO**: < 24 hours (daily database backups)
- **Backup Strategy**: Regular PostgreSQL backups; documented restore procedure for self-hosters

### Data & Privacy

- **Data Residency**: Determined by where the operator deploys (self-host friendly)
- **Data Retention**: Team-owned; retained until deleted by the team
- **Privacy Requirements**: GDPR / CCPA aligned
- **PII Handling**: Minimal PII — user account (name, email) only
- **Data Portability**: Board/card export (e.g., JSON) is a desirable capability
- **Right to Deletion**: Account and board deletion cascades to associated cards

### Accessibility

- **Target Compliance**: WCAG 2.1 AA
- **Key Requirements**:
  - [ ] Keyboard-accessible card movement (non-drag alternative — critical, since drag-and-drop alone is not accessible)
  - [ ] Screen reader compatibility for boards, columns, and cards
  - [ ] Color contrast compliance (labels must not rely on color alone)
  - [ ] Visible focus indicators
  - [ ] Accessible names/roles for interactive elements

### Internationalization (i18n)

- **Supported Languages**: English at MVP
- **Localization Needs**:
  - [ ] Date/time formatting for due dates
  - [ ] Extensible copy structure for future locales

### Browser/Platform Support

- **Browsers**: Modern evergreen — Chrome, Firefox, Safari, Edge (latest 2 versions)
- **Mobile**: Responsive web (usable on tablet/phone browsers); no native app at MVP
- **Desktop**: N/A (web only)

## Integration Points

### External Systems

| System | Purpose | Protocol | Direction |
|--------|---------|----------|-----------|
| PostgreSQL | Primary data store (boards, columns, cards, labels, users) | SQL / TCP | Both |

### APIs Consumed

| API | Provider | Purpose |
|-----|----------|---------|
| (none at MVP) | — | No third-party APIs required for core functionality |

### APIs Provided

| API | Purpose | Consumers |
|-----|---------|-----------|
| BanyanBoard REST API (Express) | CRUD for boards, columns, cards, labels; card movement; auth | React frontend (and future clients) |

### Data Sources

| Source | Type | Frequency |
|--------|------|-----------|
| PostgreSQL | Database | Real-time |

## Constraints & Assumptions

### Business Constraints

- MVP scope — deliver the core board/column/card loop before adding advanced features
- Small team, favor shipping simple, working software over broad feature coverage

### Technical Constraints

- **Frontend**: React
- **Backend**: TypeScript + Express
- **Database**: PostgreSQL
- **Local run**: Docker Compose (frontend + backend + database)
- **Architecture principle**: Clean architecture, but **favor simplicity over clever abstractions** — do not over-engineer

### Assumptions

- Teams are small (single-tenant-per-deployment is acceptable at MVP)
- Users have modern browsers and reasonable connectivity
- Self-hosting via Docker Compose is an acceptable deployment path for early adopters

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Scope creep toward enterprise features (swimlanes, automations, integrations) dilutes the simplicity value prop | Medium | High | Guard the MVP scope; route non-core features to the roadmap backlog |
| Drag-and-drop card movement is not accessible without a keyboard alternative | High | Medium | Design keyboard-based move controls alongside DnD from the start (WCAG AA) |
| "Clean architecture" interpreted as heavy layering, contradicting the simplicity mandate | Medium | Medium | Keep abstractions shallow; add layers only when a concrete need appears |
| Optimistic UI drift (client/server disagree after failed move) | Medium | Medium | Reconcile on server response; roll back optimistic state on error |

## Open Questions

- [ ] Is BanyanBoard single-tenant per deployment, or multi-tenant (multiple teams per instance)?
- [ ] Are columns fixed (To Do/In Progress/Done) or fully customizable per board at MVP?
- [ ] Card assignment to specific users — in MVP scope or later?
- [ ] Real-time collaboration (live updates across clients) — MVP or future?
- [ ] Authentication approach — local email/password only, or OAuth/SSO later?

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2026-07-10 | /banyan-init | Initial creation (greenfield placeholder) |
| 2026-07-10 | User + Claude | Populated with BanyanBoard context; inferred personas, NFRs, and success metrics |

## Last Refreshed

2026-07-10
