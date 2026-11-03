# Project

- Name: Tigo SME Business Suite: Growing Together (Tanzania)
- Market: Tanzania (Tigo). Use Tanzania reference data (regions, phone rules) from the BRS.
- Jira project key: SMETZ (board 4887)
- Confluence space: SIB (BRS lives here: "BRS_Growing_Together", version to be confirmed)
- Figma file: "SME Business suite (Charté YAS)". Tanzania designs are under TANZANIA → Growing Together (node 13321:27679). TOGO and SENEGAL pages are other markets.
- Repositories: set per sprint in Setup (currently `AxianGroupSF/TZ-Tigo-SME-Web`, the web UI)
- Pipeline design: see `project/SDLC-DESIGN.md`
- Full roadmap: see `project/BUILD-ROADMAP.md`

## Environment ladder

1. Dev
2. Testing
3. Preprod
4. Prod

## Jenkins (fill per project)

- Deploy job name: not set yet (ask the person; do not assume one)
- Smoke callback path: `/api/jenkins/smoke` (Phase 5)
- Smoke auth: `JENKINS_SMOKE_TOKEN` in server `.env`

## Secrets (names only — values in `.env` / credential store)

- `ATLASSIAN_CLIENT_ID` / `ATLASSIAN_CLIENT_SECRET`
- `FIGMA_CLIENT_ID` / `FIGMA_CLIENT_SECRET`
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
- `CURSOR_API_KEY` (optional; draft mode without it)
- Test login for QA E2E: `QA_TEST_USER` / `QA_TEST_PASSWORD` / optional `QA_LOGIN_PATH` in `.env` — never in chat
- Optional Playwright on agent host for real Chrome E2E
- Optional `DEVOPS_LOG_PROBE_URL` for DevOps health

## Sprint model

Work runs sprint by sprint. Each room is one feature or change slice inside a sprint.

Jira hierarchy every role must respect:

1. Epic
2. User story
3. Subtask
4. Bug

## Sources of truth

1. The requirement in this room
2. Confluence BRS (when loaded)
3. Figma frames (when connected)
4. GitHub repos listed for this room
5. Jira project/board set in Setup
6. Saved outputs from earlier roles
7. Human notes and approvals in the room

## Rules for every role

- If a source does not contain the answer, record a gap and ask. Do not invent a business or technical requirement.
- Cite the source of every finding (Confluence title, Figma frame name, repo `owner/repo`, or Jira key).
- Do not write to Jira, Confluence, Figma, GitHub, or Jenkins until a person approves the Write plan / permission card.
- When you need a write-back, emit a **Write plan** table: system, action, target id/url, and exact payload summary.
- The next role receives your saved output, not your tool logs.
- Stay inside your role. Do not do the next role's job.
- Environments follow the ladder above. Never skip a promotion gate the Deploy role defined.

## Connections

- Confluence: read for System Analyst and Software Lead when a page URL is set
- Figma: read structure for SA / Lead when file URL is set
- GitHub: repo list for SA / Lead / Architecture / Coding (no commits until approved)
- Jira: project key from Setup; creates only after approval (Phase 3+)
- Jenkins: gated by approval (Phase 5)
- Chrome / browser: QA E2E on agent host (Phase 5)
- Logs: DevOps when connected (Phase 5+)

## New project checklist

1. Copy this file and set Name, Jira key, Confluence space, Jenkins job names
2. Set OAuth client ids/secrets in `.env`
3. Enable scopes in Atlassian / Figma / GitHub developer consoles
4. Run the app → Setup → Connect accounts
5. Paste BRS, Figma URL, Jira board/key, add microservice repos
6. Set the room requirement → Start swarm
