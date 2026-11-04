import fs from "node:fs"
import path from "node:path"
import { codeDirs, runLocal, type TurnRunner } from "./runner.js"
import { TOOL_RULES, type RuntimeTools } from "./tools.js"
import type { AgentFile, ChatMessage, Room, SourceDoc } from "./types.js"

/** First sprint step: analyst, lead and QA talk the BRS through together. */
export const DEFAULT_MEMBERS = ["sa", "software-lead", "qa-design"]

export type GroupStatus = "idle" | "running" | "waiting" | "done" | "error"

export type GroupThread = {
  roomId: string
  members: string[]
  messages: ChatMessage[]
  /** Cursor agent per member, resumed every turn so each keeps its own context. */
  agentIds: Record<string, string>
  /** How many messages each member has already seen. */
  seen: Record<string, number>
  /** Members that ended their last turn with [[DONE]]. */
  done: Record<string, boolean>
  /** Who speaks next when someone handed over the floor or @mentioned them. */
  nextSpeaker: string | null
  /** Digest of the sources each member last received, so resumed agents get new or changed ones. */
  sourcesSeen: Record<string, string>
  /** Digest of the tool instructions each member last received (tools added later reach resumed agents). */
  toolsSeen: Record<string, string>
  status: GroupStatus
  waitingReason: string | null
  updatedAt: string
}

export type GroupDeps = {
  agents: AgentFile[]
  runner: TurnRunner
  requirement: string
  maxTurns: number
  /** Setup sources (BRS, Figma, repos) for a member, loaded every turn so later changes reach it. */
  sourcesFor: (agent: AgentFile) => Promise<SourceDoc[]>
  /** Role, project, requirement, memory and sources for a member's first turn. */
  contextFor: (agent: AgentFile, sources: SourceDoc[]) => Promise<string>
  toolsFor?: (agent: AgentFile) => RuntimeTools | undefined
  withTools?: boolean
  onThread?: (thread: GroupThread) => void
  onDelta?: (agent: AgentFile, text: string) => void
  onMessage?: (agent: AgentFile, message: ChatMessage) => void
  shouldPause?: () => boolean
}

export function groupPath(root: string, roomId: string): string {
  return path.join(root, "data", "groups", `${safe(roomId)}.json`)
}

export function newGroup(roomId: string, members = DEFAULT_MEMBERS): GroupThread {
  return {
    roomId,
    members: [...members],
    messages: [],
    agentIds: {},
    seen: {},
    done: {},
    nextSpeaker: null,
    sourcesSeen: {},
    toolsSeen: {},
    status: "idle",
    waitingReason: null,
    updatedAt: new Date().toISOString(),
  }
}

/** `members` is who the team wants in the discussion. An existing thread keeps its own once anyone has spoken. */
export function readGroup(root: string, roomId: string, members: string[] = DEFAULT_MEMBERS): GroupThread {
  const file = groupPath(root, roomId)
  if (!fs.existsSync(file)) return newGroup(roomId, members)
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as GroupThread
    const thread = { ...newGroup(roomId, raw.members?.length ? raw.members : members), ...raw }
    if (!thread.messages.length) thread.members = [...members] // not started: follow the team's current choice
    // A turn cannot survive a server restart.
    if (thread.status === "running") {
      thread.status = "waiting"
      thread.waitingReason = "The server restarted during a turn. Continue to resume."
    }
    return thread
  } catch {
    return newGroup(roomId, members)
  }
}

export function writeGroup(root: string, thread: GroupThread): void {
  const file = groupPath(root, thread.roomId)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  thread.updatedAt = new Date().toISOString()
  fs.writeFileSync(file, JSON.stringify(thread, null, 2))
}

/** A person's message. Mentions route the next turn; any new input re-opens the discussion. */
export function addHumanMessage(thread: GroupThread, body: string, agents: AgentFile[]): void {
  thread.messages.push({
    id: crypto.randomUUID(),
    kind: "human",
    title: "You",
    body,
    at: new Date().toISOString(),
    speaker: "human",
  })
  const mentioned = parseMentions(body, agents).filter((name) => thread.members.includes(name))
  if (mentioned.length) {
    thread.nextSpeaker = mentioned[0]
    for (const name of mentioned) thread.done[name] = false
  } else {
    thread.done = {}
  }
  if (thread.status === "done" || thread.status === "error") thread.status = "waiting"
  thread.waitingReason = null
}

/** Handle names a person or agent can @mention: name, its parts, and title initials. */
export function aliasesFor(agent: AgentFile): string[] {
  const initials = agent.title
    .split(/\s+/)
    .map((word) => word[0] ?? "")
    .join("")
  return [...new Set([agent.name, ...agent.name.split("-"), initials].map((item) => item.toLowerCase()))]
}

export function resolveAlias(handle: string, agents: AgentFile[]): string | null {
  const wanted = handle.toLowerCase()
  const exact = agents.find((agent) => agent.name === wanted)
  if (exact) return exact.name
  return agents.find((agent) => aliasesFor(agent).includes(wanted))?.name ?? null
}

export function parseMentions(text: string, agents: AgentFile[]): string[] {
  const found: string[] = []
  for (const match of text.matchAll(/@([a-z][\w-]*)/gi)) {
    const name = resolveAlias(match[1], agents)
    if (name && !found.includes(name)) found.push(name)
  }
  return found
}

export type TurnTag = { kind: "next" | "done" | "ask" | null; next: string | null; body: string }

/** Read the closing [[NEXT: x]] / [[DONE]] / [[ASK]] tag and strip all tags from the body. */
export function parseTurnTag(output: string): TurnTag {
  const tags = [...output.matchAll(/\[\[\s*(NEXT\s*:\s*@?([\w-]+)|DONE|ASK)\s*\]\]/gi)]
  const body = output.replace(/\[\[\s*(NEXT\s*:\s*@?[\w-]+|DONE|ASK)\s*\]\]/gi, "").trim()
  const last = tags.at(-1)
  if (!last) return { kind: null, next: null, body }
  const word = last[1].toUpperCase()
  if (word.startsWith("NEXT")) return { kind: "next", next: last[2], body }
  return { kind: word === "DONE" ? "done" : "ask", next: null, body }
}

/**
 * Who speaks next:
 * 1. the person's @mention (or a floor handed over right after the person spoke),
 * 2. a member who has waited too long (two agents must not ping-pong and starve the third),
 * 3. the floor handed over with [[NEXT: name]],
 * 4. a teammate @mentioned in the last message,
 * 5. the member not done who spoke least recently.
 */
export function pickNextSpeaker(thread: GroupThread, agents: AgentFile[]): string | null {
  const last = thread.messages.at(-1)
  const handed =
    thread.nextSpeaker && thread.members.includes(thread.nextSpeaker) && thread.nextSpeaker !== last?.speaker
      ? thread.nextSpeaker
      : null
  if (last?.kind === "human" && handed) return handed

  const waits = new Map(thread.members.map((name) => [name, turnsSinceSpoke(thread, name)]))
  const starved = thread.members
    .filter((name) => !thread.done[name] && (waits.get(name) ?? 0) >= thread.members.length * 2)
    .sort((a, b) => (waits.get(b) ?? 0) - (waits.get(a) ?? 0))[0]
  if (starved) return starved

  if (handed) return handed
  if (last) {
    // A question to a teammate reopens them even if they said DONE; maxTurns bounds ping-pong.
    const mentioned = parseMentions(last.body, agents).find(
      (name) => thread.members.includes(name) && name !== last.speaker,
    )
    if (mentioned) return mentioned
  }
  const open = thread.members.filter((name) => !thread.done[name])
  // Stable sort keeps member order for ties (nobody has spoken yet).
  return open.sort((a, b) => (waits.get(b) ?? 0) - (waits.get(a) ?? 0))[0] ?? null
}

/** Agent turns since `name` last spoke; members who never spoke count every agent turn plus one. */
function turnsSinceSpoke(thread: GroupThread, name: string): number {
  const agentTurns = thread.messages.filter((message) => message.kind === "agent")
  const lastIndex = agentTurns.map((message) => message.speaker).lastIndexOf(name)
  return lastIndex === -1 ? agentTurns.length + 1 : agentTurns.length - 1 - lastIndex
}

export async function runGroup(thread: GroupThread, deps: GroupDeps): Promise<GroupThread> {
  thread.status = "running"
  thread.waitingReason = null
  deps.onThread?.(thread)

  for (let turn = 0; turn < deps.maxTurns; turn++) {
    if (deps.shouldPause?.()) return stop(thread, deps, "waiting", "Paused. Add a message or Continue.")

    const name = pickNextSpeaker(thread, deps.agents)
    if (!name) {
      return stop(thread, deps, "done", "Everyone is done for now. Add a message to reopen the discussion.")
    }
    const agent = deps.agents.find((item) => item.name === name)
    if (!agent) return stop(thread, deps, "error", `No agent file for ${name}`)

    const unseen = thread.messages.slice(thread.seen[name] ?? 0)
    const others = deps.agents.filter((item) => thread.members.includes(item.name) && item.name !== name)
    thread.nextSpeaker = null

    try {
      const sources = await deps.sourcesFor(agent)
      const digest = sourcesDigest(sources)
      // A resumed agent only gets the follow-up, so resend sources it has not seen (incl. older threads).
      const sourcesChanged = Boolean(thread.agentIds[name]) && thread.sourcesSeen[name] !== digest
      const toolRules = deps.withTools ? TOOL_RULES : ""
      const toolsDigest = sourcesDigest([{ kind: "paste", title: "tools", url: "", body: toolRules }])
      const toolsChanged = Boolean(thread.agentIds[name]) && Boolean(toolRules) && thread.toolsSeen[name] !== toolsDigest
      const result = await deps.runner(
        {
          role: agent,
          agentId: thread.agentIds[name] ?? null,
          fullPrompt: async () =>
            [
              await deps.contextFor(agent, sources),
              groupRules(agent, others, Boolean(deps.withTools)),
              "# Group chat so far",
              transcript(thread.messages) || "No messages yet. You speak first.",
            ].join("\n\n"),
          followUp: [
            identityReminder(agent, others),
            "",
            ...personRecap(thread),
            ...(toolsChanged ? ["# Your tools changed since your last turn", toolRules, ""] : []),
            ...(sourcesChanged
              ? ["# Sources changed since your last turn (these replace what you had)", formatSources(sources), ""]
              : []),
            "New in the group chat since your last message:",
            transcript(unseen) || "(nothing new)",
            "",
            "Reply as your role. End with [[NEXT: name]], [[ASK]] or [[DONE]].",
          ].join("\n"),
          draft: draftTurn(agent, deps.requirement, thread, unseen),
          tools: deps.toolsFor?.(agent),
          dirs: codeDirs(sources),
        },
        (text) => deps.onDelta?.(agent, text),
      )

      const tag = parseTurnTag(result.output)
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        kind: "agent",
        title: agent.title,
        body: tag.body || "(no reply)",
        at: new Date().toISOString(),
        agentId: result.agentId,
        speaker: name,
      }
      thread.messages.push(message)
      if (result.agentId) thread.agentIds[name] = result.agentId
      thread.seen[name] = thread.messages.length
      thread.sourcesSeen[name] = digest
      thread.toolsSeen[name] = toolsDigest
      thread.done[name] = tag.kind === "done"
      const handedTo = tag.next ? resolveAlias(tag.next, deps.agents) : null
      thread.nextSpeaker = handedTo && handedTo !== name && thread.members.includes(handedTo) ? handedTo : null
      deps.onMessage?.(agent, message)

      if (tag.kind === "ask") return stop(thread, deps, "waiting", `${agent.title} is waiting for your answer.`)
      deps.onThread?.(thread)
    } catch (error) {
      thread.messages.push({
        id: crypto.randomUUID(),
        kind: "agent",
        title: agent.title,
        body: error instanceof Error ? error.message : "The turn failed",
        at: new Date().toISOString(),
        speaker: name,
      })
      return stop(thread, deps, "error", `${agent.title} failed. Continue to retry.`)
    }
  }
  return stop(thread, deps, "waiting", `Reached ${deps.maxTurns} turns. Add a message or Continue.`)
}

/**
 * Kickoff replaces the first pipeline roles: each member's group messages become its stage
 * output, so runUntilWait continues at the next pending role (Architecture) with them as prior.
 */
export function handoffStages(room: Room, thread: GroupThread): Room {
  const next: Room = { ...room, stages: room.stages.map((stage) => ({ ...stage })), messages: [...room.messages] }
  const handed: string[] = []
  for (const stage of next.stages) {
    if (!thread.members.includes(stage.name) || stage.status === "done") continue
    const said = thread.messages.filter((message) => message.speaker === stage.name).map((message) => message.body)
    stage.status = "done"
    stage.output = [
      "Kickoff discussion (group chat)",
      "",
      said.length ? said.join("\n\n---\n\n") : "This role did not speak in the kickoff.",
    ].join("\n")
    stage.agentId = thread.agentIds[stage.name] ?? null
    handed.push(stage.title)
  }
  next.messages.push({
    id: crypto.randomUUID(),
    kind: "agent",
    title: "Room",
    body: `Kickoff handed off to Build${handed.length ? ` (${handed.join(", ")})` : ""}.`,
    at: new Date().toISOString(),
  })
  return next
}

export function groupContext(input: {
  agent: AgentFile
  projectMarkdown: string
  requirement: string
  memory: string
  sources: SourceDoc[]
  notes: string[]
}): string {
  const sources = formatSources(input.sources)
  return [
    "If a source does not contain the answer, record a gap and ask. Do not invent a business or technical requirement.",
    "Never mention access tokens, refresh tokens, API keys, or credentials.",
    "Do not create, edit, or delete files. Do not run commands.",
    "",
    "# Role instructions",
    input.agent.instructions,
    "",
    "# Project file",
    input.projectMarkdown.trim(),
    "",
    "# Requirement",
    input.requirement,
    "",
    "# Shared project memory",
    input.memory || "None yet.",
    "",
    "# Sources loaded for this role",
    sources,
    "",
    "# Notes from the person",
    input.notes.length ? input.notes.map((note) => `- ${note}`).join("\n") : "None",
  ].join("\n")
}

function groupRules(agent: AgentFile, others: AgentFile[], withTools: boolean): string {
  const team = others.map((item) => `${item.title} (@${item.name})`).join(", ")
  return [
    "# Group chat",
    `You are the ${agent.title} (@${agent.name}) in a group chat with ${team || "no teammates"} and a person.`,
    `- Speak only as the ${agent.title}. Never write lines for teammates.`,
    "- Build on what teammates said. Challenge anything that conflicts with the BRS, Figma or existing code, and cite the source.",
    "- Ask a teammate directly with @name. Ask the person only when no source or teammate can answer.",
    "- Keep each message short and about what is new. Do not repeat earlier messages.",
    "- Make your role's write-backs (comments, stories, test cases) only after the group agrees on them.",
    "- The person's answers are decisions. Record them and move on; do not ask the group or the person to re-confirm them.",
    "- There is one gap register, kept by the System Analyst. Others propose items; the System Analyst posts the full updated register whenever it changes.",
    "- End every message with exactly one tag on its own line:",
    "  [[NEXT: name]] to hand the floor to a teammate,",
    "  [[ASK]] when the person must answer before anyone continues,",
    "  [[DONE]] when you have nothing more to add right now.",
    ...(withTools ? ["", TOOL_RULES] : []),
  ].join("\n")
}

/**
 * Long resumed sessions get compacted and small models drift into a teammate's role,
 * so every turn restates who the speaker is.
 */
function identityReminder(agent: AgentFile, others: AgentFile[]): string {
  const team = others.map((item) => `${item.title} (@${item.name})`).join(", ")
  return [
    `# You are the ${agent.title} (@${agent.name})`,
    `Write only as the ${agent.title}. Your teammates are ${team || "none"}; never write their lines, never start your message with their name, and do not address yourself (@${agent.name}).`,
    `If a teammate asks the ${agent.title} to do something, that is you: do it now with your tools, or say why you cannot.`,
  ].join("\n")
}

/** Everything the person has said, so their answers survive context compaction. Treat these as decisions. */
function personRecap(thread: GroupThread): string[] {
  const said = thread.messages.filter((message) => message.kind === "human")
  if (!said.length) return []
  const lines = said.slice(-30).map((message) => `- ${message.at.slice(0, 16).replace("T", " ")}: ${message.body.replace(/\s+/g, " ").slice(0, 400)}`)
  return [
    "# Everything the person has said in this chat (their answers are decisions; do not ask them to re-confirm)",
    ...lines,
    "",
  ]
}

function formatSources(sources: SourceDoc[]): string {
  return sources.length
    ? sources.map((source) => `## ${source.title}\nURL: ${source.url}\n\n${source.body}`).join("\n\n")
    : "None."
}

/** Cheap fingerprint of the sources; changes when a link, title or body changes. */
export function sourcesDigest(sources: SourceDoc[]): string {
  let hash = 0
  const text = sources.map((source) => `${source.kind}|${source.title}|${source.url}|${source.body}`).join("\n")
  for (let index = 0; index < text.length; index++) hash = (hash * 31 + text.charCodeAt(index)) | 0
  return `${sources.length}:${text.length}:${hash}`
}

function transcript(messages: ChatMessage[]): string {
  return messages
    .map((message) => `### ${message.title}${message.speaker && message.speaker !== "human" ? ` (@${message.speaker})` : ""}\n${message.body}`)
    .join("\n\n")
}

function draftTurn(agent: AgentFile, requirement: string, thread: GroupThread, unseen: ChatMessage[]): string {
  const spoke = thread.messages.some((message) => message.speaker === agent.name)
  if (!spoke) {
    const opening = runLocal({
      requirement,
      projectMarkdown: "",
      role: agent,
      prior: [],
      notes: [],
      sources: [],
      memory: "",
    })
    return `${opening}\n\n_Draft mode: set CURSOR_API_KEY for a live discussion._\n[[DONE]]`
  }
  const ask = [...unseen].reverse().find((message) => message.kind === "human")
  return `Noted${ask ? `: "${ask.body.slice(0, 200)}"` : ""}. Draft mode cannot reason about it; set CURSOR_API_KEY for live replies.\n[[DONE]]`
}

function stop(thread: GroupThread, deps: GroupDeps, status: GroupStatus, reason: string): GroupThread {
  thread.status = status
  thread.waitingReason = reason
  deps.onThread?.(thread)
  return thread
}

function safe(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120)
}
