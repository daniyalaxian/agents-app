import fs from "node:fs"
import path from "node:path"
import type { ChatMessage } from "./types.js"

export type DmThread = {
  roomId: string
  agentName: string
  messages: ChatMessage[]
  updatedAt: string
}

export function dmPath(root: string, roomId: string, agentName: string): string {
  return path.join(root, "data", "dms", safe(roomId), `${safe(agentName)}.json`)
}

export function readDm(root: string, roomId: string, agentName: string): DmThread {
  const file = dmPath(root, roomId, agentName)
  if (!fs.existsSync(file)) {
    return {
      roomId,
      agentName,
      messages: [],
      updatedAt: new Date().toISOString(),
    }
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as DmThread
    return {
      roomId,
      agentName,
      messages: Array.isArray(raw.messages) ? raw.messages : [],
      updatedAt: raw.updatedAt || new Date().toISOString(),
    }
  } catch {
    return { roomId, agentName, messages: [], updatedAt: new Date().toISOString() }
  }
}

export function writeDm(root: string, thread: DmThread): void {
  const file = dmPath(root, thread.roomId, thread.agentName)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  thread.updatedAt = new Date().toISOString()
  fs.writeFileSync(file, JSON.stringify(thread, null, 2))
}

export function listDmAgents(root: string, roomId: string): string[] {
  const dir = path.join(root, "data", "dms", safe(roomId))
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
}

function safe(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "x"
}
