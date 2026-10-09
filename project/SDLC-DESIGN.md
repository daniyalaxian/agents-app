# SDLC Agent System — Design

Owner: SME Lead  
Status: proposed  
Goal: automate the sprint SDLC with Cursor agents, human approval at write-back and deploy gates.

---

## 1. What exists today

| Piece | Status | Notes |
| --- | --- | --- |
| Linear room pipeline | Exists | Agents loaded from `agents/*.md`, run in filename order |
| Human approval gates | Exists | `needs_approval` in front matter |
| Packet handoff | Exists | Next role gets prior outputs + project file, not tool logs |
| Confluence BRS load | Partial | Wired for SA in walkthrough; Figma/repo not connected |
| Gap analysis (SA) | Draft only | Finds gaps; does **not** create Jira or write Confluence/Figma |
| QA Design | Draft only | Given/When/Then checks; does **not** attach to tickets |
| Architecture | Draft only | Decision record; no coding work-packages / fan-out |
| Coding | Draft only | Change **proposal** only; no repo edits, no multi-agent |
| QA Run | Draft only | Checklist vs proposal; no unit runner, no browser |
| Deploy | Draft only | Jenkins note; does not start jobs |
| DevOps | Draft only | Health narrative; no log source |
| Environments | Missing | No Dev / Testing / Preprod / Prod ladder |
| Jira hierarchy | Missing | No Epic → Story → Subtask → Bug model |
| Software Lead role | Missing | Existing-flow review not a stage |
| Browser E2E | Missing | Chrome not connected |
| Write-back policy | Weak | “Do not write until approved” but roles never prepare write payloads |

---

## 2. Target operating model (sprint)

```
Sprint kickoff (human)
        │
        ▼
┌───────────────────┐
│ 1. System Analyst │  BRS (Confluence) + Figma + repo
│                   │  → gaps → human review
│                   │  → comments on Confluence/Figma (approved)
│                   │  → Epic / Stories / Subtasks in Jira (approved)
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ 2. Software Lead  │  BRS + Figma + existing flows
│                   │  → sprint incorporation plan
│                   │  → what must not break
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ 3. QA Design      │  From gaps + stories
│                   │  → acceptance + unit cases
│                   │  → write test cases onto Jira tickets (approved)
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ 4. Architecture   │  Approach + module boundaries
│                   │  → work packages for coding agents
│                   │  → Jira technical subtasks / links (approved)
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ 5. Coding         │  Fan-out: one agent per work package
│                   │  → PRs / commits against stories
│                   │  → update Jira status / flow comments
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ 6. QA Unit        │  Run unit / automated checks from stories
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ 7. Deploy         │  Jenkins → env ladder (Dev → Testing → Preprod → Prod)
│                   │  human approval per promotion
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ 8. QA E2E         │  Chrome / browser against deployed URL
│                   │  evidence back into Jira
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ 9. DevOps         │  Log / health signals for that env
│                   │  report only (no silent rollback)
└───────────────────┘
```

---

## 3. Design improvements (why this is better)

1. **SA owns requirements truth, not just a gap list**  
   Gaps become actionable: Confluence/Figma annotations + Jira backlog, only after human approval.

2. **Software Lead is explicit**  
   Separates “what the business asked” (SA) from “how this fits the live product” (Lead). Prevents architecture from inventing product constraints.

3. **QA Design before Architecture**  
   Tests are derived from accepted gaps/stories, so Architecture and Coding build to measurable checks, not vibes.

4. **Architecture outputs work packages**  
   Coding becomes a controlled fan-out (multiple coding agents), each mapped to a Jira subtask, instead of one opaque “propose something” step.

5. **Split QA Unit vs QA E2E**  
   Unit runs against the change early; browser runs against a real env URL after Jenkins. Different tools, different failure modes.

6. **Environment ladder is first-class**  
   Deploy is not “one Jenkins note.” It is promote-with-approval across Dev → Testing → Preprod → Prod, with QA E2E + DevOps after each promotion that matters.

7. **Write-back is gated and payload-shaped**  
   Every role that touches Jira / Confluence / Figma / Jenkins produces a **Write plan** the human approves. Agents do not invent silent side effects.

8. **No invented requirements**  
   Kept from the current system: if a source lacks the answer, record a gap and ask. Cite every finding.

---

## 4. Connections (phased)

| System | Phase 1 (now) | Phase 2 | Phase 3 |
| --- | --- | --- | --- |
| Confluence BRS | Read for SA (+ Lead) | SA comment drafts applied on approve | Gap sync both ways |
| Figma | Link / frame ids in packet | Comment drafts on approve | Design token checks |
| Jira | Story drafts in agent output | Create Epic/Story/Subtask on approve | Status transitions + bugs |
| Repo | Read-only context for SA/Lead/Arch/Coding | Coding agents open PRs | Auto-link commits to stories |
| Jenkins | Deploy note only | Trigger Dev job on approve | Full ladder + smoke callbacks |
| Chrome | Off | QA E2E against Dev/Testing | Preprod/Prod smoke |
| Logs | Narrative checks | Wire log query for DevOps | Alert thresholds |

---

## 5. Jira model

```
Epic          (sprint / theme — created by SA after approval)
 └─ Story     (user-visible outcome; AC + QA Design tests attached)
     ├─ Subtask (coding work package from Architecture)
     ├─ Subtask (QA unit automation, optional)
     └─ Bug     (opened by QA Unit / QA E2E on fail)
```

Rules:

- SA creates Epic + Stories from accepted gaps marked **New** or **Misaligned**.
- Architecture adds technical Subtasks; does not rewrite story AC.
- QA Design writes AC / test cases onto Stories; does not invent AC without a source.
- Coding agents work one Subtask at a time and comment progress on that ticket.
- Failed QA opens Bugs linked to the Story; pipeline narrative stops for that path until human decides.

---

## 6. Approval gates

| Role | Approve before… |
| --- | --- |
| System Analyst | Posting Confluence/Figma comments; creating Jira Epic/Stories |
| Software Lead | Treat incorporation plan as binding for Architecture |
| QA Design | Writing test cases onto Jira tickets |
| Architecture | Creating technical subtasks / finalizing work packages |
| Coding | Merging / marking stories ready for QA Unit (per org policy) |
| Deploy | Starting or promoting any Jenkins job |
| QA Unit / QA E2E / DevOps | No gate by default (report); human decides on fail |

---

## 7. Environment ladder

| Env | Who deploys | Who tests | Who watches logs |
| --- | --- | --- | --- |
| Dev | Deploy agent | QA Unit (+ light E2E optional) | DevOps |
| Testing | Deploy agent (after Dev green) | QA E2E (Chrome) | DevOps |
| Preprod | Deploy agent (human required) | QA E2E smoke | DevOps |
| Prod | Deploy agent (human required) | Minimal smoke | DevOps |

Promotion rule: do not advance env if QA Unit (Dev) or QA E2E (Testing+) failed unless a human overrides in the room.

---

## 8. Agent contracts (inputs → outputs)

| Role | Must read | Must produce |
| --- | --- | --- |
| SA | Requirement, Confluence BRS, Figma (when connected), repo skim | Gap list; clarification questions; **Write plan** (Jira + Confluence/Figma) |
| Software Lead | BRS, Figma, repo flows, SA gaps | Incorporation plan; blast-radius; open product risks |
| QA Design | Gaps + Stories | Checks (Given/When/Then + unit case ids); **Write plan** for Jira test fields |
| Architecture | Gaps, Lead plan, checks | Decision record; work packages; **Write plan** for technical subtasks |
| Coding | Decision + packages | Per-package change summary; files touched; Jira progress comments; PR refs |
| QA Unit | Checks + coding output | Pass/fail matrix; bugs to open |
| Deploy | Last green QA | Jenkins job, env, smoke callback, room id |
| QA E2E | Checks + deploy URL | Browser evidence; pass/fail; bugs |
| DevOps | Deploy note + QA results | Health report; signals only; no silent rollback |

---

## 9. Coding fan-out

Architecture produces:

```
WP-001 | ORD-123 | order-detail-status-line | files: ...
WP-002 | ORD-124 | payments-client-bind     | files: ...
```

Room behavior (target):

1. Coding stage expands to N coding agent runs (one per WP).
2. Each run is scoped to that package and must not widen scope.
3. Stage completes when all packages are done or one fails (then stop + report).

Until fan-out is implemented in the runner, the Coding agent emits the package plan and a single consolidated proposal (Phase 1).

---

## 10. Non-goals (keep the system honest)

- Agents do not invent business rules missing from BRS/Figma/human notes.
- Agents do not write to external systems without an approved Write plan.
- DevOps does not restart or roll back without a human.
- Coding does not add dependencies Architecture did not allow.
- QA does not add checks that have no source in gaps/stories.

---

## 11. Mapping: old files → new files

| Old | New |
| --- | --- |
| `01-system-analyst.md` | Expanded SA (gaps + write plans) |
| _(missing)_ | `02-software-lead.md` |
| `02-qa-design.md` | `03-qa-design.md` |
| `03-architecture.md` | `04-architecture.md` |
| `04-coding.md` | `05-coding.md` (multi-package aware) |
| `05-qa-run.md` | `06-qa-unit.md` |
| `06-deploy.md` | `07-deploy.md` (env ladder) |
| _(missing)_ | `08-qa-e2e.md` |
| `07-devops.md` | `09-devops.md` |

---

## 12. Next build steps (engineering)

1. Keep this design + agent markdown as the source of truth for role behavior.
2. Extend packet sources: Confluence for SA + Software Lead; Figma frames when connected; repo context for Lead/Arch/Coding.
3. Add Write-plan executor behind approval (Jira, Confluence, Figma, Jenkins).
4. Implement coding fan-out from Architecture work packages.
5. Wire Chrome for QA E2E and log queries for DevOps.
6. Model env promotion as repeated Deploy → QA E2E → DevOps cycles with stored env state in the room.
