import type { AgentFile } from "./types.js"

export type SourceScope = { brd: boolean; figma: boolean; repos: boolean; deploy: boolean }

/**
 * Which external sources a role or agent receives.
 * An agent that declares `sources` (imported toolkits) is scoped by that list. Built-in roles keep their
 * name-based scoping. `shared` (group chat) gives every member the BRD, Figma and repos.
 */
export function sourceScope(roleName: string, shared: boolean, agent?: AgentFile): SourceScope {
  const declared = agent?.sources
  const wants = (kind: string, byName: boolean) => (declared ? declared.includes(kind) : byName)
  const lead = roleName === "sa" || roleName === "software-lead"
  return {
    brd: shared || wants("brd", lead),
    figma: shared || wants("figma", lead),
    repos: shared || wants("repos", lead || roleName === "architecture" || roleName === "coding"),
    // Deploy context is not part of the shared group chat sources.
    deploy: wants("deploy", ["deploy", "qa-unit", "qa-e2e", "devops"].includes(roleName)),
  }
}
