import fs from "node:fs"
import path from "node:path"
import { parseRepoUrl } from "./github.js"
import type { GitRepoRef, Room } from "./types.js"

export function roomPath(root: string): string {
  const dir = process.env.DATA_DIR ?? path.join(root, "data")
  return path.join(dir, "room.json")
}

export function readRoom(root: string): Room | null {
  const file = roomPath(root)
  if (!fs.existsSync(file)) return null
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Room & {
    gitRepoUrl?: string | null
    gitBranch?: string | null
  }
  const room = normalizeRoom(raw)
  room.stages = room.stages.map((stage) => ({ ...stage, agentId: stage.agentId ?? null }))
  return room
}

export function writeRoom(root: string, room: Room): void {
  const file = roomPath(root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(normalizeRoom(room), null, 2))
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
