import fs from "node:fs"
import path from "node:path"
import type { SDKAgent, ToolName } from "@cursor/sdk"
import { cursorCustomTools, TOOL_RULES, type RuntimeTools } from "./tools.js"
import type { AgentFile, Packet, SourceDoc } from "./types.js"

export type RunOutput = {
  output: string
  agentId?: string
}

export type StageRunner = (
  packet: Packet,
  onDelta: (text: string) => void,
  tools?: RuntimeTools,
) => Promise<RunOutput>

export function engineName(): "draft" | "cursor-local" | "cursor-cloud" {
  if (!apiKey()) return "draft"
  return process.env.CURSOR_RUNTIME === "cloud" ? "cursor-cloud" : "cursor-local"
}

export function selectRunner(workdir: string): StageRunner {
  if (!apiKey()) {
    return async (packet, onDelta) => {
      const output = runLocal(packet)
      onDelta(output)
      return { output }
    }
  }
  return (packet, onDelta, tools) => runCursor(packet, onDelta, workdir, tools)
}

export function runLocal(packet: Packet): string {
  const confluence = packet.sources.find((source) => source.kind === "confluence")
  return packet.role.draft
    .replaceAll("{{requirement}}", packet.requirement)
    .replaceAll("{{confluence_title}}", confluence?.title ?? "no Confluence page")
    .replaceAll(
      "{{confluence_note}}",
      confluence
        ? `Confluence page "${confluence.title}" was loaded for this role. Cite it in the gap list.`
        : "No Confluence page was loaded for this role.",
    )
    .trim()
}

/** Runtime permission tools need in-process callbacks, so local runtime only. */
export function supportsRuntimeTools(): boolean {
  return engineName() === "cursor-local"
}

export function buildPrompt(packet: Packet, withTools = false): string {
  const notes = packet.notes.length > 0 ? packet.notes.map((note) => `- ${note}`).join("\n") : "None"
  const prior =
    packet.prior.length > 0
      ? packet.prior.map((stage) => `## ${stage.title}\n${stage.output}`).join("\n\n")
      : "None. This is the first role."

  const sources =
    packet.sources.length > 0
      ? packet.sources
          .map((source) => `## ${source.title}\nURL: ${source.url}\n\n${source.body}`)
          .join("\n\n")
      : "None."

  const parts = [
    `You are the ${packet.role.title} in a room of separate roles.`,
    "Reply with only this role's saved output. The next role will receive that text and nothing else from you.",
    "Do not create, edit, or delete files. Do not run commands.",
    "If a source does not contain the answer, record a gap and ask. Do not invent a business or technical requirement.",
    "Never mention access tokens, refresh tokens, API keys, or credentials.",
    "Cite shared memory entries when you reuse a gap, decision, test, or approval.",
    ...(withTools ? ["", TOOL_RULES] : []),
    "",
    "# Role instructions",
    packet.role.instructions,
    "",
    ...(packet.role.skipIf?.length
      ? [
          "# Verdict line",
          `End your reply with one last line in exactly this form: VERDICT: <word>. Use ${packet.role.skipIf.map((rule) => `"${rule.verdict}"`).join(" or ")} only when it truly applies; it makes the run skip ahead. Otherwise use VERDICT: continue.`,
          "",
        ]
      : []),
    "# Project file",
    packet.projectMarkdown.trim(),
    "",
    "# Requirement",
    packet.requirement,
    "",
    "# Shared project memory",
    packet.memory || "None yet.",
    "",
    "# Sources loaded for this role",
    sources,
    "",
    "# Notes from the person",
    notes,
    "",
    "# Earlier role outputs",
    prior,
  ]
  if (packet.dmHistory) {
    parts.push("", "# Direct message thread with the person", packet.dmHistory)
  }
  return parts.join("\n")
}

async function runCursor(
  packet: Packet,
  onDelta: (text: string) => void,
  workdir: string,
  tools?: RuntimeTools,
): Promise<RunOutput> {
  const key = apiKey()
  if (!key) throw new Error("CURSOR_API_KEY is not set")

  fs.mkdirSync(workdir, { recursive: true })
  const { Agent, CursorAgentError } = await import("@cursor/sdk")
  const liveTools = tools && supportsRuntimeTools() ? tools : undefined
  const prompt = buildPrompt(packet, Boolean(liveTools))
  fs.writeFileSync(path.join(workdir, "last-prompt.md"), prompt)

  try {
    await using agent = await Agent.create({
      ...agentOptions(key, packet.role.reasoning),
      ...runtimeOptions(workdir, liveTools, codeDirs(packet.sources)),
    })
    return await sendAndWait(agent, prompt, packet.role.name, onDelta)
  } catch (error) {
    if (error instanceof CursorAgentError) {
      throw new Error(`Cursor did not start: ${error.message}`)
    }
    throw error
  }
}

/** One speaker turn in a multi-turn conversation (group chat). */
export type TurnInput = {
  role: AgentFile
  /** Cursor agent from this speaker's earlier turns; resumed so it keeps its own context. */
  agentId: string | null
  /** Full context for a fresh agent: role, sources, rules and the transcript so far. */
  fullPrompt: () => Promise<string>
  /** Only what is new since this speaker last spoke. Sent when the agent is resumed. */
  followUp: string
  /** Offline reply used in draft mode. */
  draft: string
  tools?: RuntimeTools
  /** Code snapshot folders this speaker may read. */
  dirs?: string[]
}

export type TurnRunner = (input: TurnInput, onDelta: (text: string) => void) => Promise<RunOutput>

export function selectTurnRunner(workdir: string): TurnRunner {
  if (!apiKey()) {
    return async (input, onDelta) => {
      onDelta(input.draft)
      return { output: input.draft }
    }
  }
  return (input, onDelta) => runCursorTurn(input, onDelta, workdir)
}

async function runCursorTurn(input: TurnInput, onDelta: (text: string) => void, workdir: string): Promise<RunOutput> {
  const key = apiKey()
  if (!key) throw new Error("CURSOR_API_KEY is not set")

  fs.mkdirSync(workdir, { recursive: true })
  const { Agent, CursorAgentError } = await import("@cursor/sdk")
  const liveTools = input.tools && supportsRuntimeTools() ? input.tools : undefined
  const options = { ...agentOptions(key, input.role.reasoning), ...runtimeOptions(workdir, liveTools, input.dirs) }

  try {
    if (input.agentId) {
      try {
        await using resumed = await Agent.resume(input.agentId, options)
        return await sendAndWait(resumed, input.followUp, input.role.name, onDelta)
      } catch (error) {
        // The local agent store may have lost it; start fresh with the full transcript.
        console.warn(`cursor resume failed role=${input.role.name}: ${error instanceof Error ? error.message : error}`)
      }
    }
    const prompt = await input.fullPrompt()
    fs.writeFileSync(path.join(workdir, `last-prompt-${input.role.name}.md`), prompt)
    await using agent = await Agent.create(options)
    return await sendAndWait(agent, prompt, input.role.name, onDelta)
  } catch (error) {
    if (error instanceof CursorAgentError) {
      throw new Error(`Cursor did not start: ${error.message}`)
    }
    throw error
  }
}

export const DEFAULT_MODEL = "composer-2.5"

/**
 * Which model an agent runs on. The default is CURSOR_MODEL, the low-cost tool-capable one. An agent marked for deep
 * reasoning uses CURSOR_REASONING_MODEL (with optional CURSOR_REASONING_PARAMS like "effort=high"). When that is not
 * set, the agent stays on the default: nothing silently moves to a pricier model.
 */
export function modelFor(reasoning: boolean): { id: string; params?: { id: string; value: string }[]; deep: boolean } {
  const base = process.env.CURSOR_MODEL?.trim() || DEFAULT_MODEL
  const deepId = process.env.CURSOR_REASONING_MODEL?.trim()
  if (!reasoning || !deepId) return { id: base, deep: false }
  const params = (process.env.CURSOR_REASONING_PARAMS ?? "")
    .split(",")
    .map((pair) => pair.split("=").map((part) => part.trim()))
    .filter(([id, value]) => id && value)
    .map(([id, value]) => ({ id, value }))
  return { id: deepId, ...(params.length ? { params } : {}), deep: true }
}

function agentOptions(key: string, reasoning = false) {
  const { id, params } = modelFor(reasoning)
  return {
    apiKey: key,
    model: { id, ...(params ? { params } : {}) },
    mode: "agent" as const,
  }
}

async function sendAndWait(
  agent: SDKAgent,
  prompt: string,
  roleName: string,
  onDelta: (text: string) => void,
): Promise<RunOutput> {
  let streamed = ""
  const run = await agent.send(prompt, {
    onDelta: ({ update }) => {
      if (update.type === "text-delta" && update.text) {
        streamed += update.text
        onDelta(update.text)
      }
    },
  })
  console.log(`cursor role=${roleName} agent=${agent.agentId} run=${run.id}`)
  const result = await run.wait()
  if (result.status === "error") {
    throw new Error(result.error?.message ?? `Cursor run ${run.id} failed`)
  }
  if (result.status === "cancelled") {
    throw new Error(`Cursor run ${run.id} was cancelled`)
  }
  const output = (result.result ?? streamed).trim()
  if (!output) throw new Error(`Cursor run ${run.id} returned an empty reply`)
  return { output, agentId: agent.agentId }
}

/** Code snapshot folders the agent may read with its read/grep/glob tools. */
export function codeDirs(sources: SourceDoc[]): string[] {
  return sources.flatMap((source) => (source.localPath ? [source.localPath] : []))
}

function runtimeOptions(workdir: string, tools?: RuntimeTools, dirs: string[] = []) {
  if (process.env.CURSOR_RUNTIME === "cloud") {
    const url = process.env.CURSOR_REPO?.trim()
    return {
      cloud: {
        repos: url ? [{ url, startingRef: process.env.CURSOR_REF?.trim() || undefined }] : [],
      },
    }
  }
  return {
    // Agents reach outside systems only through write tools that ask the person first.
    disallowedTools: ["shell", "edit", "delete", "applyAgentDiff"] as ToolName[],
    local: {
      cwd: workdir,
      ...(dirs.length ? { dirs } : {}),
      settingSources: [] as ("project" | "user" | "team" | "mdm" | "plugins" | "all")[],
      ...(tools ? { customTools: cursorCustomTools(tools) } : {}),
    },
  }
}

function apiKey(): string | undefined {
  const key = process.env.CURSOR_API_KEY?.trim()
  return key || undefined
}
