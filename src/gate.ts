import type { PermissionRequest } from "./types.js"

/** How a person answered a runtime permission ask. */
export type Decision = {
  approved: boolean
  /** "run" = auto-allow the same system+action for the rest of this run. */
  remember: boolean
  reason: string | null
}

type Waiting = {
  request: PermissionRequest
  runId: string
  resolve: (decision: Decision) => void
  timer: NodeJS.Timeout
}

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000

/**
 * Holds runtime permission asks from agents (Cursor custom tools) until a person
 * answers in the UI. Like Cursor CLI: the agent's tool call blocks on `ask`.
 */
export class PermissionGate {
  private waiting = new Map<string, Waiting>()
  private remembered = new Map<string, Set<string>>()

  constructor(private timeoutMs = Number(process.env.PERMISSION_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS) {}

  ask(runId: string, request: PermissionRequest): Promise<Decision> {
    if (this.remembered.get(runId)?.has(rememberKey(request))) {
      return Promise.resolve({ approved: true, remember: true, reason: "Allowed for this run" })
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.answer(request.id, {
          approved: false,
          remember: false,
          reason: `No answer within ${Math.round(this.timeoutMs / 60000)} minutes`,
        })
      }, this.timeoutMs)
      this.waiting.set(request.id, { request, runId, resolve, timer })
    })
  }

  /** Returns false when the id is not a live ask (e.g. a post-run Write plan card). */
  answer(id: string, decision: Decision): boolean {
    const item = this.waiting.get(id)
    if (!item) return false
    clearTimeout(item.timer)
    this.waiting.delete(id)
    if (decision.approved && decision.remember) {
      const keys = this.remembered.get(item.runId) ?? new Set<string>()
      keys.add(rememberKey(item.request))
      this.remembered.set(item.runId, keys)
    }
    item.resolve(decision)
    return true
  }

  pending(): PermissionRequest[] {
    return [...this.waiting.values()].map((item) => item.request)
  }

  /** Deny anything still open for a run and forget its remembered allows. */
  endRun(runId: string): void {
    for (const [id, item] of this.waiting) {
      if (item.runId === runId) {
        this.answer(id, { approved: false, remember: false, reason: "Run ended" })
      }
    }
    this.remembered.delete(runId)
  }
}

function rememberKey(request: PermissionRequest): string {
  return `${request.roleName}:${request.system}:${request.action.toLowerCase()}`
}
