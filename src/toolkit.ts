import fs from "node:fs"
import path from "node:path"
import { listCatalog, customDir, serializeAgent } from "./catalog.js"
import { createTeam, listTeams, updateTeam } from "./teams.js"

/**
 * Axian Squad import adapter.
 *
 * The kit has no manifest and its agent files have no front matter or Draft section, so this reads the
 * folder layout and the rank table in `.ai/agents/README.md`, then writes platform-format agents into the
 * workspace's custom catalog. The kit's own files are never modified (requirements §7.9).
 */

export const AXIAN_ID = "axian-squad"
export const AXIAN_TEAM = "Axian Squad"

type Profile = {
  /** brd, figma, repos, deploy (see loadSourcesForRole). */
  sources: string[]
  /** Systems this agent writes to after approval. Listed only when the stage is gated (write tools force needs_approval). */
  tools: string[]
  /** Stops for a person to review its output before the next agent (requirements §7.4). */
  gate: boolean
}

// First-party knowledge of the Axian agents (requirements §7.8). Unknown agents import with no sources.
const PROFILES: Record<string, Profile> = {
  DesignAgent: { sources: ["brd", "figma"], tools: [], gate: false },
  RequirementAgent: { sources: ["brd", "figma", "repos"], tools: ["confluence", "figma", "jira"], gate: true },
  ArchitectAgent: { sources: ["repos"], tools: ["confluence", "jira"], gate: true },
  TestDesignAgent: { sources: ["figma"], tools: [], gate: false },
  StoryAgent: { sources: [], tools: ["jira"], gate: true },
  DeveloperAgent: { sources: ["repos", "figma"], tools: ["github"], gate: true },
  DeployAgent: { sources: ["deploy"], tools: ["jenkins"], gate: true },
  TestExecutionAgent: { sources: ["deploy"], tools: [], gate: false },
  DevOpsAgent: { sources: ["deploy"], tools: [], gate: false },
  PmAgent: { sources: [], tools: [], gate: false },
  AuditorAgent: { sources: ["repos"], tools: [], gate: false },
}

const ROLE_LABELS: Record<string, string> = {
  UiUxDesigner: "UI/UX Designer",
  SystemAnalyst: "System Analyst",
  SolutionArchitect: "Solution Architect",
  QA: "QA",
  Developer: "Developer",
  DevOps: "DevOps",
  ProjectManager: "Project Manager",
  Auditor: "Auditor",
}

/** Ranks that make up the default automation (requirements §7.10). Side agents stay in the catalog only. */
const MAIN_PATH_MAX_RANK = 7

export type ImportedAgent = {
  name: string
  axianName: string
  title: string
  rank: number
  status: "imported" | "updated" | "skipped"
  sources: string[]
  needsApproval: boolean
}

export type ImportReport = {
  toolkit: string
  kitPath: string
  agents: ImportedAgent[]
  team: { id: string; name: string; agentNames: string[] } | null
  warnings: string[]
}

type Found = { axianName: string; file: string; roleFolder: string; rank: number | null; output: string }

export function importAxian(
  root: string,
  workspaceId: string,
  kitPath: string,
  options: { overwrite?: boolean } = {},
): ImportReport {
  const kit = path.resolve(kitPath)
  const agentsDir = path.join(kit, ".ai", "agents")
  if (!fs.existsSync(agentsDir)) {
    throw new Error("This folder is not an Axian kit: .ai/agents was not found")
  }

  const warnings: string[] = []
  const found = discoverAgents(agentsDir, warnings)
  if (!found.length) throw new Error("No agent files found under .ai/agents")

  const dir = customDir(root, workspaceId)
  fs.mkdirSync(dir, { recursive: true })
  const taken = new Set(listCatalog(root, workspaceId).map((agent) => agent.name))

  const agents: ImportedAgent[] = []
  for (const item of found) {
    const profile = PROFILES[item.axianName]
    if (!profile) warnings.push(`${item.axianName}: no import profile; imported with no sources and no approval stop`)
    const p = profile ?? { sources: [], tools: [], gate: false }
    const name = slug(item.axianName)
    const file = path.join(dir, `${name}.md`)
    const exists = fs.existsSync(file)

    if (exists && !options.overwrite) {
      agents.push(summary(item, name, "skipped", p))
      continue
    }
    if (!exists && taken.has(name)) {
      warnings.push(`${item.axianName}: the name ${name} is already used by another agent; skipped`)
      continue
    }

    const original = fs.readFileSync(item.file, "utf8").trim()
    const title = `${item.axianName} — ${ROLE_LABELS[item.roleFolder] ?? item.roleFolder}`
    fs.writeFileSync(
      file,
      serializeAgent({
        name,
        title,
        needsApproval: p.gate,
        tools: p.gate ? p.tools : [],
        clonedFrom: null,
        instructions: `${preamble(kit)}\n\n${original}`,
        draft: draftFor(item.axianName, original),
        sources: p.sources,
        kitDirs: [kit],
        toolkit: AXIAN_ID,
      }),
    )
    agents.push(summary(item, name, exists ? "updated" : "imported", p))
  }

  const main = agents
    .filter((agent) => agent.rank <= MAIN_PATH_MAX_RANK && fs.existsSync(path.join(dir, `${agent.name}.md`)))
    .sort((a, b) => a.rank - b.rank)
  const team = main.length ? upsertTeam(root, workspaceId, main) : null
  return { toolkit: AXIAN_ID, kitPath: kit, agents, team, warnings }
}

function summary(item: Found, name: string, status: ImportedAgent["status"], p: Profile): ImportedAgent {
  return {
    name,
    axianName: item.axianName,
    title: `${item.axianName} — ${ROLE_LABELS[item.roleFolder] ?? item.roleFolder}`,
    rank: item.rank ?? 99,
    status,
    sources: p.sources,
    needsApproval: p.gate,
  }
}

function upsertTeam(root: string, workspaceId: string, main: ImportedAgent[]) {
  const agentNames = main.map((agent) => agent.name)
  const approvalMap = Object.fromEntries(main.map((agent) => [agent.name, agent.needsApproval]))
  const existing = listTeams(root, workspaceId).find((team) => team.workspaceId === workspaceId && team.name === AXIAN_TEAM)
  const team = existing
    ? updateTeam(root, workspaceId, existing.id, { agentNames, approvalMap })
    : createTeam(root, workspaceId, {
        name: AXIAN_TEAM,
        description: "Axian Squad agents in rank order (ranks 0 to 7). DevOps, PM and Auditor stay in the catalog.",
        agentNames,
        approvalMap,
      })
  return { id: team.id, name: team.name, agentNames: team.agentNames }
}

/** Reads agent files from role folders; ranks come from the README table, falling back to each file's heading. */
function discoverAgents(agentsDir: string, warnings: string[]): Found[] {
  const ranks = new Map<string, { rank: number; output: string }>()
  const readme = path.join(agentsDir, "README.md")
  if (fs.existsSync(readme)) {
    for (const line of fs.readFileSync(readme, "utf8").split(/\r?\n/)) {
      const match = line.match(/\[`([A-Za-z]+Agent)`\]\([^)]*\)\s*\|\s*\*\*(\d+)\*\*/)
      if (!match) continue
      const cells = line.split("|").map((cell) => cell.trim())
      ranks.set(match[1], { rank: Number(match[2]), output: (cells[cells.length - 2] || "").replace(/`/g, "") })
    }
  } else {
    warnings.push("No .ai/agents/README.md; ranks were read from each agent's heading")
  }

  const found: Found[] = []
  for (const roleFolder of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (!roleFolder.isDirectory()) continue
    for (const entry of fs.readdirSync(path.join(agentsDir, roleFolder.name))) {
      if (!entry.endsWith("Agent.md")) continue
      const file = path.join(agentsDir, roleFolder.name, entry)
      const axianName = entry.replace(/\.md$/, "")
      let rank = ranks.get(axianName)?.rank ?? null
      if (rank === null) {
        const heading = fs.readFileSync(file, "utf8").split(/\r?\n/, 1)[0] || ""
        const fromHeading = heading.match(/rank\s+(\d+)/i)
        rank = fromHeading ? Number(fromHeading[1]) : null
        if (rank === null) warnings.push(`${axianName}: no rank found; placed after the main path`)
      }
      found.push({ axianName, file, roleFolder: roleFolder.name, rank, output: ranks.get(axianName)?.output ?? "" })
    }
  }
  return found.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.axianName.localeCompare(b.axianName))
}

function slug(axianName: string): string {
  return axianName
    .replace(/DevOps/g, "Devops")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
}

/** Told to the model before the unmodified Axian text, so the file-based instructions work inside a room. */
function preamble(kit: string): string {
  return [
    "# Platform notes (read first)",
    "You run inside Agentic Automation, not in an IDE. The agent text below is the Axian Squad kit's own and is unchanged. Apply it with these differences:",
    "- There is no LOCAL.md. Its fields (Key, BRD/PRD link, Figma link, Intent, Mode, Period, Track) are in the Requirement and in the loaded sources. Do not ask for the file.",
    "- Earlier agents' outputs (00 to 07) are under \"Earlier role outputs\". If one is missing, work standalone as the text describes, and list what stood in for it.",
    `- The kit is readable at ${kit}. Paths that start with .ai/ are relative to that folder. Read your core skill first, then only the nested skills its table names for this task.`,
    "- Reply with the content of your output file as your chat reply. Do not create files.",
    "- \"Approved\" means the person clicks Approve in this app. Propose each external write as its own tool call or Write plan row, and wait.",
    "- Anything meant for Jira, Confluence, Figma, pull requests or other people must read as the person wrote it: no mention of agents, gates, ranks, skills or AI.",
  ].join("\n")
}

/** Offline placeholder so draft mode (no model key) still runs end to end. */
function draftFor(axianName: string, original: string): string {
  const lines = original.split(/\r?\n/)
  const start = lines.findIndex((line) => /^## Scope\s*$/.test(line))
  const end = start === -1 ? -1 : lines.findIndex((line, index) => index > start && /^## /.test(line))
  const scope = start === -1 ? [] : lines.slice(start + 1, end === -1 ? undefined : end)
  const items = scope
    .map((line) => line.match(/^\d+\.\s+(.*?)(?:\s+—|:|\s+--)/)?.[1] ?? line.match(/^\d+\.\s+(.*)$/)?.[1])
    .filter((item): item is string => Boolean(item))
    .slice(0, 12)
  return [
    "## Draft",
    "",
    `# ${axianName} (offline draft)`,
    "",
    "No model key is set, so this is a placeholder, not an analysis.",
    "",
    "Requirement: {{requirement}}",
    "",
    items.length ? "Sections this agent produces when it runs for real:" : "",
    ...items.map((item) => `- ${item}`),
  ]
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n")
}
