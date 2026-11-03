import fs from "node:fs"
import path from "node:path"
import type { MemoryEntry, MemoryKind, Room } from "./types.js"

export type MemoryStore = {
  roomId: string
  sprint: string
  entries: MemoryEntry[]
}

const MAX_ENTRIES = 200

export function memoryPath(root: string, roomId: string): string {
  return path.join(root, "data", "memory", `${safeId(roomId)}.json`)
}

export function readMemory(root: string, roomId: string): MemoryStore {
  const file = memoryPath(root, roomId)
  if (!fs.existsSync(file)) {
    return { roomId, sprint: roomId, entries: [] }
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as MemoryStore
    return {
      roomId,
      sprint: raw.sprint || roomId,
      entries: Array.isArray(raw.entries) ? raw.entries : [],
    }
  } catch {
    return { roomId, sprint: roomId, entries: [] }
  }
}

export function writeMemory(root: string, store: MemoryStore): void {
  const file = memoryPath(root, store.roomId)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const entries = store.entries.slice(-MAX_ENTRIES)
  fs.writeFileSync(file, JSON.stringify({ ...store, entries }, null, 2))
}

export function addMemory(
  root: string,
  roomId: string,
  entry: Omit<MemoryEntry, "id" | "at"> & { id?: string; at?: string },
): MemoryEntry {
  const store = readMemory(root, roomId)
  const full: MemoryEntry = {
    id: entry.id || crypto.randomUUID(),
    kind: entry.kind,
    title: entry.title,
    body: entry.body,
    agent: entry.agent,
    source: entry.source,
    refs: entry.refs,
    at: entry.at || new Date().toISOString(),
  }
  store.entries.push(full)
  writeMemory(root, store)
  return full
}

export function formatMemoryForPacket(entries: MemoryEntry[], limit = 40): string {
  if (!entries.length) return "None yet."
  return entries
    .slice(-limit)
    .map(
      (item) =>
        `- [${item.kind}] ${item.title} (agent=${item.agent}; source=${item.source})\n  ${item.body.slice(0, 400)}`,
    )
    .join("\n")
}

/** Index durable findings from a role output. */
export function indexAgentOutput(input: {
  root: string
  roomId: string
  agentName: string
  agentTitle: string
  output: string
  surface: "room" | "dm" | "group"
}): MemoryEntry[] {
  const source = `${input.surface}:${input.agentName}`
  const created: MemoryEntry[] = []
  const lines = input.output.split(/\r?\n/)

  for (const line of lines) {
    const gap = line.match(/\b(GAP-\d+)\b([^|\n]*)/i)
    if (gap) {
      created.push(
        addMemory(input.root, input.roomId, {
          kind: "gap",
          title: gap[1].toUpperCase(),
          body: line.replace(/^\|?\s*/, "").trim().slice(0, 500),
          agent: input.agentName,
          source,
          refs: [gap[1].toUpperCase()],
        }),
      )
    }
  }

  for (const match of input.output.matchAll(/\b((?:TEST|UNIT)-\d+)\b/gi)) {
    const id = match[1].toUpperCase()
    created.push(
      addMemory(input.root, input.roomId, {
        kind: "test",
        title: id,
        body: `Mentioned by ${input.agentTitle}`,
        agent: input.agentName,
        source,
        refs: [id],
      }),
    )
  }

  if (/^##\s+Decision\b/im.test(input.output) || /\bDecision record\b/i.test(input.output)) {
    const block = sliceSection(input.output, /^##\s+Decision\b/im) || input.output.slice(0, 600)
    created.push(
      addMemory(input.root, input.roomId, {
        kind: "decision",
        title: `Decision from ${input.agentTitle}`,
        body: block.slice(0, 800),
        agent: input.agentName,
        source,
      }),
    )
  }

  if (/##\s+Write plan\b/i.test(input.output)) {
    created.push(
      addMemory(input.root, input.roomId, {
        kind: "write_plan",
        title: `Write plan from ${input.agentTitle}`,
        body: sliceSection(input.output, /##\s+Write plan\b/i)?.slice(0, 800) || "Write plan emitted",
        agent: input.agentName,
        source,
      }),
    )
  }

  for (const match of input.output.matchAll(/\bPR\s*#(\d+)\b|\b(https:\/\/github\.com\/[^\s)]+)/gi)) {
    const ref = match[0]
    created.push(
      addMemory(input.root, input.roomId, {
        kind: "pr",
        title: `PR link`,
        body: ref,
        agent: input.agentName,
        source,
        refs: [ref],
      }),
    )
  }

  // Deduplicate consecutive identical titles from the same agent in this batch is hard;
  // collapse duplicate test ids within this indexing pass.
  return dedupeBatch(created)
}

export function indexPermissionResult(input: {
  root: string
  roomId: string
  agentName: string
  system: string
  action: string
  target: string
  status: "executed" | "denied" | "failed"
  detail: string
  surface: "room" | "dm" | "group"
}): MemoryEntry {
  return addMemory(input.root, input.roomId, {
    kind: "approval",
    title: `${input.system} ${input.status}: ${input.action}`,
    body: `${input.target} — ${input.detail}`.slice(0, 800),
    agent: input.agentName,
    source: `${input.surface}:permission:${input.system}`,
    refs: [input.target],
  })
}

export function memoryEntriesForRoom(root: string, room: Room): MemoryEntry[] {
  return readMemory(root, room.id).entries
}

function sliceSection(text: string, heading: RegExp): string | null {
  const match = text.match(heading)
  if (!match || match.index === undefined) return null
  const start = match.index
  const rest = text.slice(start)
  const next = rest.slice(match[0].length).search(/\n##\s+/)
  return next === -1 ? rest.trim() : rest.slice(0, match[0].length + next).trim()
}

function dedupeBatch(entries: MemoryEntry[]): MemoryEntry[] {
  const seen = new Set<string>()
  const out: MemoryEntry[] = []
  for (const entry of entries) {
    const key = `${entry.kind}:${entry.title}:${entry.agent}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
  }
  return out
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "room"
}

export function isMemoryKind(value: string): value is MemoryKind {
  return ["gap", "decision", "test", "write_plan", "approval", "pr", "finding", "note"].includes(value)
}
