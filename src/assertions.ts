import type { Room } from "./types.js"

export type CheckSpec = {
  id: string
  kind: "test" | "unit" | "smoke"
  story: string | null
  text: string
  /** Keywords the response/page should contain for this check. */
  expectAny: string[]
  /** Keywords that must not appear (e.g. inventing a status). */
  forbid: string[]
}

const STATUS_TOKENS = ["Paid", "Pending", "Failed", "Status unavailable", "unavailable"] as const

/** Pull TEST-* / UNIT-* specs from QA Design (and similar) agent outputs. */
export function extractCheckSpecs(room: Room): CheckSpec[] {
  const byId = new Map<string, CheckSpec>()

  for (const message of room.messages) {
    if (message.kind !== "agent" || !message.body) continue
    for (const line of message.body.split(/\r?\n/)) {
      const row = parseTableRow(line)
      if (!row) continue
      const idMatch = row[0].match(/\b((?:TEST|UNIT)-\d+)\b/i)
      if (!idMatch) continue
      const id = normalizeCheckId(idMatch[1])
      const story = row[1] && !/^check$/i.test(row[1]) && !/^outline$/i.test(row[1]) ? row[1] : null
      const text = row.slice(2).join(" | ") || row[1] || ""
      const kind = id.startsWith("UNIT-") ? "unit" : "test"
      byId.set(id, {
        id,
        kind,
        story,
        text,
        expectAny: inferExpect(id, text),
        forbid: inferForbid(id, text),
      })
    }

    for (const match of message.body.matchAll(/\b((?:TEST|UNIT)-\d+)\b/gi)) {
      const id = normalizeCheckId(match[1])
      if (byId.has(id)) continue
      byId.set(id, {
        id,
        kind: id.startsWith("UNIT-") ? "unit" : "test",
        story: null,
        text: "",
        expectAny: [...STATUS_TOKENS],
        forbid: [],
      })
    }
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

export function extractCheckIds(room: Room): string[] {
  return extractCheckSpecs(room).map((spec) => spec.id)
}

function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith("|")) return null
  const cells = trimmed
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean)
  if (cells.length < 2) return null
  if (/^id$/i.test(cells[0]) || /^-+$/.test(cells[0])) return null
  return cells
}

function inferExpect(id: string, text: string): string[] {
  const found: string[] = []
  for (const token of STATUS_TOKENS) {
    if (new RegExp(`\\b${escapeRe(token)}\\b`, "i").test(text)) found.push(token)
  }
  if (found.length > 0) return found

  if (/TEST-003/i.test(id) || /cannot be read|unavailable/i.test(text)) {
    return ["Status unavailable", "unavailable"]
  }
  if (/TEST-001/i.test(id) || /\bPaid\b/i.test(text)) return ["Paid"]
  if (/TEST-002/i.test(id) || /\bPending\b/i.test(text)) return ["Pending"]
  if (/UNIT-001/i.test(id)) return ["Paid", "Pending", "Failed"]
  if (/UNIT-002/i.test(id)) return ["Status unavailable", "unavailable"]
  return [...STATUS_TOKENS]
}

function inferForbid(id: string, text: string): string[] {
  if (/TEST-002/i.test(id) || /does not show a receipt/i.test(text)) {
    return ["receipt"]
  }
  if (/TEST-003/i.test(id) || /does not invent/i.test(text)) {
    return []
  }
  return []
}

function normalizeCheckId(raw: string): string {
  const match = raw.trim().match(/^(TEST|UNIT)-(\d+)$/i)
  if (!match) return raw.toUpperCase()
  return `${match[1].toUpperCase()}-${match[2]}`
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function evaluateBody(spec: CheckSpec, body: string, httpOk: boolean): {
  result: "pass" | "fail" | "skip"
  evidence: string
} {
  if (!httpOk) {
    return { result: "fail", evidence: `HTTP probe failed for ${spec.id}` }
  }
  const hay = body || ""
  for (const bad of spec.forbid) {
    if (new RegExp(escapeRe(bad), "i").test(hay)) {
      return {
        result: "fail",
        evidence: `${spec.id}: forbidden token "${bad}" found in response`,
      }
    }
  }
  if (spec.expectAny.length === 0) {
    return { result: "pass", evidence: `${spec.id}: reachable; no keyword expectation` }
  }
  const hit = spec.expectAny.find((token) => new RegExp(escapeRe(token), "i").test(hay))
  if (hit) {
    return { result: "pass", evidence: `${spec.id}: found "${hit}"` }
  }
  return {
    result: "fail",
    evidence: `${spec.id}: expected one of [${spec.expectAny.join(", ")}] in body`,
  }
}
