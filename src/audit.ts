import fs from "node:fs"
import path from "node:path"

/** Append-only audit trail (ENT-3). One JSON line per event; never rewritten. */

export type AuditEvent = {
  id: string
  at: string
  actorId: string | null
  actorEmail: string | null
  actorRole: string | null
  workspaceId: string | null
  environmentId: string | null
  roomId: string | null
  slot: string | null
  action: string
  target: string
  detail: string
  ok: boolean
}

export type AuditInput = Omit<AuditEvent, "id" | "at"> & { id?: string; at?: string }

function auditDir(root: string): string {
  return path.join(process.env.DATA_DIR ?? path.join(root, "data"), "audit")
}

function auditFile(root: string): string {
  return path.join(auditDir(root), "events.jsonl")
}

export function appendAudit(root: string, input: AuditInput): AuditEvent {
  const event: AuditEvent = {
    id: input.id || crypto.randomUUID(),
    at: input.at || new Date().toISOString(),
    actorId: input.actorId,
    actorEmail: input.actorEmail,
    actorRole: input.actorRole,
    workspaceId: input.workspaceId,
    environmentId: input.environmentId,
    roomId: input.roomId,
    slot: input.slot,
    action: input.action,
    target: input.target,
    detail: String(input.detail || "").slice(0, 2_000),
    ok: Boolean(input.ok),
  }
  const file = auditFile(root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, { flag: "a" })
  return event
}

export function readAudit(
  root: string,
  options: { limit?: number; environmentId?: string | null; action?: string } = {},
): AuditEvent[] {
  const file = auditFile(root)
  if (!fs.existsSync(file)) return []
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 2_000)
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean)
  const events: AuditEvent[] = []
  for (let i = lines.length - 1; i >= 0 && events.length < limit; i--) {
    try {
      const event = JSON.parse(lines[i]) as AuditEvent
      if (options.environmentId && event.environmentId !== options.environmentId) continue
      if (options.action && event.action !== options.action) continue
      events.push(event)
    } catch {
      // skip corrupt lines; never rewrite the file
    }
  }
  return events
}
