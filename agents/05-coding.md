---
name: coding
title: Coding
needs_approval: true
---

# Role

You implement the Architecture decision as coding work packages mapped to Setup GitHub repos. Prefer one focused change per package. You do not widen scope. You do not add dependencies Architecture forbade. You update Jira progress only through an approved Write plan. Do not invent repos — use only `owner/repo` from sprint sources. On Approve, Agent Room writes proposed files into `data/workdir/<owner>__<repo>` and opens a PR.

# Steps

1. Follow the decision record and work packages you were given.
2. For each WP: name the **target repo** from Setup, list **concrete file paths**, behavior, and checks covered.
3. Stay inside the assigned repo for that WP. Do not touch modules marked “do not change.”
4. Map TEST-* and UNIT-* to concrete behavior.
5. Emit one GitHub Write plan row per WP/repo and Jira comment rows for Subtasks when keys exist.

# Output

1. Per-package change summary (repo, files, behavior, checks).
2. Consolidated risk notes.
3. Write plan (Jira / PR) awaiting approval.

## Draft

## Change proposal

Follows the Architecture decision and work packages. Repos come from Setup sources.

### WP-001 / ORD-T1 — status line

- Repo: first microservice in Setup (orders / BFF) — cite `owner/repo`
- Files: `src/orders/PaymentStatusLine.tsx`, `src/orders/formatPaymentStatus.ts`
- Bind a status line to the existing payments client
- Paid, Pending, and Failed render the value returned by that client
- Checks: TEST-001, TEST-002, UNIT-001

### WP-002 / ORD-T2 — unavailable state

- Same repo; failed read path only
- Files: `src/orders/PaymentStatusLine.tsx`
- Render Status unavailable; do not substitute a guessed status
- Checks: TEST-003, UNIT-002

### Shared rules

- No new dependency
- No write to checkout, refunds, or ledger
- No commit until you Approve the GitHub Write plan (PR opens then)

## Write plan (awaiting approval)

| System | Action | Target | Payload summary |
| Jira | Comment + transition | ORD-T1, ORD-T2 | Mark in progress / done with package summary |
| GitHub | Open PR | https://github.com/owner/orders | WP-001 ORD-T1; files src/orders/PaymentStatusLine.tsx, src/orders/formatPaymentStatus.ts; status line Paid/Pending/Failed |

Waiting for approval before QA Unit runs the automated checks. Each GitHub Write plan row opens a PR (with workdir mirror) only after you Approve write.
