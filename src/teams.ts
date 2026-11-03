import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { prebuiltAgents } from "./catalog.js"
import { compileGraph, linearGraph, type AutomationGraph } from "./graph.js"

export type TeamRecord = {
  id: string
  workspaceId: string | null
  name: string
  description: string
  agentNames: string[]
  /** agentName → needsApproval override (optional) */
  approvalMap: Record<string, boolean>
  /** The canvas layout. When present, agentNames and approvalMap are compiled from it. */
  graph?: AutomationGraph
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

type TeamStore = { teams: TeamRecord[] }

const DEFAULT_NAME = "SDLC Sprint Team"

function teamsFile(root: string): string {
  return path.join(root, "data", "teams.json")
}

function readStore(root: string): TeamStore {
  const file = teamsFile(root)
  if (!fs.existsSync(file)) return { teams: [] }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as TeamStore
    return { teams: Array.isArray(raw.teams) ? raw.teams : [] }
  } catch {
    return { teams: [] }
  }
}

function writeStore(root: string, store: TeamStore): void {
  const file = teamsFile(root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(store, null, 2))
}

export function ensureDefaultTeam(root: string): TeamRecord {
  const store = readStore(root)
  let existing = store.teams.find((team) => team.isDefault && team.workspaceId === null)
  if (existing) return existing

  const prebuilt = prebuiltAgents(root)
  existing = {
    id: "team-sdlc-sprint",
    workspaceId: null,
    name: DEFAULT_NAME,
    description: "Default ordered SDLC swarm from agents/*.md",
    agentNames: prebuilt.map((agent) => agent.name),
    approvalMap: Object.fromEntries(prebuilt.map((agent) => [agent.name, agent.needsApproval])),
    isDefault: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  store.teams.push(existing)
  writeStore(root, store)
  return existing
}

export function listTeams(root: string, workspaceId: string | null): TeamRecord[] {
  ensureDefaultTeam(root)
  const store = readStore(root)
  return store.teams.filter(
    (team) => team.workspaceId === null || (workspaceId && team.workspaceId === workspaceId),
  )
}

export function getTeam(root: string, teamId: string): TeamRecord | null {
  ensureDefaultTeam(root)
  return readStore(root).teams.find((team) => team.id === teamId) || null
}

export function createTeam(
  root: string,
  workspaceId: string,
  input: {
    name: string
    description?: string
    agentNames: string[]
    approvalMap?: Record<string, boolean>
    graph?: AutomationGraph
  },
): TeamRecord {
  if (!input.name.trim()) throw new Error("Team name required")
  if (input.graph) {
    const compiled = compileGraph(input.graph)
    input = { ...input, agentNames: compiled.agentNames, approvalMap: compiled.approvalMap }
  }
  if (!input.agentNames?.length) throw new Error("Pick at least one agent")

  const store = readStore(root)
  const team: TeamRecord = {
    id: crypto.randomUUID(),
    workspaceId,
    name: input.name.trim().slice(0, 80),
    description: (input.description || "").trim().slice(0, 240),
    agentNames: input.agentNames,
    approvalMap: input.approvalMap || {},
    ...(input.graph ? { graph: input.graph } : {}),
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  store.teams.push(team)
  writeStore(root, store)
  return team
}

export function updateTeam(
  root: string,
  workspaceId: string,
  teamId: string,
  patch: Partial<Pick<TeamRecord, "name" | "description" | "agentNames" | "approvalMap" | "graph">>,
): TeamRecord {
  const store = readStore(root)
  const team = store.teams.find((item) => item.id === teamId)
  if (!team) throw new Error("Team not found")
  if (team.workspaceId !== workspaceId) throw new Error("Cannot edit this team")
  if (patch.name !== undefined) team.name = patch.name.trim().slice(0, 80)
  if (patch.description !== undefined) team.description = patch.description.trim().slice(0, 240)
  if (patch.graph !== undefined) {
    const compiled = compileGraph(patch.graph)
    team.graph = patch.graph
    team.agentNames = compiled.agentNames
    team.approvalMap = compiled.approvalMap
  } else {
    if (patch.agentNames !== undefined) {
      if (!patch.agentNames.length) throw new Error("Pick at least one agent")
      team.agentNames = patch.agentNames
      delete team.graph // the list changed, so the old canvas no longer matches
    }
    if (patch.approvalMap !== undefined) {
      team.approvalMap = patch.approvalMap
      delete team.graph
    }
  }
  team.updatedAt = new Date().toISOString()
  writeStore(root, store)
  return team
}

export function deleteTeam(root: string, workspaceId: string, teamId: string): void {
  const store = readStore(root)
  const team = store.teams.find((item) => item.id === teamId)
  if (!team) throw new Error("Team not found")
  if (team.isDefault || team.workspaceId !== workspaceId) throw new Error("Cannot delete this team")
  store.teams = store.teams.filter((item) => item.id !== teamId)
  writeStore(root, store)
}

/** The team's canvas. Teams made as plain lists get a straight chain. */
export function teamGraph(team: TeamRecord): AutomationGraph {
  return team.graph ?? linearGraph(team.agentNames, team.approvalMap)
}
