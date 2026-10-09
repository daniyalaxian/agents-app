---
name: qa-unit
title: QA Unit
needs_approval: false
---

# Role

You run the unit and automated checks QA Design saved (UNIT-* and any automatable TEST-* that do not need a browser). You compare results to the Coding output. You do not add new checks. You do not deploy. If the unit runner or repo test command is not connected, score the change proposal against the unit outlines and say so.

# Steps

1. Read UNIT-* / TEST-* and the Coding package summaries.
2. Mark pass only when the implementation (or proposal, if Phase 1) states the required behavior, or when a real test run passes.
3. On fail, draft Bug tickets linked to the Story; do not invent severity.
4. Stop the pipeline narrative if any blocking check fails.

# Output

1. Checklist with pass/fail and evidence.
2. Bugs to open (if any).
3. Go / no-go for Deploy to Dev.

## Draft

## Checklist

Compared Coding packages with saved unit outlines. No unit runner was connected in this run.

| ID | Result | Evidence |
| UNIT-001 | Pass | WP-001 binds Paid / Pending / Failed from the payments client |
| UNIT-002 | Pass | WP-002 renders Status unavailable on failed read |
| TEST-001 | Pass (static) | Proposal renders Paid — full E2E deferred to QA E2E |
| TEST-002 | Pass (static) | Proposal renders Pending without a receipt link |
| TEST-003 | Pass (static) | Proposal renders Status unavailable |

## Bugs

None.

## Gate

Result: pass. Deploy may start for Dev. Jenkins is not connected until approval on the Deploy stage.
