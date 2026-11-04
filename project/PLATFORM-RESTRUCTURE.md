# Agentic Automation: platform restructure

**Status:** Design, approved for build in phases. **Owner:** product (Daniyal). **Date:** 2026-11-04.
**Supersedes:** the Environment-first structure in REQUIREMENTS-PRODUCT.md D2 and ENT-1. All other requirements (approvals, token efficiency D8, API-first D9, Axian rules §7) still apply.

## 1. Decisions

| # | Decision |
| --- | --- |
| D10 | **Workflows first.** After login, people see their workflows. A workflow is the complete solution: agents, flow, group chats, sources, approvals, runs, memory. It is also the unit of isolation and access. "Environment" is removed as a separate level. A client or program becomes an optional **label** on workflows. |
| D11 | **Frontend = React + TypeScript + Vite.** It is a new `web/` app with routing and a component library. The Express server becomes an API only and serves the built `web/dist`. |
| D12 | **Storage stays JSON files**, but every read and write goes through one **data layer** (repositories). It uses atomic writes, per-file locks and an append-only audit log, so a database can replace it later without touching routes or UI. |
| D13 | **Three ways to start a workflow:** Ready-made SDLC, Import a toolkit (Axian first), Build your own from a preset (SDLC, Marketing, SEO, Blank). |
| D14 | **Non-technical first.** Every screen works with defaults. Models, budgets, policies and integration keys sit under "Advanced". No step requires editing `.env` or markdown. |

## 2. Who it is for

| Persona | Needs |
| --- | --- |
| **Business user** (marketing, SEO, PM) | Pick a preset, describe the goal, chat with the agents, approve. No technical words. |
| **Delivery lead** (SDLC) | The ready-made SDLC workflow, Jira/Confluence/Figma/GitHub, gates and PRs. |
| **Approver** | One inbox of pending approvals across workflows. Approve or deny without opening each one. |
| **Builder / admin** | Import toolkits, create agents, edit flows, manage members, connections, audit and cost. |

## 3. What we have today (baseline, branch `sdlc-automation`)

### 3.1 Features that work
- **SDLC pipeline.** Nine role agents (`agents/01…09-*.md`) run in order with stage gates. Each gets the requirement, the project profile, prior outputs, notes, memory and scoped sources.
- **Kickoff group chat** (`src/group.ts`). Members talk in one thread, pass the floor with `[[NEXT]]`, `[[ASK]]` and `[[DONE]]`, then hand off to the pipeline. Members are chosen per team (Discuss tick).
- **Approvals.**
  - Write-plan cards are parsed from agent output (`src/permissions.ts`).
  - Live runtime asks (`src/gate.ts`, `src/tools.ts`) block until the person clicks Allow or Deny.
  - Executors for Jira, Confluence, Figma, GitHub (multi-repo PRs) and Jenkins run only after approval.
- **Sources.** Confluence or pasted BRD, Figma (OAuth or token), Git repos with local code snapshots (`src/code.ts`), design exports, a Jira board.
- **Agents.**
  - The catalog has prebuilt and custom agents (`src/catalog.ts`): duplicate, edit, or create by pasting markdown.
  - The Axian Squad import (`src/toolkit.ts`) brings in 11 agents and a team.
  - Per-agent source scoping lives in `src/scope.ts`.
- **Automation builder.**
  - A graph model (`src/graph.ts`) compiles to the ordered list the engine runs.
  - The canvas supports drag, connect, OK (gate), Discuss (group chat), Deep (stronger model) and skip edges on a `VERDICT:` line.
- **Environments and rooms.** One JSON file per room (`src/store.ts`). Environments are scoped per workspace (`src/environments.ts`). The open room is per browser session.
- **Shared memory** (`src/memory.ts`) and **DMs** with each agent (`src/dm.ts`).
- **Cost.** A cheap default model with an opt-in Deep model (`modelFor` in `src/runner.ts`). Token work T1 (meter, `src/usage.ts`) and T2 (lean packets: summaries, source references, cache-friendly prompt order, top-N memory, `src/packet.ts`) are built but **uncommitted** at the time of writing.
- **Help.** A first-5-minutes guide and a live setup checklist (`src/setup.ts`). There is a first-run nudge and welcome.
- **Auth.** Local email/password (scrypt), one workspace per sign-up, a sealed session cookie. Roles `admin`, `member` and `approver` exist in data but are **not enforced**.

### 3.2 Architecture today
- **Server.** Express + TypeScript run with `tsx` and no build step. `src/server.ts` (2,470 lines) holds all ~60 routes.
- **Frontend.** Plain HTML/JS/CSS in `public/`: `app.js` is 1,874 lines, `styles.css` is 1,252 lines. One page with views switched by JS.
- **Storage.** JSON under `data/`: `rooms/*.json`, `active-room.json`, `environments.json`, `teams.json`, `auth.json`, `custom-agents/<scope>/*.md`, `groups/`, `dms/`, `memory/`, `credentials/*.enc`, `secrets.json`.
- **Runner.** Draft runner (no key) or Cursor SDK (local or cloud).
- **Tests.** `npm run check` runs one assertion script (`src/walkthrough.ts`).

### 3.3 Limits that block an enterprise product
| Limit | Where |
| --- | --- |
| One run at a time for the whole server (`busy` flag) | `src/server.ts` |
| Roles not enforced; no organizations or members; no audit log | `src/auth.ts`, routes |
| `teams.json`, `auth.json` and `custom-agents` ignore `DATA_DIR`; writes are not atomic or locked | `src/teams.ts`, `src/auth.ts`, `src/catalog.ts` |
| UI is one long page; features are hidden in Settings tabs; no routing or deep links | `public/` |
| SDLC words are baked into the UI (sprint, BRS, kickoff) | `public/index.html`, `public/app.js` |
| Kickoff is a fixed first phase, not a step you place in a flow | `src/group.ts`, `handoffStages` |
| Sources and connectors are SDLC-only (no web pages, docs upload, analytics or CMS) | `src/server.ts` `loadSourcesForRole` |
| Default environment is visible to every account | `src/environments.ts` |

## 4. Target concepts (glossary)

| Term | Meaning | Replaces |
| --- | --- | --- |
| **Organization** | A company account. It owns members, connections, the agent library and billing/usage. | "workspace" |
| **Member** | A person in an organization with a role (§9). | user + binding |
| **Workflow** | A complete solution: flow, agents, group chats, sources, approvals policy, members, memory. Has a type (SDLC, Marketing, SEO, Custom) and an optional client label. | Environment + Team |
| **Template / preset** | A starting workflow (agents, flow, sources to ask for, wording). It is copied, never linked. | — |
| **Toolkit** | An importable pack of agents (Axian Squad first), versioned. | — |
| **Agent** | A role defined by markdown instructions, with tools, sources and a gate default. It can be in the org library and/or a workflow. | catalog agent |
| **Flow** | The graph of steps in a workflow. | team graph |
| **Step** | One node: **Agent**, **Group chat** (several agents talk, then hand off), **Approval** (person checks before continuing), **Skip rule** (edge on a verdict). | stage, kickoff |
| **Run** | One execution of a workflow on one goal or input, such as "Sprint 8" or "Q4 launch blog". It holds step outputs, chats, approvals and tokens. | sprint room |
| **Approval** | A gate after a step, or a requested external write. All approvals land in the **inbox**. | stage gate, permission card |
| **Connection** | Access to an outside system (Atlassian, Figma, GitHub, Jenkins; later CMS, Search Console). Either personal OAuth or an org service connection. | per-session OAuth |

Rules carried over unchanged: no external write without an approval, outputs only (never tool logs) are handed on, sources are scoped per agent, and prompts never contain secrets.

## 5. Screens (information architecture)

Routes are React Router paths. Each screen lists its purpose, contents and empty state.

**Public**
- `/login`: email and password, link to sign up. Forgot-password and SSO come later (§13a, ENT-6).
- `/signup`: name, work email, password, organization name. Creates the org and makes the person Owner. Then goes to `/welcome`.
- (Later) `/invite/:token`: accept an invite into an existing organization. Not in the first build (§13a).

**First run**
- `/welcome`: three large cards:
  1. **Use the ready-made SDLC workflow**: one click creates it with the 9 agents and the kickoff chat.
  2. **Import agents** (Axian kit): opens the import flow.
  3. **Build your own**: opens the preset picker.

  A short "How it works" strip and a Skip link to Home.

**App shell** (after login): a left nav with Home, Approvals (with badge), Agent library, Help, and Admin (if the role allows). A top bar with the organization name, a search box (later) and the user menu.

- `/` **Home**
  - Workflow cards: name, type icon, client label, last run state, pending approvals count.
  - "+ New workflow".
  - Filter by type or client.
  - Empty state is the same three cards as `/welcome`.
- `/new` **New workflow wizard**, four steps with Back and Next:
  1. **Start from:** Ready-made SDLC, Import a toolkit, or Preset (SDLC, Marketing, SEO, Blank).
  2. **Basics:** name, client label (optional), goal in plain words. The goal pre-fills the first run.
  3. **Team review:** the preset's agents as cards. Remove, add from the library, or create one by pasting a description. Shows which agents ask for approval.
  4. **Sources:** only what this preset needs, each optional. SDLC asks for Confluence/Figma/repos/Jira. Marketing asks for a brand guide upload, product page URLs and audience notes. SEO asks for site URL, target keywords and competitor URLs.

  Finish creates the workflow and opens it.
- `/w/:workflowId` **Workflow**, with tabs:
  - **Overview:** goal, flow summary (steps as a line), latest run, "Start a run".
  - **Chat:** the group chat for the current run. Same speaking rules as today: @mention, pause, hand-off button. Plus DMs with one agent as side threads.
  - **Flow:** the canvas (React Flow).
    - Step types: Agent, Group chat, Approval, Skip rule.
    - Each Agent step has OK, Deep and Sources settings.
    - Validation messages come from `compileGraph`.
    - Save makes a new flow version.
  - **Agents:** agents in this workflow. Add from the library, import, paste markdown, edit instructions (plain-text editor with preview).
  - **Sources:** connected sources and what each agent can see, from `src/scope.ts` rules shown as a table.
  - **Runs:** a list with status, tokens and date. Run detail shows each step's status, output, tokens, time, sources used, gaps, and a "why stopped" line, plus Approve / Retry / Continue.
  - **Settings:**
    - name and label;
    - members and roles for this workflow;
    - approval policy (required gates);
    - model and budget under Advanced;
    - archive or delete.
- `/approvals` **Approvals inbox**
  - Every pending gate and external write across workflows the person may approve: system, target, payload preview, which agent proposed it, Approve or Deny with a note.
  - Approvers land here by default.
- `/library` **Agent library:** org-wide agents and imported toolkits (with version). Create, import (folder path; git URL later), duplicate, edit.
- `/admin` (Owner/Admin):
  - **Members:** list and roles. Invites come later (§13a); until then each sign-up is its own organization.
  - **Connections:** Atlassian/Figma/GitHub/Jenkins, personal vs service. The setup checklist with redirect URLs and scopes (reuse `src/setup.ts`).
  - **Audit log:** filter by workflow, person, action.
  - **Usage:** tokens and cost per workflow and per run.
- `/help`: the first-5-minutes guide per persona and FAQ, with deep links into the app.

UX rules:
- Plain words. Say "Approve before continuing", not "needs_approval".
- Every empty screen has one obvious next action.
- Keep it to three clicks from Home to a running workflow.
- The approval inbox is reachable from everywhere.
- Mobile works for reading and approving.

## 6. Presets (templates)

Each preset is a folder `templates/<id>/`:
- `template.json`: name, type, description, flow graph, group chat members, sources to ask for, default gates, UI wording;
- `agents/*.md`: the same agent format as today, with front matter and a `## Draft` section.

Creating from a preset **copies** agents and flow into the workflow, so later preset changes never alter existing workflows.

| Preset | Flow (→ = next step, [GC] = group chat, [A] = approval) | Sources asked | External writes |
| --- | --- | --- | --- |
| **SDLC (ready-made)** | [GC: System Analyst, Software Lead, QA Design] → Architecture → Coding → QA Unit → Deploy → QA E2E → DevOps. Gates as today. | Confluence/BRD, Figma, repos, Jira board, Jenkins | Jira, Confluence, Figma, GitHub PRs, Jenkins (all approved) |
| **Marketing** | [GC: Brief Analyst, Strategist, Brand Reviewer] → Copywriter → Editor [A] → Channel Planner [A] | Brand guide (upload/paste), product URLs, audience notes | None in v1 (outputs are drafts to copy). Later: CMS/social post via connector, approved |
| **SEO** | Keyword Researcher → [GC: Content Gap Analyst, Content Strategist] → Writer → On-page Optimizer [A]; skip rule from Technical Auditor on `VERDICT: blocked` | Site URL, target keywords, competitor URLs; later Search Console/GA4 | None in v1. Later: CMS draft, approved |
| **Blank** | Empty canvas with one Agent step | — | — |
| Later | PM report, Sprint audit, Incident (from REQUIREMENTS UF-2/ENT-9) | — | — |

Marketing and SEO need **new source types**:
- web page by URL, fetched and given as readable text;
- uploaded document (PDF/DOCX/MD), stored per workflow.

Both go through the existing `SourceDoc` / `localPath` mechanism, so agents read them as folders (TOK-4).

New agent markdown for Marketing (5) and SEO (6) must follow `project/AGENTS.md` rules:
- cite sources;
- record gaps instead of inventing;
- stay in role;
- end with a `VERDICT:` line where a skip rule depends on it.

## 7. Data model (JSON files behind a data layer)

### 7.1 Layout under `DATA_DIR` (default `data/`)
Every path below honors `DATA_DIR`, which fixes today's leak in teams, auth and custom agents.

```
data/
  orgs/<orgId>/org.json                  name, createdAt, settings
  orgs/<orgId>/members.json              [{userId, role}]
  orgs/<orgId>/library/agents/*.md       org agent library
  orgs/<orgId>/library/toolkits/<id>@<version>/...
  orgs/<orgId>/connections/*.enc         service connections (encrypted)
  orgs/<orgId>/audit/YYYY-MM.jsonl       append-only audit log
  users.json                             users (scrypt hashes), no secrets in plain text
  sessions/                              sealed-cookie session -> userId, orgId, open run
  workflows/<workflowId>/workflow.json   name, type, label, orgId, members+roles, policy, flowVersion
  workflows/<workflowId>/flows/<n>.json  flow versions (graph); latest = flowVersion
  workflows/<workflowId>/agents/*.md     agents copied into this workflow
  workflows/<workflowId>/sources/        uploads, fetched pages, code snapshots index
  workflows/<workflowId>/runs/<runId>.json        steps, outputs, approvals, usage
  workflows/<workflowId>/runs/<runId>/chat.json   group chat thread(s)
  workflows/<workflowId>/runs/<runId>/dms/<agent>.json
  workflows/<workflowId>/memory.json     shared memory for the workflow
  credentials/<userId>/*.enc             personal OAuth tokens (encrypted, as today)
  secrets.json                           generated session secret + credentials key
templates/<presetId>/...                 shipped with the app (read-only)
```

### 7.2 Data layer rules (`src/data/`)
- **One repository per area:** orgs, users, workflows, flows, runs, agents, memory, audit, connections. Routes and services never call `fs` directly.
- **Atomic writes.** Write to `file.tmp`, fsync, then rename. A per-file in-process mutex serializes writers.
- **Run lock per run** (ENT-8). It replaces the global `busy` flag. A small in-process queue limits concurrent runs (setting, default 4).
- **Audit log** is append-only JSONL. Every run start/stop, step finish, approval or denial (who, when, what), external write and its result, member/role change, and connection change is recorded. It is never edited.
- Repositories expose async functions with typed results, so a Postgres or SQLite implementation can replace them (D12).

### 7.3 Migration from today's files (one-time script `scripts/migrate-v2.ts`)
| From | To |
| --- | --- |
| `auth.json` workspaces | `orgs/<id>/org.json`; the workspace creator becomes Owner |
| `auth.json` users and bindings | `users.json` + `members.json` (role kept) |
| Each Environment + its rooms' team | One **Workflow** per (environment, team) pair; client label = environment name |
| Default environment + SDLC Sprint Team | Workflow "SDLC Sprint", owned by the oldest org, **not** visible to other orgs (fixes the shared-Default leak) |
| `teams.json` graph / swarmNames / skips / reasoning | `flows/1.json` |
| `custom-agents/<scope>/*.md` | the matching workflow's `agents/` (and org library for Default scope) |
| `rooms/<slot>.json` | `runs/<runId>.json` (runId = old slot), messages and stages kept |
| `groups/<roomId>.json`, `dms/<roomId>/`, `memory/<roomId>.json` | under the run / workflow |
| `credentials/*.enc` | `credentials/<userId>/` by session binding |

The old `data/` is left in place as a backup. The script prints a report and is safe to re-run (dry-run flag).

## 8. Backend changes (instructions)

**Keep and reuse:**
- the engine in `src/router.ts`: `runUntilWait`, `approveAndContinue`, `retry`, `applySkips`, `verdictOf`;
- `src/runner.ts` (prompt, model, Cursor SDK);
- `src/group.ts` (speaker rules);
- `src/graph.ts` (compile and validate);
- `src/permissions.ts`, `src/gate.ts`, `src/tools.ts`;
- the connector modules `jira.ts`, `atlassian.ts`, `figma.ts`, `github.ts`, `jenkins.ts`;
- `src/toolkit.ts`, `src/scope.ts`, `src/memory.ts`, `src/usage.ts`, `src/packet.ts`, `src/setup.ts`.

**Restructure:**
1. Split `src/server.ts` into
   - `src/app.ts` (Express setup and middleware);
   - `src/api/<area>.ts` route modules: auth, orgs, members, workflows, flows, agents, library, toolkits, runs, chat, dms, approvals, sources, connections, admin, audit, usage, help;
   - `src/services/` (run service, approval service, source service).

   Routes only validate input, check the role, call a service and return JSON.
2. **API** (REST, JSON, versioned `/api/v1`). Every UI action has a route (INT-1). Main resources:
   - `POST /auth/signup|login|logout`, `GET /me`
   - `GET /orgs/:id/members` (invites and `POST /invites` later)
   - `GET/POST /workflows`, `GET/PATCH/DELETE /workflows/:id`, `POST /workflows/from-template`, `POST /workflows/from-toolkit`
   - `GET/PUT /workflows/:id/flow` (validates with `compileGraph`, saves a new version)
   - `GET/POST/PATCH/DELETE /workflows/:id/agents[/:name]`, `GET/POST /library/agents`, `POST /library/toolkits/import`
   - `GET/POST /workflows/:id/runs`, `GET /runs/:id`, `POST /runs/:id/start|approve|retry|pause`, `GET /runs/:id/stream` (NDJSON or SSE, as today)
   - `GET/POST /runs/:id/chat`, `POST /runs/:id/chat/handoff`, `GET/POST /runs/:id/dms/:agent`
   - `GET /approvals` (inbox across workflows), `POST /approvals/:id/approve|deny`
   - `GET/POST /workflows/:id/sources` (url, upload, confluence, figma, repo, jira)
   - `GET/POST /connections`, OAuth `/auth/<provider>` and `/callback`
   - `GET /admin/audit`, `GET /admin/usage`, `GET /templates`, `GET /setup-check`
3. **Auth and RBAC** (ENT-2). Middleware loads the member, org and workflow role. Each route declares the minimum role.

   | Role | Can do |
   | --- | --- |
   | Owner | Everything, including billing, delete org |
   | Admin | Members, connections, library, all workflows |
   | Lead | Create and edit workflows, flows, agents |
   | Approver | Approve or deny gates and writes |
   | Member | Start runs, chat, DM |
   | Viewer | Read only |

   An approver cannot approve their own proposed write when the workflow policy says so (separation of duties).
4. **Group chat as a step.** Replace "kickoff then hand off" with a Group chat node. The run engine, on reaching it, runs `runGroup` until done or ask, then stores each member's messages as that step's output (today's `handoffStages`) and continues. Any position in the flow is allowed.
5. **Approval as a step.** A node type that only waits for a person, besides the per-agent OK.
6. **Sources.** Add URL fetch (size-capped, text only), file upload (stored under `sources/`, PDF/DOCX converted to text) and a per-agent source matrix stored in the flow. Keep the token rules: sources go by reference as readable folders (TOK-4).
7. **Security.**
   - CSRF token on state-changing routes;
   - login rate limit;
   - password policy (reset by email comes later, §13a);
   - secure cookie flags behind HTTPS;
   - secrets only in `secrets.json` and `.enc`, never in prompts (walkthrough keeps checking).
8. **Concurrency.** Remove the global `busy` and the 409 "run in progress" refusals. The lock is per run. Switching between workflows never blocks.

## 9. Frontend (React) instructions

- **Location:** a new `web/` folder (Vite + React 18 + TypeScript).
  - Dev: `npm run dev` starts Express on 4173 and Vite on 5173, with a proxy to `/api`.
  - Prod: `npm run build` builds `web/dist`, which Express serves.
- **Libraries:**
  - React Router for routes;
  - TanStack Query for server state;
  - **shadcn/ui (Radix) + Tailwind** for components and theme (light and dark);
  - **@xyflow/react (React Flow)** for the Flow canvas;
  - react-markdown with sanitization for agent output, replacing `renderMarkdown`. Keep the rule that only `/api/annotations/` images render.
- **Structure:**
  - `web/src/routes/` (one folder per screen in §5);
  - `web/src/components/` (shared: AppShell, WorkflowCard, StepStatus, ApprovalCard, ChatThread, AgentEditor, SourcePicker);
  - `web/src/api/` (typed client, one function per route; types shared from `src/types.ts` through a `shared/` folder).
- **Streaming:** run and chat streams use the same NDJSON events as today (`room`, `delta`, `error`), read with `fetch` + `ReadableStream`. Live permission asks keep polling `GET /approvals?live=1` while a run is open, or move to SSE.
- **Accessibility:** keyboard reachable, labels on inputs, color contrast in both themes, focus visible.
- **Wording:** use the glossary (§4). No "sprint", "BRS" or "kickoff" outside the SDLC template's own text.
- **Old UI:** `public/` stays until the React app reaches parity (Phase 6), then is removed.

## 10. Build phases (each ends with `npm run check` green and a browser walk-through)

| Phase | Scope | Done when |
| --- | --- | --- |
| 0 | Commit current work (T1 token meter, T2 lean packets); freeze the old UI except fixes | Clean tree; tag `v1-legacy` |
| 1 | **Data layer + migration:** repositories, atomic writes, `DATA_DIR` everywhere, audit log, `migrate-v2` with dry-run | Walkthrough runs on repositories; migration of a copy of real `data/` reports 0 errors and the SDLC run is intact |
| 2 | **Orgs, members, RBAC, sessions:** sign-up and login only (no invites or reset yet), roles enforced, per-run lock replacing `busy` | Two orgs cannot see each other's workflows; two runs in two workflows run at once; role checks tested |
| 3 | **Workflow API:** workflows, flows (versions), agents, runs, approvals inbox, templates; group chat and approval as steps | API tests cover create-from-template, run, gate, skip, group-chat step, inbox approve |
| 4 | **React shell:** login, signup, welcome, home, new-workflow wizard, approvals inbox | New user signs up, creates SDLC workflow and reaches first approval in the browser |
| 5 | **Workflow screens:** overview, chat, flow canvas (React Flow), agents, sources, runs, settings | Everything the old UI can do is possible in the new one |
| 6 | **Presets:** Marketing and SEO templates and agents (draft-only, no publishing yet); URL and upload sources; remove `public/` | Business user runs a Marketing workflow end to end with only uploads and URLs |
| 7 | **Admin:** members, connections (service + personal), audit viewer, usage/cost | Admin sees who approved what, and tokens per workflow |
| 8 | **Token work carried over:** T3 budgets, resume for retry/DM, model auto-escalate, cost report (REQUIREMENTS §9.2; T1 and T2 already built) | Budgets stop runs at 100%; cost per workflow shown |
| Later | Invites, password reset by email, Marketing/SEO publishing (CMS, social), server or Docker hosting, SSO/SCIM, API keys, webhooks, external approvals (Slack/Teams), MCP server, CMS/Search Console connectors, Postgres repository | — |

## 11. Enterprise quality bar

- **Security:**
  - approvals before every external write (unchanged);
  - RBAC on every route;
  - audit log;
  - encrypted credentials;
  - no secrets in prompts;
  - CSRF and rate limits.
- **Reliability:** atomic writes; runs survive restarts (a stage marked `running` becomes `error` with Retry, as today); backups are a copy of `data/`.
- **Observability:** structured server logs (request id, run id, workflow id); health route.
- **Performance and cost:** token rules §6.11 of REQUIREMENTS apply to every phase. Show tokens per step and run.
- **API-first** (D9): the React app uses only documented routes.
- **Accessibility and i18n-ready:** all UI text in one strings file per screen.

## 12. Testing

- **Unit and engine:** `src/walkthrough.ts` stays the core check. Move fixtures to temp `DATA_DIR`, now that every store honors it.
- **API tests:** a new `npm run test:api` starts the server on a temp `DATA_DIR` and drives each route with fetch, including role checks.
- **Browser e2e:** `npm run test:e2e` with `playwright-core` driving installed Edge/Chrome (proven to work on this machine). Journeys:
  - new user onboarding;
  - SDLC to first approval;
  - Marketing preset run;
  - two users isolation;
  - approver inbox.
- **Rule:** tests never touch the real `data/`.

## 13. Risks

| Risk | Mitigation |
| --- | --- |
| Big-bang rewrite stalls | Phases keep the old UI working until parity; the engine is reused, not rewritten |
| JSON files under concurrent load | Per-file locks, atomic rename, per-run locks; repository interface allows a DB swap |
| Marketing/SEO agents give weak results without data connectors | v1 uses uploads and URLs; outputs are drafts; connectors later |
| Migration loses data | Dry-run, report, old folder kept as backup, tested on a copy first |
| Non-technical users get lost in the canvas | Presets land a working flow; the canvas is optional; wizard first |

## 13a. Answered questions (2026-11-04)

| # | Question | Answer | Effect on the build |
| --- | --- | --- | --- |
| 1 | Can Marketing/SEO workflows publish (CMS, social)? | **Yes, but later.** | Phase 6 ships draft-only presets. Publishing connectors (with approval) move to "Later". |
| 2 | Email for invites and password reset? | **None for now.** No forgot-password, no invites. **Sign-up only.** | Phase 2 builds sign-up and login only. Each sign-up creates its own organization. Adding people to an org comes later. |
| 3 | Hosting for the pilot? | **Local machine for now.** | No Docker or server build scripts yet. `npm run dev` and `npm run build && npm start` on localhost are enough. HTTPS-only cookie flags stay off locally. |
| 4 | Client label: free text or managed list? | **Free text.** Keep it simple. | A plain text field on the workflow. Home can filter by it. |

## 14. Instructions for whoever builds this (people or agents)

- Read this doc, `REQUIREMENTS-PRODUCT.md` §0 and §6.11–6.13, and `CLAUDE.md` first.
- Work phase by phase. Do not start the React UI before Phase 3's API exists.
- Never let a write to Jira, Confluence, Figma, GitHub, Jenkins or any later system run without an approval record in the audit log.
- Every new store goes through `src/data/` and honors `DATA_DIR`.
- When a field is added to a run or workflow, add its default in the repository's normalizer and in the migration.
- Keep agent markdown format compatible (front matter + `## Draft`). Templates and imported toolkits use it.
- Update `src/walkthrough.ts` and the API/e2e tests with each phase. Update the status table in this doc.
- Commit per slice on a branch; never commit `data/` or `.env`.
