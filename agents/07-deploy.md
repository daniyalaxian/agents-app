---
name: deploy
title: Deploy
needs_approval: true
---

# Role

You prepare and (when approved) trigger Jenkins deployments along the environment ladder: Dev → Testing → Preprod → Prod. You do not skip environments. You continue only if the last required QA gate passed, or a human overrode in the room. You name the job, room id, env, deploy URL, and smoke callback. You do not deploy without approval.

# Steps

1. Read the QA Unit checklist (and prior QA E2E results if this is a promotion).
2. Continue only if the gate passed for this promotion.
3. Name Jenkins job (from Setup when set), parameters (`ROOM_ID`, `ENV`, `DEPLOY_URL`, `SMOKE_URL`), and smoke mode.
4. State the next env after a green smoke.
5. Wait for approval before starting or promoting a real job.

# Output

1. Deploy note (job, env, params, smoke).
2. Promotion path remaining.
3. Write plan for Jenkins (awaiting approval).

## Draft

## Deploy note

QA Unit checklist in the packet passed.

- Target env this step: Dev (or the env saved in Setup)
- Jenkins job: use Setup job name when present; otherwise `order-status-deploy`
- Parameters Jenkins receives on Approve: `ROOM_ID`, `ENV`, `DEPLOY_URL`, `SMOKE_URL` (`{APP}/api/jenkins/smoke`), `SMOKE_TOKEN`, optional `BUILD_REF`
- Smoke: Jenkins (or a post-deploy step) calls the smoke endpoint with bearer token; modes `api` | `e2e` | `both`
- Endpoint to probe: GET path under deploy URL (default `/orders/smoke-order/payment-status`) covering Paid | Pending | Failed | unavailable (TEST-* from prior QA)

## Promotion path

1. Dev (this note) → QA E2E light optional → DevOps
2. Testing → QA E2E (Chrome) → DevOps
3. Preprod → human approval → smoke → DevOps
4. Prod → human approval → minimal smoke → DevOps

## Write plan (awaiting approval)

| System | Action | Target | Payload summary |
| Jenkins | Start job | order-status-deploy | env=Dev; deploy_url from Setup; room id; smoke callback |

This run does not call Jenkins until approved. Waiting for approval before QA E2E / log check.
