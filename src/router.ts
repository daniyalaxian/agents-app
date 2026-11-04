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

/** Room ids key memory and chats. Rooms outside the Default environment are prefixed so two clients never share them. */
export function roomIdFor(environmentId: string | null, requirement: string): string {
  const slug = slugifyRequirement(requirement)
  return environmentId && environmentId !== "env-default" ? `${environmentId}--${slug}` : slug
}

export function openRoom(agents: AgentFile[], requirement = REQUIREMENT, environmentId: string | null = null): Room {
  const trimmed = requirement.trim() || REQUIREMENT
  return {
    id: roomIdFor(environmentId, trimmed),
    environmentId,
    slot: null,
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
    id: roomIdFor(room.environmentId ?? null, nextReq),
    environmentId: room.environmentId ?? null,
    slot: room.slot ?? null,
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
  loadSources?: (room: Room, roleName: string, agent?: AgentFile) => Promise<SourceDoc[]>
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
    environmentId: room.environmentId ?? null,
    slot: room.slot ?? null,
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
    const sources = (await hooks.loadSources?.(next, agent.name, agent)) ?? []
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
      applySkips(next, agent)
      hooks.onRoom?.(clone(next))
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
  const approvedAgent = agents.find((item) => item.name === stage.name)
  if (approvedAgent) applySkips(next, approvedAgent)

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

/** The last `VERDICT: word` line in an agent's reply, lower-cased, or null. */
export function verdictOf(output: string): string | null {
  let found: string | null = null
  for (const match of output.matchAll(/^[ \t>*_-]*VERDICT[ \t*_]*:[ \t*_`]*([A-Za-z0-9_-]{1,20})/gim)) found = match[1].toLowerCase()
  return found
}

/**
 * After an agent is done, jumps ahead if its verdict matches one of its skip rules: the agents in between are marked
 * skipped. No verdict, or a word no rule asks for, skips nothing, so the run carries on as normal.
 */
export function applySkips(room: Room, agent: AgentFile): void {
  if (!agent.skipIf?.length) return
  const from = room.stages.findIndex((stage) => stage.name === agent.name)
  const output = room.stages[from]?.output
  if (from === -1 || !output) return
  const verdict = verdictOf(output)
  const note = (body: string) =>
    room.messages.push({ id: crypto.randomUUID(), kind: "agent", title: "Room", body, at: new Date().toISOString() })
  if (!verdict) {
    note(`${agent.title} gave no VERDICT line, so nothing was skipped.`)
    return
  }
  const rule = agent.skipIf.find((item) => item.verdict === verdict)
  if (!rule) return
  const to = room.stages.findIndex((stage) => stage.name === rule.to)
  if (to <= from) return
  const skipped: string[] = []
  for (let index = from + 1; index < to; index++) {
    if (room.stages[index].status !== "pending") continue
    room.stages[index].status = "skipped"
    skipped.push(room.stages[index].title)
  }
  if (skipped.length) note(`${agent.title} said VERDICT: ${verdict}, so ${skipped.join(", ")} ${skipped.length === 1 ? "was" : "were"} skipped. Continuing at ${room.stages[to].title}.`)
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
    environmentId: room.environmentId ?? null,
    slot: room.slot ?? null,
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
