import { AsyncLocalStorage } from "node:async_hooks"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { parseRepoUrl } from "./github.js"
import type { GitRepoRef, Room } from "./types.js"

/**
 * Sprint rooms are one JSON file each under `rooms/`, named by a stable `slot`. A room's id changes when its
 * requirement changes, so the slot (not the id) is what ties a room to its file. A room carries its own slot, so a
 * long run keeps writing to the right file even after the person opens another room.
 * The "active room" pointer is what `readRoom(root)` returns; it keeps the one-room UI working.
 */

export const DEFAULT_ENV_ID = "env-default"

function dataDir(root: string): string {
  return process.env.DATA_DIR ?? path.join(root, "data")
}

export function roomsDir(root: string): string {
  return path.join(dataDir(root), "rooms")
}

function activePath(root: string): string {
  return path.join(dataDir(root), "active-room.json")
}

/** The pre-environments single-room file. Migrated once into `rooms/`, then left as a backup. */
function legacyPath(root: string): string {
  return path.join(dataDir(root), "room.json")
}

function roomFile(root: string, slot: string): string {
  return path.join(roomsDir(root), `${safeSlot(slot)}.json`)
}

function safeSlot(slot: string): string {
  const clean = slot.replace(/[^a-zA-Z0-9_-]/g, "")
  if (!clean) throw new Error("Invalid room slot")
  return clean
}

export function newSlot(): string {
  return `r-${crypto.randomUUID().slice(0, 8)}`
}

function migrateLegacy(root: string): void {
  if (fs.existsSync(roomsDir(root))) return
  fs.mkdirSync(roomsDir(root), { recursive: true })
  if (!fs.existsSync(legacyPath(root))) return
  const slot = newSlot()
  fs.copyFileSync(legacyPath(root), roomFile(root, slot))
  fs.writeFileSync(activePath(root), JSON.stringify({ slot }))
}

const sessions = new AsyncLocalStorage<string>()

/**
 * Runs `fn` as one browser session, so `activeSlot` and `setActiveSlot` mean that session's open room. Requests are
 * wrapped in this by the server. Outside it (tests, the Jenkins callback) they use the shared fallback room.
 */
export function runWithSession<T>(sessionId: string, fn: () => T): T {
  return sessions.run(sessionId, fn)
}

type Pointer = { slot?: string; sessions?: Record<string, string> }
const MAX_SESSIONS = 200

function readPointer(root: string): Pointer {
  try {
    return JSON.parse(fs.readFileSync(activePath(root), "utf8")) as Pointer
  } catch {
    return {}
  }
}

/** The room this session has open, else the shared fallback (the first room ever made). */
export function activeSlot(root: string): string | null {
  migrateLegacy(root)
  const pointer = readPointer(root)
  const sessionId = sessions.getStore()
  const own = sessionId ? pointer.sessions?.[sessionId] : undefined
  for (const slot of [own, pointer.slot]) {
    if (slot && fs.existsSync(roomFile(root, slot))) return slot
  }
  return null
}

/** Opens a room for this session only. With no session it sets the shared fallback. */
export function setActiveSlot(root: string, slot: string): void {
  if (!fs.existsSync(roomFile(root, slot))) throw new Error("Room not found")
  const pointer = readPointer(root)
  const sessionId = sessions.getStore()
  if (sessionId) {
    const entries = Object.entries({ ...pointer.sessions, [sessionId]: slot })
    pointer.sessions = Object.fromEntries(entries.slice(-MAX_SESSIONS))
    if (!pointer.slot || !fs.existsSync(roomFile(root, pointer.slot))) pointer.slot = slot
  } else {
    pointer.slot = slot
  }
  fs.writeFileSync(activePath(root), JSON.stringify(pointer))
}
export function readRoom(root: string, slot: string | null = activeSlot(root)): Room | null {
  if (!slot) return null
  const file = roomFile(root, slot)
  if (!fs.existsSync(file)) return null
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Room & {
    gitRepoUrl?: string | null
    gitBranch?: string | null
  }
  const room = normalizeRoom(raw)
  room.slot = slot
  room.stages = room.stages.map((stage) => ({
    ...stage,
    agentId: stage.agentId ?? null,
    usage: stage.usage ?? null,
  }))
  return room
}

/** Writes the room to its own slot. A room with no slot yet takes the active one, or starts a new one. */
export function writeRoom(root: string, room: Room): void {
  const slot = room.slot ?? activeSlot(root) ?? newSlot()
  room.slot = slot
  fs.mkdirSync(roomsDir(root), { recursive: true })
  fs.writeFileSync(roomFile(root, slot), JSON.stringify(normalizeRoom(room), null, 2))
  if (!activeSlot(root)) setActiveSlot(root, slot)
}

export type RoomSummary = {
  slot: string
  id: string
  requirement: string
  environmentId: string
  state: "new" | "running" | "waiting" | "error" | "done"
  updatedAt: string
}

export function listRoomSummaries(root: string): RoomSummary[] {
  migrateLegacy(root)
  const summaries: RoomSummary[] = []
  for (const name of fs.readdirSync(roomsDir(root))) {
    if (!name.endsWith(".json")) continue
    const slot = name.slice(0, -5)
    try {
      const file = path.join(roomsDir(root), name)
      const room = normalizeRoom(JSON.parse(fs.readFileSync(file, "utf8")) as Room)
      const statuses = room.stages.map((stage) => stage.status)
      const state: RoomSummary["state"] = statuses.includes("running")
        ? "running"
        : statuses.includes("waiting_approval")
          ? "waiting"
          : statuses.includes("error")
            ? "error"
            : statuses.length && statuses.every((status) => status === "done" || status === "skipped")
              ? "done"
              : "new"
      summaries.push({
        slot,
        id: room.id,
        requirement: room.requirement,
        environmentId: room.environmentId ?? DEFAULT_ENV_ID,
        state,
        updatedAt: fs.statSync(file).mtime.toISOString(),
      })
    } catch {
      // A damaged room file must not hide the others.
    }
  }
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function normalizeRoom(room: Room & { gitRepoUrl?: string | null; gitBranch?: string | null }): Room {
  const gitRepos = migrateGitRepos(room)
  return {
    ...room,
    confluencePageUrl: room.confluencePageUrl ?? null,
    pastedBrd: room.pastedBrd ?? null,
    figmaFileUrl: room.figmaFileUrl ?? null,
    jiraBoardUrl: room.jiraBoardUrl ?? null,
    jiraProjectKey: room.jiraProjectKey ?? null,
    jiraEpicKey: room.jiraEpicKey ?? null,
    gitRepos,
    permissions: Array.isArray(room.permissions) ? room.permissions : [],
    deployUrl: room.deployUrl ?? null,
    deployEnv: room.deployEnv ?? null,
    jenkinsJob: room.jenkinsJob ?? null,
    deploymentsByEnv: room.deploymentsByEnv && typeof room.deploymentsByEnv === "object" ? room.deploymentsByEnv : {},
    lastSmokeReport: room.lastSmokeReport ?? null,
    lastHealthReport: room.lastHealthReport ?? null,
    teamId: room.teamId ?? null,
    environmentId: room.environmentId ?? null,
    slot: room.slot ?? null,
    stages: Array.isArray(room.stages)
      ? room.stages.map((stage) => ({
          ...stage,
          usage: stage.usage ?? null,
          agentId: stage.agentId ?? null,
        }))
      : [],
  }
}

function migrateGitRepos(room: Room & { gitRepoUrl?: string | null; gitBranch?: string | null }): GitRepoRef[] {
  if (Array.isArray(room.gitRepos) && room.gitRepos.length > 0) {
    return room.gitRepos.map((item) => ({
      id: item.id || crypto.randomUUID(),
      url: item.url,
      owner: item.owner,
      repo: item.repo,
      branch: item.branch || "main",
    }))
  }

  const legacyUrl = room.gitRepoUrl
  if (!legacyUrl) return Array.isArray(room.gitRepos) ? room.gitRepos : []

  const parsed = parseRepoUrl(legacyUrl)
  if (!parsed) return []
  return [
    {
      id: crypto.randomUUID(),
      url: parsed.url,
      owner: parsed.owner,
      repo: parsed.repo,
      branch: room.gitBranch?.trim() || "main",
    },
  ]
}
