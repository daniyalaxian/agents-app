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
