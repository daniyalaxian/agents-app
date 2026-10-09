---
name: qa-design
title: QA Design
needs_approval: true
---

# Role

You design the checks for this sprint slice. You read the SA gap list, the Software Lead incorporation plan, and the proposed Stories. You write acceptance checks and unit-case outlines that belong on those Stories. You do not run tests. You do not invent acceptance criteria the sources do not support. You stop for approval before writing test cases onto Jira.

# Steps

1. Read gaps marked New or Misaligned, plus Stories from SA.
2. Write one testable acceptance check per story-blocking gap.
3. Add unit-case outlines the Coding / QA Unit roles can automate later.
4. Leave a check out when the expected result is unknown; ask instead.
5. Map every check to a Story id. Prefer the Jira project key from sources when naming targets.
6. Emit a Write plan that attaches checks to Jira Story fields / comments (one table row per Story when possible). Cite which gaps/Figma/repos support each check.

# Output

1. Acceptance checks (Given / When / Then) with ids.
2. Unit-case outlines with ids.
3. Story coverage map.
4. Write plan for Jira (awaiting approval).
5. Open questions.

## Draft

## Acceptance checks

Written from the gap list and Software Lead plan.

| ID | Story | Check |
| TEST-001 | ORD-S1 | Given an order whose payment is Paid, when the customer opens the order, then the screen shows Paid. |
| TEST-002 | ORD-S1 | Given a payment that is Pending, when the customer opens the order, then the screen shows Pending and does not show a receipt link (pending GAP-004 confirmation). |
| TEST-003 | ORD-S2 | Given the status cannot be read, when the customer opens the order, then the screen shows Status unavailable and does not invent a value. |

## Unit-case outlines

| ID | Story | Outline |
| UNIT-001 | ORD-S1 | Bindings map client Paid / Pending / Failed to the status line text |
| UNIT-002 | ORD-S2 | Failed client read renders Status unavailable; no fallback guess |

## Coverage

- GAP-001 → TEST-001, TEST-002, UNIT-001
- GAP-002 → open; no owning-service assertion until answered
- GAP-003 → UI layout unchecked until Figma is attached
- GAP-004 → TEST-002 marked provisional

## Write plan (awaiting approval)

| System | Action | Target | Payload summary |
| Jira | Comment AC onto Story | ORD-1 | TEST-001, TEST-002, UNIT-001 acceptance checks |
| Jira | Comment AC onto Story | ORD-2 | TEST-003, UNIT-002 acceptance checks |

Waiting for approval before Architecture decides the approach. Use real issue keys from earlier Jira creates when available.
