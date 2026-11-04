import fs from "node:fs"
import path from "node:path"
import { loadAgents, parseAgent } from "./agents.js"
import type { AgentFile } from "./types.js"

export type CatalogAgent = AgentFile & {
  origin: "prebuilt" | "custom"
  workspaceId: string | null
  tools: string[]
  clonedFrom: string | null
}

const WRITE_TOOLS = new Set(["jira", "confluence", "figma", "github", "jenkins", "git", "repo"])

export function prebuiltAgents(root: string): CatalogAgent[] {
  return loadAgents(path.join(root, "agents")).map((agent) => ({
    ...agent,
    origin: "prebuilt" as const,
    workspaceId: null,
    tools: inferTools(agent.instructions),
    clonedFrom: null,
  }))
}

export function customDir(root: string, workspaceId: string): string {
  return path.join(root, "data", "custom-agents", workspaceId)
}

export function customAgents(root: string, workspaceId: string): CatalogAgent[] {
  const dir = customDir(root, workspaceId)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => {
      const agent = parseAgent(path.join(dir, name), name)
      const meta = readExtraMeta(path.join(dir, name))
      return {
        ...agent,
        origin: "custom" as const,
        workspaceId,
        tools: meta.tools,
        clonedFrom: meta.clonedFrom,
        needsApproval: agent.needsApproval,
      }
    })
}

export { serializeAgent }

export function listCatalog(root: string, workspaceId: string | null): CatalogAgent[] {
  const prebuilt = prebuiltAgents(root)
  if (!workspaceId) return prebuilt
  return [...prebuilt, ...customAgents(root, workspaceId)]
}

export function findCatalogAgent(
  root: string,
  workspaceId: string | null,
  name: string,
): CatalogAgent | null {
  return listCatalog(root, workspaceId).find((agent) => agent.name === name) || null
}

export function duplicateAgent(
  root: string,
  workspaceId: string,
  sourceName: string,
  overrides?: { name?: string; title?: string },
): CatalogAgent {
  const source = findCatalogAgent(root, workspaceId, sourceName)
  if (!source) throw new Error(`Agent ${sourceName} not found`)

  const baseName = (overrides?.name || `${source.name}-custom`).toLowerCase().replace(/[^a-z0-9-]+/g, "-")
  let name = baseName.slice(0, 48) || "custom-agent"
  const existing = new Set(listCatalog(root, workspaceId).map((item) => item.name))
  let n = 2
  while (existing.has(name)) {
    name = `${baseName}-${n++}`.slice(0, 48)
  }

  const title = overrides?.title || `${source.title} (custom)`
  const tools = source.tools
  const needsApproval = source.needsApproval || tools.some((tool) => WRITE_TOOLS.has(tool))
  const markdown = serializeAgent({
    name,
    title,
    needsApproval,
    tools,
    clonedFrom: source.name,
    instructions: source.instructions,
    draft: source.draft,
    sources: source.sources,
    kitDirs: source.kitDirs,
    toolkit: source.toolkit,
  })

  const dir = customDir(root, workspaceId)
  fs.mkdirSync(dir, { recursive: true })
  const fileName = `${name}.md`
  fs.writeFileSync(path.join(dir, fileName), markdown)
  return findCatalogAgent(root, workspaceId, name)!
}

export type CreateResult = { agent: CatalogAgent; notes: string[] }

const MAX_PASTE = 100_000
const SOURCE_NAMES = new Set(["brd", "figma", "repos", "deploy"])

/**
 * Creates a custom agent from pasted markdown. Forgiving on purpose: front matter and a Draft section are optional and
 * filled in when missing. Only name, title, tools, needs_approval and sources are read from front matter; kit_dirs and
 * toolkit are import-only (they point at folders on this computer), so a paste cannot set them.
 * Write tools always force needs_approval. `notes` says what was filled in or changed, so the person is never surprised.
 */
export function createAgentFromMarkdown(
  root: string,
  workspaceId: string,
  markdown: string,
  hint?: { name?: string; title?: string },
): CreateResult {
  const text = markdown.replace(/\r\n/g, "\n").trim()
  if (!text) throw new Error("Paste the agent's markdown first")
  if (text.length > MAX_PASTE) throw new Error("That is too long for one agent (limit 100,000 characters)")
  const notes: string[] = []

  const matched = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const fields: Record<string, string> = {}
  let body = text
  if (matched) {
    body = matched[2].trim()
    for (const line of matched[1].split("\n")) {
      const at = line.indexOf(":")
      if (at > 0) fields[line.slice(0, at).trim()] = line.slice(at + 1).trim()
    }
    if (fields.kit_dirs || fields.toolkit) notes.push("Ignored kit_dirs and toolkit: those are set by importing a kit.")
  }

  const heading = body.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim()
  const title = (hint?.title || fields.title || heading || "").slice(0, 80)
  if (!title) throw new Error("The agent needs a title: add a '# Title' line, or a title: line in the front matter")
  if (!fields.title && !hint?.title) notes.push(`Title taken from the heading: ${title}`)

  const wanted = (hint?.name || fields.name || title).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48)
  const base = wanted || "custom-agent"
  const existing = new Set(listCatalog(root, workspaceId).map((item) => item.name))
  let name = base
  for (let n = 2; existing.has(name); n++) name = `${base}-${n}`.slice(0, 48)
  if (name !== base) notes.push(`The name ${base} was taken, so this agent is ${name}.`)

  const draftAt = body.search(/^## Draft\s*$/m)
  const instructions = (draftAt === -1 ? body : body.slice(0, draftAt)).trim()
  if (!instructions) throw new Error("The agent has no instructions")
  let draft = draftAt === -1 ? "" : body.slice(draftAt).replace(/^## Draft\s*/, "").trim()
  if (!draft) {
    draft = `Offline sample from ${title} for: {{requirement}}\n\nNo offline draft was provided. Add a Cursor key for a real answer.`
    notes.push("No ## Draft section, so a placeholder offline reply was added.")
  }

  const tools = fields.tools !== undefined
    ? fields.tools.split(",").map((tool) => tool.toLowerCase().trim()).filter(Boolean)
    : inferTools(instructions)
  const writes = tools.some((tool) => WRITE_TOOLS.has(tool))
  const asked = fields.needs_approval === "true"
  if (writes && !asked) notes.push("This agent can write to external systems, so it will pause for your OK after it runs.")

  const sources = fields.sources
    ? fields.sources.split(",").map((part) => part.trim()).filter((part) => SOURCE_NAMES.has(part))
    : undefined

  const out = serializeAgent({
    name,
    title,
    needsApproval: asked || writes,
    tools,
    clonedFrom: null,
    instructions,
    draft,
    ...(sources ? { sources } : {}),
  })
  const dir = customDir(root, workspaceId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${name}.md`), out)
  return { agent: findCatalogAgent(root, workspaceId, name)!, notes }
}

export function updateCustomAgent(
  root: string,
  workspaceId: string,
  name: string,
  patch: {
    title?: string
    instructions?: string
    draft?: string
    needsApproval?: boolean
    tools?: string[]
  },
): CatalogAgent {
  const current = customAgents(root, workspaceId).find((agent) => agent.name === name)
  if (!current) throw new Error("Only custom agents can be edited")

  const tools = (patch.tools ?? current.tools).map((tool) => tool.toLowerCase().trim()).filter(Boolean)
  let needsApproval = patch.needsApproval ?? current.needsApproval
  if (tools.some((tool) => WRITE_TOOLS.has(tool)) && !needsApproval) {
    throw new Error("Write tools require needs_approval=true")
  }
  if (tools.some((tool) => WRITE_TOOLS.has(tool))) needsApproval = true

  const markdown = serializeAgent({
    name,
    title: patch.title ?? current.title,
    needsApproval,
    tools,
    clonedFrom: current.clonedFrom,
    instructions: patch.instructions ?? current.instructions,
    draft: patch.draft ?? current.draft,
    sources: current.sources,
    kitDirs: current.kitDirs,
    toolkit: current.toolkit,
  })
  fs.writeFileSync(path.join(customDir(root, workspaceId), `${name}.md`), markdown)
  return findCatalogAgent(root, workspaceId, name)!
}

export function deleteCustomAgent(root: string, workspaceId: string, name: string): void {
  const file = path.join(customDir(root, workspaceId), `${name}.md`)
  if (!fs.existsSync(file)) throw new Error("Custom agent not found")
  fs.unlinkSync(file)
}

export function resolveTeamAgents(
  root: string,
  workspaceId: string | null,
  agentNames: string[],
  approvalMap?: Record<string, boolean>,
  reasoning: string[] = [],
): AgentFile[] {
  const catalog = listCatalog(root, workspaceId)
  const byName = new Map(catalog.map((agent) => [agent.name, agent]))
  const resolved: AgentFile[] = []
  for (const name of agentNames) {
    const agent = byName.get(name)
    if (!agent) throw new Error(`Team references unknown agent: ${name}`)
    const override = approvalMap?.[name]
    resolved.push({
      name: agent.name,
      title: agent.title,
      needsApproval: typeof override === "boolean" ? override : agent.needsApproval,
      file: agent.file,
      instructions: agent.instructions,
      draft: agent.draft,
      sources: agent.sources,
      kitDirs: agent.kitDirs,
      toolkit: agent.toolkit,
      ...(reasoning.includes(name) ? { reasoning: true } : {}),
    })
  }
  if (!resolved.length) throw new Error("Team has no agents")
  return resolved
}

function inferTools(instructions: string): string[] {
  const found = new Set<string>()
  const text = instructions.toLowerCase()
  for (const tool of WRITE_TOOLS) {
    if (text.includes(tool)) found.add(tool === "git" || tool === "repo" ? "github" : tool)
  }
  return [...found]
}

function readExtraMeta(filePath: string): { tools: string[]; clonedFrom: string | null } {
  const raw = fs.readFileSync(filePath, "utf8")
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return { tools: [], clonedFrom: null }
  const fields: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(":")
    if (at === -1) continue
    fields[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  const tools = (fields.tools || "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
  return { tools, clonedFrom: fields.cloned_from || null }
}

function serializeAgent(input: {
  name: string
  title: string
  needsApproval: boolean
  tools: string[]
  clonedFrom: string | null
  instructions: string
  draft: string
  sources?: string[]
  kitDirs?: string[]
  toolkit?: string
}): string {
  const extra =
    (input.toolkit ? `
toolkit: ${input.toolkit}` : "") +
    (input.sources ? `
sources: ${input.sources.join(", ")}` : "") +
    (input.kitDirs?.length ? `
kit_dirs: ${input.kitDirs.join(" | ")}` : "")
  const toolsLine = input.tools.length ? `\ntools: ${input.tools.join(", ")}` : "\ntools:"
  const cloned = input.clonedFrom ? `\ncloned_from: ${input.clonedFrom}` : ""
  const draftBody = input.draft.startsWith("## Draft")
    ? input.draft
    : `## Draft\n\n${input.draft}`
  return `---
name: ${input.name}
title: ${input.title}
needs_approval: ${input.needsApproval ? "true" : "false"}${toolsLine}${cloned}${extra}
---

${input.instructions.trim()}

${draftBody.trim()}
`
}
