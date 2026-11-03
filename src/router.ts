import { formatMemoryForPacket, indexAgentOutput, memoryEntriesForRoom } from "./memory.js"
import { parseWritePlans, slugifyRequirement } from "./permissions.js"
import type { StageRunner } from "./runner.js"
import type { RuntimeTools } from "./tools.js"
import type { AgentFile, ChatMessage, Packet, PacketView, Room, SourceDoc, StageState } from "./types.js"

/** Set by server so room pipeline can index shared memory. */
let memoryRoot: string | null = null

export function setMemoryRoot(root: string): void {
  memoryRoot = root
}

export const REQUIREMENT =
  "Show payment status on the order screen. The customer opens an order and sees whether payment is Paid, Pending, or Failed."

export function openRoom(agents: AgentFile[], requirement = REQUIREMENT): Room {
  const trimmed = requirement.trim() || REQUIREMENT
  return {
    id: slugifyRequirement(trimmed),
    requirement: trimmed,
    confluencePageUrl: null,
    pastedBrd: null,
    figmaFileUrl: null,
    jiraBoardUrl: null,
    jiraProjectKey: null,
    jiraEpicKey: null,
    gitRepos: [],
    permissions: [],
    deployUrl: null,
    deployEnv: null,
    jenkinsJob: null,
    deploymentsByEnv: {},
    lastSmokeReport: null,
    lastHealthReport: null,
    teamId: null,
    notes: [],
    messages: [humanMessage(trimmed)],
    stages: agents.map((agent) => ({
      name: agent.name,
      title: agent.title,
      status: "pending",
      output: null,
      agentId: null,
    })),
  }
}

/** Soft reset: keep Setup sources; clear pipeline, messages, permissions, notes. */
export function softResetRoom(room: Room, agents: AgentFile[], requirement?: string): Room {
  const nextReq = (requirement ?? room.requirement).trim() || REQUIREMENT
  return {
    id: slugifyRequirement(nextReq),
    requirement: nextReq,
    confluencePageUrl: room.confluencePageUrl ?? null,
    pastedBrd: room.pastedBrd ?? null,
    figmaFileUrl: room.figmaFileUrl ?? null,
    jiraBoardUrl: room.jiraBoardUrl ?? null,
    jiraProjectKey: room.jiraProjectKey ?? null,
    jiraEpicKey: null,
    gitRepos: Array.isArray(room.gitRepos) ? room.gitRepos.map((item) => ({ ...item })) : [],
    permissions: [],
    deployUrl: room.deployUrl ?? null,
    deployEnv: room.deployEnv ?? null,
    jenkinsJob: room.jenkinsJob ?? null,
    deploymentsByEnv: { ...(room.deploymentsByEnv ?? {}) },
    lastSmokeReport: null,
    lastHealthReport: null,
    teamId: room.teamId ?? null,
    notes: [],
    messages: [humanMessage(nextReq)],
    stages: agents.map((agent) => ({
      name: agent.name,
      title: agent.title,
      status: "pending",
      output: null,
      agentId: null,
    })),
  }
}

export type RunHooks = {
  onRoom?: (room: Room) => void
  onDelta?: (roleName: string, text: string) => void
  loadSources?: (room: Room, roleName: string) => Promise<SourceDoc[]>
  /** Runtime write tools for one role run. `room` is the live room the run mutates. */
  toolsFor?: (room: Room, agent: AgentFile) => RuntimeTools | undefined
}

export function recover(room: Room): Room {
  const withUrl = {
    ...room,
    confluencePageUrl: room.confluencePageUrl ?? null,
    pastedBrd: room.pastedBrd ?? null,
    figmaFileUrl: room.figmaFileUrl ?? null,
    jiraBoardUrl: room.jiraBoardUrl ?? null,
    jiraProjectKey: room.jiraProjectKey ?? null,
    jiraEpicKey: room.jiraEpicKey ?? null,
    gitRepos: Array.isArray(room.gitRepos) ? room.gitRepos.map((item) => ({ ...item })) : [],
    permissions: Array.isArray(room.permissions) ? room.permissions.map((item) => ({ ...item })) : [],
    deployUrl: room.deployUrl ?? null,
    deployEnv: room.deployEnv ?? null,
    jenkinsJob: room.jenkinsJob ?? null,
    deploymentsByEnv: { ...(room.deploymentsByEnv ?? {}) },
    lastSmokeReport: room.lastSmokeReport ?? null,
    lastHealthReport: room.lastHealthReport ?? null,
    teamId: room.teamId ?? null,
  }
  if (!withUrl.stages.some((stage) => stage.status === "running")) return withUrl
  return {
    ...withUrl,
    stages: withUrl.stages.map((stage) =>
      stage.status === "running" ? { ...stage, status: "error", output: null } : stage,
    ),
    messages: [
      ...withUrl.messages,
      {
        id: crypto.randomUUID(),
        kind: "agent",
        title: "Room",
        body: "A role was still running when the server restarted. Use Retry.",
        at: new Date().toISOString(),
      },
    ],
  }
}

export async function runUntilWait(
  room: Room,
  agents: AgentFile[],
  projectMarkdown: string,
  runner: StageRunner,
  hooks: RunHooks = {},
): Promise<Room> {
  const next = clone(room)

  while (true) {
    const index = next.stages.findIndex((stage) => stage.status === "pending")
    if (index === -1) return next

    const stage = next.stages[index]
    const agent = agents.find((item) => item.name === stage.name)
    if (!agent) throw new Error(`Missing role file for ${stage.name}`)

    const prior = finishedOutputs(next.stages)
    const sources = (await hooks.loadSources?.(next, agent.name)) ?? []
    const memoryText = memoryRoot
      ? formatMemoryForPacket(memoryEntriesForRoom(memoryRoot, next))
      : "None yet."
    const packet: Packet = {
      requirement: next.requirement,
      projectMarkdown,
      role: agent,
      prior,
      notes: next.notes,
      sources,
      memory: memoryText,
    }

    stage.status = "running"
    hooks.onRoom?.(clone(next))

    try {
      const result = await runner(
        packet,
        (text) => hooks.onDelta?.(stage.name, text),
        hooks.toolsFor?.(next, agent),
      )
      stage.output = result.output
      stage.agentId = result.agentId ?? null
      stage.status = agent.needsApproval ? "waiting_approval" : "done"
      const plans = parseWritePlans(result.output, {
        roleName: agent.name,
        roleTitle: agent.title,
        surface: "room",
      })
      if (plans.length) {
        next.permissions = [...(next.permissions || []), ...plans]
      }
      if (memoryRoot) {
        indexAgentOutput({
          root: memoryRoot,
          roomId: next.id,
          agentName: agent.name,
          agentTitle: agent.title,
          output: result.output,
          surface: "room",
        })
      }
      next.messages.push(agentMessage(agent, result.output, packetView(packet), result.agentId))
      hooks.onRoom?.(clone(next))
      if (agent.needsApproval) return next
    } catch (error) {
      stage.status = "error"
      stage.output = null
      const message = error instanceof Error ? error.message : "The role failed"
      next.messages.push(agentMessage(agent, message, packetView(packet)))
      hooks.onRoom?.(clone(next))
      return next
    }
  }
}

export async function approveAndContinue(
  room: Room,
  agents: AgentFile[],
  projectMarkdown: string,
  runner: StageRunner,
  note?: string,
  hooks: RunHooks = {},
): Promise<Room> {
  const waiting = room.stages.find((stage) => stage.status === "waiting_approval")
  if (!waiting) throw new Error("Nothing is waiting for approval")

  const next = clone(room)
  const stage = next.stages.find((item) => item.name === waiting.name)
  if (!stage) throw new Error("Nothing is waiting for approval")
  stage.status = "done"

  const trimmed = note?.trim()
  if (trimmed) next.notes.push(trimmed)
  next.messages.push(humanMessage(trimmed ? `Approved.\n\n${trimmed}` : "Approved."))
  hooks.onRoom?.(clone(next))
  return runUntilWait(next, agents, projectMarkdown, runner, hooks)
}

export async function retry(
  room: Room,
  agents: AgentFile[],
  projectMarkdown: string,
  runner: StageRunner,
  hooks: RunHooks = {},
): Promise<Room> {
  if (!room.stages.some((stage) => stage.status === "error")) {
    throw new Error("Nothing needs a retry")
  }
  const next = clone(room)
  for (const stage of next.stages) {
    if (stage.status === "error") {
      stage.status = "pending"
      stage.output = null
    }
  }
  hooks.onRoom?.(clone(next))
  return runUntilWait(next, agents, projectMarkdown, runner, hooks)
}

function finishedOutputs(stages: StageState[]): { title: string; output: string }[] {
  return stages
    .filter((stage) => stage.status === "done" && stage.output)
    .map((stage) => ({ title: stage.title, output: stage.output as string }))
}

function clone(room: Room): Room {
  return {
    ...room,
    confluencePageUrl: room.confluencePageUrl ?? null,
    pastedBrd: room.pastedBrd ?? null,
    figmaFileUrl: room.figmaFileUrl ?? null,
    jiraBoardUrl: room.jiraBoardUrl ?? null,
    jiraProjectKey: room.jiraProjectKey ?? null,
    jiraEpicKey: room.jiraEpicKey ?? null,
    gitRepos: Array.isArray(room.gitRepos) ? room.gitRepos.map((item) => ({ ...item })) : [],
    permissions: Array.isArray(room.permissions) ? room.permissions.map((item) => ({ ...item })) : [],
    deployUrl: room.deployUrl ?? null,
    deployEnv: room.deployEnv ?? null,
    jenkinsJob: room.jenkinsJob ?? null,
    deploymentsByEnv: { ...(room.deploymentsByEnv ?? {}) },
    lastSmokeReport: room.lastSmokeReport ?? null,
    lastHealthReport: room.lastHealthReport ?? null,
    teamId: room.teamId ?? null,
    notes: [...room.notes],
    messages: [...room.messages],
    stages: room.stages.map((stage) => ({ ...stage })),
  }
}

function packetView(packet: Packet): PacketView {
  return {
    roleFile: packet.role.file,
    projectFile: "project/AGENTS.md",
    projectMarkdown: packet.projectMarkdown,
    givenStages: packet.prior,
    notes: packet.notes,
    memory: packet.memory || "None yet.",
    sources: packet.sources.map((source) => ({
      kind: source.kind,
      title: source.title,
      url: source.url,
      body: source.body,
    })),
  }
}

function humanMessage(body: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    kind: "human",
    title: "You",
    body,
    at: new Date().toISOString(),
  }
}

function agentMessage(
  agent: AgentFile,
  body: string,
  packet: PacketView,
  agentId?: string,
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    kind: "agent",
    title: agent.title,
    body,
    at: new Date().toISOString(),
    packet,
    agentId,
  }
}
