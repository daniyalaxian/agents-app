import type { PermissionRequest, PermissionSystem } from "./types.js"

const SYSTEM_ALIASES: Record<string, PermissionSystem> = {
  jira: "jira",
  confluence: "confluence",
  figma: "figma",
  github: "github",
  git: "github",
  repo: "github",
  jenkins: "jenkins",
}

/**
 * Parse Write plan tables from agent markdown.
 * Expected rows: | System | Action | Target | Payload summary |
 */
export function parseWritePlans(
  output: string,
  meta: { roleName: string; roleTitle: string; surface?: "room" | "dm" },
): PermissionRequest[] {
  const lines = output.split(/\r?\n/)
  const requests: PermissionRequest[] = []
  let inWritePlan = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (/^##\s+Write plan\b/i.test(trimmed) || /^\*\*Write plan\b/i.test(trimmed)) {
      inWritePlan = true
      continue
    }
    if (inWritePlan && /^##\s+/.test(trimmed)) {
      inWritePlan = false
    }
    if (!inWritePlan) continue
    if (!trimmed.startsWith("|")) continue

    const cells = trimmed
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean)
    if (cells.length < 4) continue
    if (/^system$/i.test(cells[0]) || /^-+$/.test(cells[0])) continue

    const system = SYSTEM_ALIASES[cells[0].toLowerCase()]
    if (!system) continue

    requests.push({
      id: crypto.randomUUID(),
      roleName: meta.roleName,
      roleTitle: meta.roleTitle,
      system,
      action: cells[1],
      target: cells[2],
      payloadSummary: cells.slice(3).join(" | "),
      status: "pending",
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      error: null,
      surface: meta.surface || "room",
    })
  }

  return requests
}

export function slugifyRequirement(requirement: string): string {
  const slug = requirement
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)
  return slug || `room-${Date.now().toString(36)}`
}
