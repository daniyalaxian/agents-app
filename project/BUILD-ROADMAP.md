# Dream app — detailed build roadmap

**Product:** Multi-user SDLC agent platform — prebuilt + custom agents, teams/swarms, shared memory, per-agent DMs, human approval on every external write.

**Working style:** Build phase by phase; full test pass at major milestones / end of stack.

**Hard rule (all phases):** No silent writes to Confluence, Figma, Jira, GitHub, or Jenkins. Agents propose → human approves → then execute.

**Legend**

- `[x]` Done in code (may still need console reconnect / manual verify later)
- `[~]` Partial / started
- `[ ]` Not started

**Progress snapshot (approximate)**

| Phase | Status |
| --- | --- |
| 0 Foundation | Mostly done |
| 1 Reusable project workspace | Mostly done |
| 2 Read path | Mostly done |
| 3 Permissioned writes | Mostly done (Jira/Confluence/Figma + deny) |
| 4 Coding + multi-repo PRs | Mostly done (workdir mirror + PR files + Jira PR comment) |
| 5 Jenkins + QA on env | Mostly done (E2E via Playwright optional; DevOps health wired) |
| 6 Shared memory + agent DMs | In progress (memory + DM + permissions wired) |
| 7 Identity + custom agents + team builder | In progress (local auth + catalog + teams) |
| 8 Scale / marketplace | Parked |

---

## Phase 0 — Foundation (Agent Room shell)

**Goal:** One room that runs a fixed SDLC swarm with Setup connections and approval gates.

### 0.1 App shell
- [x] Express server + room store (`data/room.json`)
- [x] Load agents from `agents/*.md` (front matter + Draft)
- [x] Packet handoff (prior outputs → next role)
- [x] NDJSON streaming for live role output
- [x] Draft engine without `CURSOR_API_KEY`
- [x] Cursor local/cloud runner when API key set
- [x] Session cookie + encrypted credential store

### 0.2 Prebuilt SDLC swarm (role files)
- [x] `01` System Analyst
- [x] `02` Software Lead
- [x] `03` QA Design
- [x] `04` Architecture
- [x] `05` Coding
- [x] `06` QA Unit
- [x] `07` Deploy
- [x] `08` QA E2E
- [x] `09` DevOps
- [x] `needs_approval` gates on write-sensitive roles
- [x] Design docs: `SDLC-DESIGN.md`, `AGENTS.md`

### 0.3 UI
- [x] Grok-style dark chat UI
- [x] Stage chips pipeline
- [x] Bottom composer (Start / Approve / Retry)
- [x] Setup drawer
- [x] Empty state before start
- [x] Unlock Figma/Git/Jira fields after room started (BRS stays locked)

### 0.4 Atlassian / Confluence
- [x] OAuth Connect / Disconnect
- [x] Scopes include `read:page:confluence` + `offline_access`
- [x] Scopes include Jira read: `read:jira-work`, `read:jira-user` (console enable + reconnect still required)
- [x] Save Confluence BRS URL
- [x] Paste BRS fallback
- [x] Fetch Confluence page into SA (and Lead) packet
- [ ] Documented console checklist verified on your tenant (manual)

### 0.5 Figma
- [x] OAuth Connect / Disconnect
- [x] Sprint Figma file URL field + save
- [x] URL validation (file/design/proto/board)
- [x] Scopes requested: `current_user:read`, `file_metadata:read`, `file_content:read`
- [x] Fetch Figma structure summary into SA/Lead packet
- [ ] Figma app scopes enabled + reconnect verified (manual)
- [ ] Optional: preview file name on Save (like Confluence preview)

### 0.6 GitHub
- [x] OAuth Connect / Disconnect (`read:user`)
- [x] Multiple microservice repos + branch each
- [x] Add / remove repos in Setup
- [x] Inject repo list into SA / Lead / Architecture / Coding packets
- [ ] Repo `contents:read` (or equivalent) when we clone/browse code (Phase 4)
- [ ] GitHub Connect verified on your account (manual)

### 0.7 Jira (config only in this phase)
- [x] Board URL or project key field
- [x] Parse project key / board id
- [x] Store `jiraBoardUrl` + `jiraProjectKey` on room
- [x] Mention Jira key in github source blob for agents
- [ ] Create/update issues (Phase 3)

### 0.8 Phase 0 exit
- [~] Room runs end-to-end in draft mode (roles exist; full manual run deferred)
- [ ] All Setup connects verified once before Phase 3 writes

---

## Phase 1 — Reusable project workspace

**Goal:** Any team can point this app at their project by config, not forks.

### 1.1 Project profile
- [x] `project/AGENTS.md` exists (Orders sample)
- [x] Expand knobs: env ladder, Jenkins job names, test user secret names
- [x] “New project” checklist in docs (copy template, set `.env`, fill Setup)
- [ ] Optional: load project profile JSON used by UI header (name, key)

### 1.2 Room lifecycle
- [x] Reset room
- [x] Soft reset keeps Setup sources + OAuth; clears pipeline/messages/permissions
- [x] Room id derived from requirement slug
- [x] Requirement editable in UI before start

### 1.3 Multi-project readiness (single-tenant still OK)
- [ ] `DATA_DIR` / room file per project id
- [ ] Env example documents all integration vars in one table

### 1.4 Phase 1 exit
- [ ] New engineer can onboard a second project using only MD + Setup + `.env`

---

## Phase 2 — Read path (agents consume sources)

**Goal:** Agents cite real BRS / Figma / repos / Jira project; still no external writes.

### 2.1 Confluence
- [x] Load page for SA
- [x] Load page for Software Lead
- [ ] Richer HTML→text cleanup if needed
- [ ] Fail soft with clear UI error when scope missing

### 2.2 Figma
- [x] Depth-limited structure summary for SA / Lead
- [ ] Respect focus `node-id` more deeply (named frame dump)
- [ ] Optional screenshot/export later (not required for MVP)

### 2.3 GitHub repos (read context)
- [x] Repo list in packet
- [ ] Lightweight repo metadata via API (default branch, description) — optional
- [ ] For Architecture/Coding: tree or README skim per selected repo (Phase 4 prep)
- [ ] No commits

### 2.4 Jira read (optional early)
- [ ] Read project metadata / recent issues (read scopes)
- [ ] QA Design cites `jiraProjectKey` in Write plan drafts

### 2.5 Agent drafts aligned to sources
- [x] SA / Lead instructions mention Figma + repos
- [x] Update instructions to require cites for figma + github + jira key
- [x] QA Design ties Write plan targets to project key / Stories

### 2.6 Phase 2 exit
- [ ] With BRS + Figma URL + gitRepos set, SA packet contains all three source kinds

---

## Phase 3 — Permissioned write-backs

**Goal:** Write plans become real side effects only after Approve.

### 3.1 Permission model
- [x] `PermissionRequest` type: role, system, action, target, payload summary, status
- [x] Parse Write plan tables from agent output
- [x] UI: Approve write / Deny (separate from pipeline Approve)
- [~] Audit via room messages + permission status (dedicated log file later)

### 3.2 Confluence writes
- [x] Scope `write:comment:confluence` requested
- [x] Post footer comment on BRS page from Write plan on approve
- [x] Never post without approve

### 3.3 Figma writes
- [x] Scope `file_comments:write` requested
- [x] Post comment on file/node from Write plan on approve
- [ ] Reconnect after scope add (manual)

### 3.4 Jira writes
- [x] Scope `write:jira-work` requested in OAuth (console enable + reconnect still required)
- [x] Create Epic / Story / Task from permission Approve (uses room `jiraProjectKey`)
- [x] Parent Epic linking for Stories/Subtasks when `jiraEpicKey` set
- [~] Architecture Subtasks via same create path
- [x] QA Design AC attach via Jira comment on Approve
- [x] On deny: mark denied; no API call

### 3.5 Phase 3 exit
- [ ] Happy path: Approve SA → Epic+Stories exist; Approve QA Design → AC on tickets; Deny → nothing created

---

## Phase 4 — Coding + multi-repo git

**Goal:** Work packages map to microservices; PRs only after approve.

### 4.1 Planning
- [x] Architecture MD already emits work packages
- [x] Bind each WP to a `gitRepos` entry (owner/repo/branch) in drafts
- [x] Coding agent instructions require staying inside assigned repo

### 4.2 Git access
- [x] Expand GitHub OAuth scopes with `repo` for PR create
- [x] Local mirror into `data/workdir/<owner>__<repo>` on Approve (API put; not full git clone)
- [x] Branch from configured base branch (via GitHub API)

### 4.3 Implementation fan-out
- [~] Sequential per GitHub Write plan row (one PR approve at a time)
- [ ] Optional later: parallel coding agents per WP
- [x] Diff summary written under workdir `.agent-room/last-diff-summary.md` + PR body file list

### 4.4 PR on approve
- [x] Open PR via API on Approve (branch + proposed files + marker)
- [x] Comment PR URL on Jira keys found in payload (best-effort when Atlassian connected)
- [x] No merge-to-main automation in this phase

### 4.5 Phase 4 exit
- [~] Happy path ready: Approve GitHub card → files in workdir + PR; multi-repo via multiple Write plan rows / targets

---

## Phase 5 — Jenkins + QA on environment

**Goal:** Deploy gate + agent-produced QA report Jenkins can fail on.

### 5.1 Deploy role → Jenkins
- [x] Deploy MD names job + smoke intent
- [x] `POST` trigger Jenkins job on Approve (crumb/token)
- [x] Params: `ROOM_ID`, `ENV`, `DEPLOY_URL` / build ref (+ `SMOKE_URL`, `SMOKE_TOKEN`)
- [x] Setup fields: deploy env, deploy URL, Jenkins job

### 5.2 Smoke / QA API
- [x] `POST /api/jenkins/smoke` (bearer token)
- [x] Modes: `api` | `e2e` | `both`
- [x] Load TEST-* / UNIT-* from room messages
- [x] Return JSON report artifact (store `lastSmokeReport` on room)
- [~] E2E mode is reachability placeholder until browser automation

### 5.3 QA Unit
- [x] API probe against deploy URL (maps UNIT-*/TEST-* to probe health)
- [x] Richer per-check assertions from QA Design (`src/assertions.ts`)

### 5.4 QA E2E
- [x] Test user secrets via env (`QA_TEST_USER` / `QA_TEST_PASSWORD`) — never in chat
- [x] Browser automation on **agent host** (optional Playwright; HTML scan fallback)
- [x] Login attempt when QA secrets set + feature keyword checks
- [x] Screenshots under `data/smoke-evidence/` when Playwright present
- [x] Not relying on Cursor cloud for private envs

### 5.5 DevOps
- [x] Optional log probe (`DEVOPS_LOG_PROBE_URL`)
- [x] Health report from smoke + log signals (`GET /api/room/health-report`)
- [x] No silent rollback (recommend only)

### 5.6 Env ladder
- [x] Setup stores current env + deploy URL; promotions still human-gated via Write plans
- [x] Store last-good deploy URL per env on room (`deploymentsByEnv`)

### 5.7 Phase 5 exit
- [x] Jenkins Deploy → callback QA → red report returns 422; green 200; health attached
- [~] Full multi-env promotion policy UI still light (records exist; human Approve remains gate)

---

## Phase 6 — Shared memory + per-agent DMs

**Goal:** Team room + 1:1 agent chats; shared findings; permission asks in either surface.

### 6.1 Project memory
- [x] Durable store: gaps, decisions, tests, write plans, approvals, PR links (`data/memory/`)
- [x] Every agent read memory into packet
- [x] Version / sprint-scoped entries (keyed by room id)

### 6.2 Per-agent threads
- [x] UI: list agents → open DM
- [x] Thread persistence per project + agent (`data/dms/`)
- [x] DM uses same runner/sources as role; writes still need permission

### 6.3 Permission cards in DM
- [x] Agent asks via Write plan → room permission cards (`surface: dm`)
- [x] User Approve/Deny (same cards)
- [x] Result written to memory + visible to other agents

### 6.4 Cross-awareness
- [x] Lead DM finding indexed into memory for QA DM / next room run
- [x] Cite `agent` + `source` on every memory item

### 6.5 Phase 6 exit
- [~] DM Lead → Figma Write plan → Approve → memory shows outcome for QA DM (manual verify with OAuth)

---

## Phase 7 — Identity, catalog, custom agents, team builder

**Goal:** Multi-user product; prebuilt + custom; compose swarms.

### 7.1 Auth & tenancy
- [x] User login (local email/password; SSO later)
- [x] Org / workspace (one workspace per register)
- [x] Project membership roles on user (`admin` / `member` / `approver` field)

### 7.2 Agent catalog
- [x] Prebuilt agents published (current 9)
- [x] Duplicate prebuilt → custom agent (sign-in)
- [x] Custom agent editor (instructions, tools allowlist, `needs_approval`)
- [x] Guardrails: write tools force `needs_approval`

### 7.3 Team / swarm builder
- [x] Save named team (ordered agents + approval map)
- [x] “SDLC Sprint Team” = default prebuilt swarm
- [x] Run room with selected team (`POST /api/room/team`)

### 7.4 Phase 7 exit
- [~] Second user can register/login, pick/customize team; full multi-project tenancy later

---

## Phase 9 — General agent platform (branch `sdlc-automation`)

**Goal:** Environments per client, importable agent kits (Axian Squad first), automations built on a canvas. Detail in `REQUIREMENTS-PRODUCT.md` §9.1.

### 9.1 Axian import (B1)
- [x] Adapter reads the kit folder and README rank table; kit is not modified
- [x] Generated front matter, offline draft, platform preamble; kit passed as a readable folder
- [x] Per-agent `sources` scoping; gated agents get `needs_approval`
- [x] Team "Axian Squad" (ranks 0–7) created on import
- [ ] Live run of an imported agent against a real model (reads skill files from the kit)

### 9.2 Environments and rooms (A, B2)
- [x] One room file per sprint room; legacy `room.json` migrated once
- [x] Environments per workspace; Default holds earlier rooms
- [x] Room ids prefixed per environment so memory and DMs never mix
- [x] Custom agents and teams scoped per environment
- [x] Sidebar: environment switcher, room list, new room, new environment, save repos as default
- [ ] Active room per session, and a run lock per room (today: one active room and one run per server)

### 9.3 Builder (D)
- [x] Automation = graph; compiled to the ordered list the engine runs
- [x] Canvas: add, drag, connect, remove, per-node approval, edit saved teams
- [ ] Branches and conditions
- [ ] Swarm node (replace the fixed kickoff members)

### 9.4 Guide (F)
- [x] Help tab with first-5-minutes guide
- [x] Setup checklist with redirect URLs and scopes
- [ ] Home empty-state CTAs

---
## Phase 8 — Scale (parked)

Do not start until 0–7 are solid.

- [ ] Agent / team marketplace
- [ ] Heavy parallel coding swarms with conflict resolution
- [ ] Autonomous prod deploy without human
- [ ] Cloud-only QA against private networks
- [ ] Billing / plans

---

## Recommended next build order (remaining)

Work top to bottom; tick items in this file as you go.

1. **Manual reconnects** — Atlassian / Figma / GitHub scopes — *ops*
2. **Phase 4 polish** — real workdir code + PR URL on Jira
3. **Phase 5–6** — optional Playwright; OAuth verify DM→Approve→memory
4. **Phase 7** — mostly wired; SSO / multi-project tenancy later
5. **Phase 8** — parked until 0–7 solid

---

## Dream-app vision map (where ideas land)

| Vision idea | Phase |
| --- | --- |
| Fixed SDLC swarm (SA, Lead, QA…) | 0 |
| Setup: BRS, Figma, Jira board, many repos | 0–1 |
| Agents read those sources | 2 |
| Ask permission before comment / ticket / PR / Jenkins | 3–5 |
| Microservices coding | 4 |
| Jenkins + Chrome QA + report | 5 |
| Dedicated chat per agent + shared cache | 6 |
| Users log in, create own agents, compose teams | 7 |
| Marketplace / full autonomy | 8 (parked) |

---

## Related docs

- `project/SDLC-DESIGN.md` — SDLC swarm design
- `project/AGENTS.md` — per-project knobs (sample: Orders)
- `project/PRODUCT-PHASES.md` — shorter phase summary (see this file for the checklist)
