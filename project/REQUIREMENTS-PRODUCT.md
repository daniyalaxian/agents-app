# Product requirements — Agentic Automation

**Status:** Draft (decisions in progress)  
**Date:** 2026-11-03  
**Product name:** **Agentic Automation**  
**Repo:** https://github.com/daniyalaxian/agents-app  
**Related:** `BUILD-ROADMAP.md`, `SDLC-DESIGN.md`, Axian `squad-agent-kit` at `D:\axian agents\squad-agent-kit`

---

## 0. Decisions locked (stakeholder)

| # | Topic | Decision |
| --- | --- | --- |
| D1 | Product name | **Agentic Automation** |
| D2 | Isolation unit naming | **Environment** (system + UI). Maps cleanly to multi-client SI work without colliding with login “workspace”. Optional subtitle in UI: “e.g. client or program”. |
| D3 | Builder + Axian | **Both in scope.** User **imports Axian** → platform **converts** the recommended pipeline into an editable **drag-and-drop automation** in our builder. Import is the on-ramp; builder is the durable editing surface. |
| D4 | Product scope | **General agent platform**, not an SDLC-only app. The SDLC flow (our 9 roles, or Axian’s 11) is **one template** among user-built automations. Importing **Axian agents** is a first-class feature. (2026-11-03) |
| D5 | First build step | Start with an **Axian import spike** (slice B, into today’s workspace catalog + a default team), *then* the environment model (slice A). The spike settles the manifest and shows what an Environment must hold (skills, cluster context, repos). Moving imported agents from workspace to environment scope later is a small migration. (2026-11-03) |

Still open: §12 Q4–Q20.

---

## 1. Vision

Build **Agentic Automation** — a reusable SI delivery platform where teams log in, work in isolated **environments** (each with its own repos and sprint context), **import or create agents** from markdown, and run them together as **swarms / automations** on a visual builder. External writes (Jira, Confluence, Figma, GitHub, Jenkins) always require **human approval**.

**One-line product:**  
> Import a toolkit (e.g. Axian Squad) into an Environment — we turn it into a runnable automation you can edit on the builder.

**Not the product:** a single hard-coded 9-agent chat that only works for one Orders demo.

---

## 2. Goals and non-goals

### Goals
1. Support **multiple concurrent client/program environments** after login.
2. Let users **import toolkits** (starting with Axian) or **create agents** by pasting MD.
3. On toolkit import, **materialize a default automation** as a **builder graph** (nodes + edges) the user can edit.
4. Let users run **multi-agent collaboration** (discussion swarm) and **delivery pipelines** on that graph.
5. Provide a **drag-and-drop automation builder** as the primary way to view/edit automations (not a late add-on).
6. Keep UX **simple** with a short **user guide** and first-run checklist.
7. Prefer **low-token / tool-capable** models by default; escalate only when needed.
8. Preserve the hard rule: **no silent external writes**.

### Non-goals (v1)
- Full marketplace billing / agent store (later).
- Fully autonomous prod deploy without human.
- Replacing Jira/Confluence/Figma as systems of record.
- Requiring users to install IDE plugins to use the platform (Cursor/Claude kit remains optional authoring source).

---

## 3. Personas

| Persona | Needs |
| --- | --- |
| **SI delivery lead** | Multiple client environments; import Axian; run sprint; approve writes |
| **System analyst / architect / QA / developer** | Run or DM their role agent; see prior outputs; approve role-specific writes |
| **Toolkit author (Axian)** | Keep agents as MD + skills in git; import/update pack into platform without rewrite |
| **Approver / SME** | Clear permission cards; deny without side effects |
| **Platform admin** (later) | SSO, org membership, cost limits |

---

## 4. Core concepts

| Concept | Definition |
| --- | --- |
| **User / workspace** | Authenticated person (and later org) who owns or joins environments |
| **Environment** | Isolated long-lived context: client/program, OAuth connections, repo list, imported toolkits, default automation |
| **Sprint room** | One delivery slice inside an environment (requirement/Jira key, sources overrides, run state, memory) |
| **Agent** | Named MD brain (instructions + optional Draft + tools + needs_approval) |
| **Toolkit** | Versioned pack of agents (+ optional skills + default automation), e.g. Axian Squad |
| **Automation** | How agents run together: sequence, collab swarm, approval gates |
| **Permission / Approve** | Human gate before any external write tool or Write-plan execution |

---

## 5. User experience (target, simple)

### 5.1 First-run happy path
1. Register / login  
2. Create or open an **Environment** (e.g. “SME TZ”)  
3. **Import toolkit** → Axian Squad (or skip and use built-in SDLC templates)  
4. Platform **converts** Axian pipeline → default automation **opened in the builder** (user can rearrange / add Approve nodes)  
5. Save automation (or keep default)  
6. **Connect** Atlassian / Figma / GitHub (checklist)  
7. Add **repos** for this environment  
8. **New sprint room** → paste requirement / key → attach BRS/Figma/board if needed  
9. **Run** automation → review outputs → **Approve / Deny** write cards  
10. Optional: open **Help / User guide**

### 5.2 Primary screens (v1)
| Screen | Purpose |
| --- | --- |
| Login | Email/password (SSO later) |
| Home | List environments; “New environment”; Help |
| Environment | Repos, connections, toolkits, automations, “New sprint” |
| Agents | Catalog: imported + custom; Create (paste MD); Duplicate |
| Automation builder | Drag-drop canvas: agent nodes, approve gates, swarm nodes; edit imported Axian graph |
| Automations | List saved graphs; “Open in builder”; “Run on sprint” |
| Sprint room | Chat / stages / group kickoff / permission cards / Setup sources |
| Help | Short guide: connect scopes, import, approve |

### 5.3 UX principles
- **Import → builder graph** is the default path (Axian lands as editable automation).  
- Empty states tell the next action (“Import Axian Squad to get started”).  
- Advanced (model tier, skills, Jenkins) behind Advanced.  
- Never bury Approve actions.

---

## 6. Functional requirements

### 6.1 Identity
| ID | Requirement | Priority |
| --- | --- | --- |
| ID-1 | User can register and login to a workspace | P0 |
| ID-2 | Session persists securely (cookie + sealed credentials) | P0 |
| ID-3 | Roles support at least member / approver / admin (even if UI is light) | P1 |
| ID-4 | SSO (optional later) | P2 |

### 6.2 Environments
| ID | Requirement | Priority |
| --- | --- | --- |
| ENV-1 | User can create multiple named environments | P0 |
| ENV-2 | Each environment has its own microservice repo list + default branches | P0 |
| ENV-3 | Each environment can store connection preferences / last-used board, Confluence space hints | P1 |
| ENV-4 | Sprint rooms are listed under an environment; switching env does not mix room state | P0 |
| ENV-5 | Soft delete / archive environment | P2 |

### 6.3 Sprint rooms
| ID | Requirement | Priority |
| --- | --- | --- |
| SPR-1 | Create sprint room with requirement text and optional Jira key | P0 |
| SPR-2 | Attach/override BRS (Confluence or paste), Figma URL, Jira board/project | P0 |
| SPR-3 | Choose which automation to run for this sprint | P0 |
| SPR-4 | Shared memory scoped to the sprint room | P1 |
| SPR-5 | Multiple sprint rooms can exist; only one “active run” per user session if needed for safety | P1 |

### 6.4 Agents
| ID | Requirement | Priority |
| --- | --- | --- |
| AG-1 | Create agent by name + paste MD body (+ needs_approval, tools) | P0 |
| AG-2 | Edit / duplicate / delete custom agents | P0 |
| AG-3 | Prebuilt template agents remain available (current SDLC set) | P0 |
| AG-4 | Agents are reusable across sprints in the same environment | P0 |
| AG-5 | Optional per-agent DM chat with same approval rules | P1 |

### 6.5 Toolkits (Axian and others)
| ID | Requirement | Priority |
| --- | --- | --- |
| TK-1 | Import a toolkit from folder/zip conforming to a documented manifest | P0 |
| TK-2 | First-party toolkit: **Axian Squad** mapped from `squad-agent-kit` | P0 |
| TK-3 | Import creates agents in the environment catalog | P0 |
| TK-4 | Import **always** creates a default automation graph from toolkit pipeline order and opens/offers it in the **builder** | P0 |
| TK-4a | Imported graph is fully editable (reorder, add/remove agents, insert Approve / swarm nodes) without losing agent catalog entries | P0 |
| TK-5 | Re-import / upgrade toolkit version with clear overwrite vs skip policy | P1 |
| TK-6 | Toolkit badge/name visible on imported agents | P1 |
| TK-7 | Skills from toolkit are either attached as libraries or folded into agent context on import | P1 |
| TK-8 | Import **converts** toolkit agent files to the platform agent format without editing the toolkit’s source files (see §7.9) | P0 |
| TK-9 | Each agent declares which **sources** it receives (BRD, Figma, repos, Jira, deploy URL…) in metadata; source scoping no longer depends on hard-coded role names (see §8.3) | P0 |
| TK-10 | Toolkit **skills and cluster folders** are given to agents as readable folders, not pasted into the prompt | P0 |
| TK-11 | Agent **mode** (e.g. DevOps `rca`, Deploy `test`) is a node property passed into the prompt | P1 |

### 6.6 Automations and multi-agent swarms
| ID | Requirement | Priority |
| --- | --- | --- |
| AU-1 | Automation stored as a **graph** (nodes + edges); linear pipeline is a special case | P0 |
| AU-2 | Collab/swarm step: multiple agents in one thread with handoff protocol | P0 (exists as kickoff; generalize) |
| AU-3 | Explicit **Human approve** step type (or inherit from agent needs_approval) | P0 |
| AU-4 | Save named automations per environment | P0 |
| AU-5 | Run automation on a sprint room with streaming progress | P0 |
| AU-6 | Visual **drag-and-drop** automation builder (primary editor) | **P0** |
| AU-6a | **Axian → builder conversion:** import pipeline ranks/modes into canvas nodes the user can edit | **P0** |
| AU-7 | Conditions / branches (e.g. skip deploy if QA fail) | P2 |
| AU-8 | Version and share automations across environments | P2 |

### 6.7 Approvals and tools
| ID | Requirement | Priority |
| --- | --- | --- |
| AP-1 | No Jira/Confluence/Figma/GitHub/Jenkins write without Approve | P0 |
| AP-2 | Permission cards show system, action, target, payload | P0 |
| AP-3 | Deny leaves no external side effect | P0 |
| AP-4 | Runtime tool-ask gate for live Cursor local runs | P1 (**exists**) |
| AP-5 | Prefer cheap tool-capable model; writes executed by platform code after Approve | P0 |

### 6.8 Integrations
| ID | Requirement | Priority |
| --- | --- | --- |
| IN-1 | Atlassian OAuth: Confluence read/comment, Jira read/write (scoped) | P0 |
| IN-2 | Figma OAuth or PAT: read file/frames; comment on Approve | P0 |
| IN-3 | GitHub OAuth: multi-repo PR on Approve | P0 |
| IN-4 | Optional Jenkins trigger + smoke callback | P1 |
| IN-5 | Local code workspace snapshots for agent read (no silent edits to user working copy) | P1 |

### 6.9 Cost / model policy
| ID | Requirement | Priority |
| --- | --- | --- |
| CO-1 | Default runtime uses lowest-cost tool-capable model available to the deployment | P0 |
| CO-2 | Optional “high reasoning” toggle per automation or node | P1 |
| CO-3 | Draft/offline mode remains available without API key | P0 |
| CO-4 | Skills/context loaded on demand to reduce tokens | P1 |

### 6.10 Help and guidance
| ID | Requirement | Priority |
| --- | --- | --- |
| HG-1 | In-app Help with first 5 minutes guide | P0 |
| HG-2 | Setup checklist for OAuth scopes (Atlassian, Figma, GitHub) | P0 |
| HG-3 | Empty-state CTAs on Home / Environment | P0 |

---

## 7. Axian Squad toolkit (detailed)

### 7.1 Source
Local kit: `D:\axian agents\squad-agent-kit`  
Structure:
- `.ai/agents/<Role>/<Name>Agent.md` — 11 agents  
- `.ai/skills/` — 62 markdown files: one core skill per role (`<role>.md`) + nested skills in `<role>/` folders (POC-owned); tree in `.ai/skills/README.md`  
- `.ai/cluster/` — Telecom / DnF / CLMS project context  
- `AGENTS.md` — pipeline rules, standalone behaviour, approval rules  
- `LOCAL.md` (not committed) — per-person key/intent (maps to Sprint room fields)  
- IDE commands under `.cursor/commands` / `.claude/commands` — **not** required on the platform (automations replace them)

### 7.2 The eleven agents

| Rank | Agent | Role folder | Purpose | Typical outputs (kit) | External after approved |
| --- | --- | --- | --- | --- | --- |
| 0 | `DesignAgent` | UiUxDesigner | Stage 0 design / handoff / design-qa | `00-design.md` | Figma/Jira/Confluence design notes |
| 1 | `RequirementAgent` | SystemAnalyst | Gate 1 gaps, CL items | `01-requirement.md` | Confluence BRD comments, Figma comments, Jira comments |
| 2 | `ArchitectAgent` | SolutionArchitect | Gate 2 SD + Gate 3 API | `02-solution-design.md` | Confluence SD/API; Jira tech tasks |
| 3 | `TestDesignAgent` | QA | Gate 4 test pack | `03-test-design.md` | Confluence test plan; optional Jira |
| 4 | `StoryAgent` | SystemAnalyst | G5 stories | `04-stories.md` | Jira stories |
| 5 | `DeveloperAgent` | Developer | Code, tests, PR | `05-development.md` | Branch/PR |
| 6 | `DeployAgent` | Developer | Deploy Dev/Test | `06-deploy.md` | Pipeline trigger |
| 7 | `TestExecutionAgent` | QA | Execute on Test | `07-qa-execution.md` | Defects in Jira |
| 8 | `DevOpsAgent` | DevOps | On-demand ops modes | `08-devops.md` / incidents | Controlled ops actions |
| 9 | `PmAgent` | ProjectManager | Worklog/billing/weekly/… | `docs/pm/<period>/` | Decks/PDFs (human send) |
| 10 | `AuditorAgent` | Auditor | Read-only audits | `docs/audit/<period>/` | Findings only; no other writes |

**Modes (examples):**  
- DesignAgent: `design` · `handoff` · `design-qa`  
- DeployAgent: `dev` · `test`  
- DevOpsAgent: `rca` · `logs` · `release` · `incident` · `scaling` · `pipeline` · `k8s` · `observability` · `security`  
- PmAgent / AuditorAgent: mode per deliverable  

Platform should store **mode** on automation nodes when relevant.

### 7.3 Axian behavioural rules to preserve on import
1. **Standalone by default** — missing prior outputs do not hard-block; agent uses Jira → Confluence → Figma → code → user chat; lists Sources / Assumptions.  
2. **Hard stops only:** external write without approved; required tool not connected; required repo missing.  
3. **Cite sources; never invent requirements.**  
4. **External prose** should read as the person wrote it (no “AI / agent / gate” leakage in customer-facing comments) — platform should coach this in prompts.  
5. **Skills load on demand** — core skill then nested skills from tables; do not dump all 50 nested skills into every run.  
6. **Recommended pipeline** is guidance; automations encode the recommended path as a default template.

### 7.4 Default Axian automation (recommended import)

```
[optional DesignAgent]
  → RequirementAgent → [Human approve writes]
  → ArchitectAgent → [Human approve writes]
  → TestDesignAgent
  → StoryAgent → [Human approve Jira]
  → DeveloperAgent → [Human approve PR]
  → DeployAgent → [Human approve job]
  → TestExecutionAgent
```

Side automations (not on main path): DevOpsAgent, PmAgent, AuditorAgent — available as separate templates or single-agent runs.

### 7.5 Mapping Axian → platform objects

| Axian | Platform |
| --- | --- |
| `LOCAL.md` Key + Intent | Sprint room requirement + Jira key |
| BRD/Figma links | Sprint Setup sources |
| Code root + repos | Environment repos + `CODE_WORKSPACE` |
| Agent `.md` file | Catalog agent (imported) |
| Core + nested skills | Toolkit skill pack / on-demand packet sections |
| Pipeline ranks | Default automation graph |
| “approved” | Permission cards / Approve nodes |
| `docs/requirements/<KEY>/…` | Sprint artifacts (chat outputs + optional export later) |
| Cluster/project MD | Environment profile (future) |

### 7.6 Toolkit manifest (proposed)

```yaml
id: axian-squad
name: Axian Squad
version: "1.0.0"
agents:
  - file: .ai/agents/SystemAnalyst/RequirementAgent.md
    name: RequirementAgent
    needs_approval: true
automations:
  - id: axian-brd-to-code
    name: Axian BRD→Code
    steps: [DesignAgent?, RequirementAgent, ArchitectAgent, ...]
skills_root: .ai/skills
```

Exact schema TBD after import spike. The Axian kit has **no manifest file**, so Axian is imported by a **first-party adapter** that reads the folder layout and the rank table in `.ai/agents/README.md`. The manifest is for third-party toolkits.

### 7.7 Axian agent file format (observed in the kit)

Axian agent files do **not** match our agent format, so import must convert them, not copy them.

| | Our agents (`agents/*.md`) | Axian agents (`.ai/agents/<Role>/<Name>Agent.md`) |
| --- | --- | --- |
| Header | Front matter: `name`, `title`, `needs_approval` (loader rejects files without it) | None. `# <Name> (<Role> · rank N · Gate N)` heading + “At a glance” table (rank, run by, skills, inputs, output, next) |
| Offline output | Required `## Draft` section (loader rejects files without it) | None |
| Context | The platform builds a packet (requirement, project file, sources, prior outputs, memory) | The agent is told to load files itself, in a fixed order: `LOCAL.md` → agent file → core skill → cluster file → project file → BRD/Figma/Jira/code |
| First action | — | “Tool check”; stop if a tool is not connected |
| Output | Chat reply (+ `## Write plan` table for external writes) | A file: `docs/requirements/<KEY>/NN-<name>.md` |
| Approval | Stage gate (`needs_approval`) + one permission card per write | The person types **“approved”**; **each** external action needs its own approval |
| Names | kebab-case (`software-lead`) | PascalCase, called by exact name (`RequirementAgent`) |
| Size | ~50–150 lines | 15–73 lines each, but rely on skill files for depth |

### 7.8 Per-agent import profile

From the kit’s own rank table. “Sources” = what the platform must feed the agent (TK-9); “Code” = repo access.

| Rank | Agent | LOCAL.md fields used | Sources the platform must give it | Code | Skills folder | Platform gap today |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | DesignAgent | Key, BRD/PRD link, Mode, Figma library link | BRD, Figma, project + cluster file; for `design-qa`: `05` output + Test build URL | — | `uiux-designer/` | none for `design`; Test-build screenshots partial |
| 1 | RequirementAgent | Key, BRD/PRD link, Figma link | BRD, Figma, `00`, Jira + Confluence history | read | `system-analyst/` | Jira history read |
| 2 | ArchitectAgent | Key | `01`, Confluence SD/API pages | read + measure | `solution-architect/` | baseline metrics |
| 3 | TestDesignAgent | Key | `01`, `02` (Gate 3), Figma | — | `qa/` | — |
| 4 | StoryAgent | Key | `01`–`03`, existing Jira stories | — | `system-analyst/` | Jira stories read |
| 5 | DeveloperAgent | Key, Code root, Track | `04`, `02`, Figma, API signature | **write** (platform: snapshot read + PR on Approve) | `developer/` by track | write is PR-only on platform |
| 6 | DeployAgent | Key, Mode (`dev`·`test`) | `05`, pipeline + cluster (read-only) | — | `developer/` | cluster read |
| 7 | TestExecutionAgent | Key | `03`, `06`, Test environment URL | — | `qa/` | — |
| 8 | DevOpsAgent | Key or INC id, Mode, Period | logs, metrics, cluster, pipeline, `06` | — | `devops/` by mode | metrics/cluster read; only `DEVOPS_LOG_PROBE_URL` today |
| 9 | PmAgent | Projects, Mode, Period | Jira worklogs/issues/versions, requirement folders, rate card | — | `pm/` by mode | Jira worklog read; deck/PDF output |
| 10 | AuditorAgent | Projects, Mode, Period | Jira, git history, requirement + incident folders, PM outputs, Confluence | read (history) | `auditor/` by mode | git history read |

Ranks 0–7 are the **v1 import target**. Ranks 8–10 import as catalog agents and run with whatever sources exist, listing missing ones as gaps (Axian “standalone by default” rule).

### 7.9 Conversion rules (import adapter)

1. **Do not edit the toolkit’s files.** Keep the Axian agent text as-is (Toolkit author persona: “import without rewrite”). Add platform behaviour through a **toolkit adapter preamble** put before the agent text in the prompt.
2. **Front matter is generated** per agent: `name` (slug of the file name, e.g. `requirement-agent`; exact Axian name kept as display/alias), `title` (`RequirementAgent — System Analyst`), `needs_approval`, `tools`, `toolkit: axian-squad`, `toolkit_version`, `rank`, `sources` (from §7.8), `skills` (folder from §7.8).
3. **Offline Draft is generated** from the agent’s Scope section headings, marked as an offline placeholder, so draft mode still runs end-to-end.
4. **Adapter preamble** tells the agent:
   - the `LOCAL.md` fields (Key, BRD/PRD, Figma, Intent, Mode, Period, Track) are in the sprint room’s Requirement and Setup fields — do not look for `LOCAL.md`;
   - prior outputs (`00`–`07`) are in “Earlier role outputs”; missing ones mean work standalone;
   - the skills and cluster folders are readable at the given paths — load the core skill, then only the nested skills its table names;
   - write the output **as the chat reply** (the content of `NN-<name>.md`), not to a file;
   - “approved” = the platform’s Approve button; propose each external action as its own write (runtime tool or Write plan row).
5. **Skills + cluster folders** are passed to the agent as readable folders (same mechanism as code snapshots), never pasted into the prompt (TK-10, CO-4).
6. **Default automation** = §7.4, built from the rank table. Stage gates (pause for review) go where §7.4 shows `[Human approve …]`; per-action approvals stay on permission cards.
7. **Modes** become a node property (TK-11) and are added to the prompt as `Mode: <value>`.
8. **Customer-facing text rule** (§7.3.4) is kept in the preamble; enforcement level is Q14.

### 7.10 Import spike — scope and acceptance (slice B, step 1)

Scope: import from a **folder path on the server machine** (the kit is local); zip/git import later (Q17). Imports into today’s **workspace** catalog and creates an “Axian Squad” team in rank order 0–7.

Accepted when:
- All 11 agents appear in the catalog with a toolkit badge; the kit folder is unchanged.
- The Axian team runs end-to-end in **draft mode**.
- RequirementAgent’s packet contains BRD, Figma and repos; TestDesignAgent’s does not contain the BRD (scoping by metadata, TK-9).
- Skills appear as a readable folder, not as prompt text; prompt size stays within a set budget.
- `npm run check` gains checks for the above, and still finds no credentials in prompts.

---

## 8. What exists today vs gaps (baseline)

### Already in agents-app (engine)
- Room pipeline, streaming UI, MD agents, teams  
- Login/workspace (basic), custom agent catalog  
- OAuth Atlassian/Figma/GitHub; permission cards; runtime tool gate  
- Group kickoff swarm + handoff  
- Memory, DMs, Jenkins smoke, code snapshots, design annotate  

### Missing for this requirements doc
- Multi-environment model  
- Toolkit import (Axian pack) **→ builder graph conversion**  
- Productized **drag-drop** automation builder (now P0)  
- Multi sprint-room inventory under an env  
- Simplified Home UX + user guide  
- Formal cost/model policy UX  
- Toolkit versioning / upgrade  

### 8.3 Engine constraints that block import / environments (found 2026-11-03)
| Constraint today | Where | Why it matters | Fix (slice) |
| --- | --- | --- | --- |
| Agent loader requires front matter **and** a `## Draft` section | `src/agents.ts` `parseAgent` | Raw Axian files are rejected | Import generates both (§7.9) — B |
| Source scoping is by **hard-coded role name** (`sa`, `software-lead`, `architecture`, `coding`) | `src/server.ts` `loadSourcesForRole` | Imported agents would get **no** BRD/Figma/repo sources | Per-agent `sources` metadata (TK-9) — B |
| Group kickoff members are fixed (`sa`, `software-lead`, `qa-design`) | `src/group.ts` `DEFAULT_MEMBERS` | Axian users get no group discussion | Swarm node with chosen members — E |
| Custom agents are scoped by **workspace** | `data/custom-agents/<workspaceId>/` | AG-4 wants environment scope | Migrate with slice A (D5) |
| **One room** per server | `data/room.json` | No multiple sprint rooms / environments | Store change — A |
| **One run per server** (global `busy` flag) | `src/server.ts` | A second user in another environment is blocked | Per-room run lock — A |
| Prompt always says “do not create files” and expects a chat reply | `src/runner.ts` `buildPrompt` | Axian agents expect to write `docs/requirements/…` | Adapter preamble: output = chat reply (§7.9.4); export is Q9 |

---

## 9. Proposed delivery slices

| Slice | Outcome |
| --- | --- |
| **A – Product shell** | Environments + multi sprint rooms + simplified Home |
| **B – Toolkit import** | Import Axian Squad → agents + **default automation graph** |
| **C – Create agent UX** | Paste-MD create/edit polished |
| **D – Builder (P0)** | Drag-and-drop canvas; edit imported Axian graph; Approve / agent / swarm nodes |
| **E – Swarm as node** | Kickoff collab as reusable automation step on canvas |
| **F – Guide** | In-app help + OAuth checklist |
| **G – Cost defaults** | Cheap tool model default + high-reasoning toggle |
| **H – Branches** | Conditions / skip paths (later) |

Recommended build order: **B (import spike) → A → B (finish: environment scope) → D → F → C → E → G → H**  
(D5: the import spike runs first on today’s workspace catalog; then environments; then import moves to environment scope. Import and builder land early so Axian conversion is real, not a stub list.)

Builder note: automations are stored as a **graph** from the first slice (AU-1), even while early UI shows them as a list, so the drag-and-drop canvas (D) is a new view of the same data, not a migration.

---

## 10. Risks and constraints

| Risk | Mitigation |
| --- | --- |
| Company laptop cannot install tools | Prefer browser + portable git; no mandatory MSI |
| Token cost explosion with full Axian skills | On-demand skill load; short packets |
| OAuth scope confusion | Checklist + Disconnect/Connect guidance |
| Mixing client data | Environment isolation as P0 |
| Builder complexity kills adoption | Import lands a ready-made graph; builder starts from that, not blank canvas |
| Imported agents silently get no sources (role-name scoping) | Per-agent `sources` metadata (TK-9) + walkthrough check |
| Axian kit changes break the adapter (no manifest, format by convention) | Adapter reads the rank table + folder layout; import report lists anything it could not map; pin `toolkit_version` |
| Ranks 8–10 need data we cannot read yet (Jira worklogs, git history, metrics) | Import them, run standalone, list missing sources as gaps; add read integrations later |
| “Never mention AI” in customer-facing text vs. client AI-disclosure policies | Decide Q14; always keep an **internal** audit trail (approved by whom, proposed by which agent) whatever the outbound text says |

---

## 11. Success criteria (discussion)

1. Axian user imports Squad in &lt; 5 minutes and runs default automation on a sample key.  
2. SI lead maintains ≥2 environments without cross-talk of repos/memory.  
3. Zero external writes without an Approve click in walkthrough + manual test.  
4. A first-time tester completes the §5.1 happy path to the first Approve **in under 15 minutes using only in-app Help** (measured in a usability session; target time to confirm).

---

## 12. Open questions for stakeholder

### Resolved
1. **Official product name?** → **Agentic Automation**  
2. **Environment naming?** → **Environment**  
3. **Builder vs import?** → **Both.** Import Axian → convert to our **drag-and-drop builder** graph.

### Still need answers

#### Axian import
4. On import, should we import **skills as separate library**, or **merge skill text into each agent** for simplicity?  
5. Include **PmAgent** and **AuditorAgent** in the default BRD→Code automation, or only as optional side templates?  
6. Should **DesignAgent** be on the default path, or optional first node?  
7. Do you want **cluster/project MD** (Telecom/YAS…) imported into Environment profile in v1, or later?

#### Tenancy and data
8. Are environments **personal only** in v1, or **shared within a company workspace**?  
9. Where should sprint artifacts live long-term: only in UI/memory, or also export files like Axian `docs/requirements/<KEY>/`?

#### Runtime / cost
10. Default engine for product demo: **Cursor local**, **cloud**, or **draft** when no key?  
11. Confirm: **Approve executors stay in platform code** (current design), not “agent clicks the API itself” without gate?

#### UX
12. Who may edit automations: **all users**, or **admin/lead only**?  
13. Preferred Home empty state CTA: **Import Axian** or **Create environment** first?

#### Compliance
14. Customer-facing Jira/Figma/Confluence comments must **never** mention AI/agents (Axian rule) — enforce in prompts only, or also filter outbound text?

#### New (from import analysis, 2026-11-03)
15. Are agents, toolkits and OAuth connections owned by the **workspace** or by the **environment**?  
16. Imported agent names: platform slug (`requirement-agent`) with the Axian name as display alias, or keep `RequirementAgent` as the id?  
17. Import source for v1: **folder path on the server** only, or also **zip upload** / **git URL**?  
18. Ranks 8–10 (DevOps, PM, Auditor): import in v1 as catalog agents with known source gaps, or hold until the read integrations exist?  
19. Re-import when the kit changes: overwrite agents the user has edited, keep them, or ask per agent?  
20. Should the stage gates in the default Axian automation (§7.4) be on by default, or rely only on per-action permission cards?

### Proposed answers (for discussion, not locked)
| Q | Proposal | Why |
| --- | --- | --- |
| 4 | Skills as a **separate library**, given as a readable folder | Keeps prompts small (CO-4); toolkit stays upgradeable |
| 5 | PM + Auditor as **separate templates**, off the main path | Matches the kit (“standalone, any time”) |
| 6 | DesignAgent as an **optional first node**, off by default | Most sprints start from an existing design |
| 7 | **Later**; v1 lets the person paste cluster text into the environment profile | Avoids a second import format in v1 |
| 8 | **Personal** in v1, but store `ownerId` so sharing needs no migration | Smallest safe start |
| 9 | UI/memory in v1; **export** to `docs/requirements/<KEY>/` as a later button | Axian users can keep their file trail |
| 10 | **Draft** when no key; **Cursor local** for demos | Local runs support runtime approvals |
| 11 | **Yes — lock it**: executors stay in platform code | AP-1 and AP-3 depend on it |
| 12 | **Leads/admins edit**, members run | Protects shared automations |
| 13 | **Create environment** first, then “Import Axian” as the next step | Import needs an environment to land in |
| 14 | Prompt rule + **internal audit trail always kept**; outbound filter optional | Transparency stays internal even if outbound text is plain |
| 15 | **Environment** owns agents, toolkits, repos; **user** owns OAuth tokens | Client isolation (ENV-4) |
| 16 | Slug id + Axian name as alias | Fits existing catalog naming |
| 17 | **Folder path** in v1 | The kit is local; zip/git later |
| 18 | **Import all 11**, mark source gaps | Standalone rule makes them usable |
| 19 | **Ask per edited agent**; overwrite unedited ones | No silent loss of user edits |
| 20 | **On** by default where §7.4 shows them | Same human control the kit expects

---

## 13. Document history

| Date | Change |
| --- | --- |
| 2026-11-03 | Initial draft from product discussion + Axian kit review + current agents-app capabilities |
| 2026-11-03 | Locked D1–D3: name **Agentic Automation**, term **Environment**, Axian import → drag-drop builder conversion; elevated builder to P0; reordered slices |
| 2026-11-03 | D4 general platform, D5 import spike first; §7.7–7.10 Axian format, per-agent profile, conversion rules, spike acceptance; TK-8–11; §8.3 engine constraints; risks; measurable success 4; Q15–Q20 + proposed answers |
