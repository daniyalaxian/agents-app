import fs from "node:fs"
import path from "node:path"
import type { Packet } from "./types.js"

export type RunOutput = {
  output: string
  agentId?: string
}

export type StageRunner = (packet: Packet, onDelta: (text: string) => void) => Promise<RunOutput>

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
  return (packet, onDelta) => runCursor(packet, onDelta, workdir)
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

export function buildPrompt(packet: Packet): string {
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
    "",
    "# Role instructions",
    packet.role.instructions,
    "",
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

async function runCursor(packet: Packet, onDelta: (text: string) => void, workdir: string): Promise<RunOutput> {
  const key = apiKey()
  if (!key) throw new Error("CURSOR_API_KEY is not set")

  fs.mkdirSync(workdir, { recursive: true })
  const { Agent, CursorAgentError } = await import("@cursor/sdk")
  const prompt = buildPrompt(packet)
  fs.writeFileSync(path.join(workdir, "last-prompt.md"), prompt)

  try {
    await using agent = await Agent.create({
      apiKey: key,
      model: { id: process.env.CURSOR_MODEL?.trim() || "composer-2.5" },
      mode: "agent",
      ...runtimeOptions(workdir),
    })

    let streamed = ""
    const run = await agent.send(prompt, {
      onDelta: ({ update }) => {
        if (update.type === "text-delta" && update.text) {
          streamed += update.text
          onDelta(update.text)
        }
      },
    })
    console.log(`cursor role=${packet.role.name} agent=${agent.agentId} run=${run.id}`)
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
  } catch (error) {
    if (error instanceof CursorAgentError) {
      throw new Error(`Cursor did not start: ${error.message}`)
    }
    throw error
  }
}

function runtimeOptions(workdir: string) {
  if (process.env.CURSOR_RUNTIME === "cloud") {
    const url = process.env.CURSOR_REPO?.trim()
    return {
      cloud: {
        repos: url ? [{ url, startingRef: process.env.CURSOR_REF?.trim() || undefined }] : [],
      },
    }
  }
  return {
    local: {
      cwd: workdir,
      settingSources: [] as ("project" | "user" | "team" | "mdm" | "plugins" | "all")[],
    },
  }
}

function apiKey(): string | undefined {
  const key = process.env.CURSOR_API_KEY?.trim()
  return key || undefined
}
