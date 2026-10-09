export type AgentFile = {
  name: string
  title: string
  needsApproval: boolean
  file: string
  instructions: string
  draft: string
}

export type StageStatus = "pending" | "running" | "waiting_approval" | "done" | "error"

export type StageState = {
  name: string
  title: string
  status: StageStatus
  output: string | null
  agentId: string | null
}

export type SourceDoc = {
  kind: "confluence" | "paste" | "figma" | "github"
  title: string
  url: string
  body: string
}

export type MemoryKind =
  | "gap"
  | "decision"
  | "test"
  | "write_plan"
  | "approval"
  | "pr"
  | "finding"
  | "note"

export type MemoryEntry = {
  id: string
  kind: MemoryKind
  title: string
  body: string
  agent: string
  source: string
  at: string
  refs?: string[]
}

export type PacketView = {
  roleFile: string
  projectFile: string
  projectMarkdown: string
  givenStages: { title: string; output: string }[]
  notes: string[]
  sources: SourceDoc[]
  memory: string
}

export type ChatMessage = {
  id: string
  kind: "human" | "agent"
  title: string
  body: string
  at: string
  packet?: PacketView
  agentId?: string
}

export type GitRepoRef = {
  id: string
  url: string
  owner: string
  repo: string
  branch: string
}

export type PermissionSystem = "jira" | "confluence" | "figma" | "github" | "jenkins"

export type PermissionStatus = "pending" | "approved" | "denied" | "executed" | "failed"

export type PermissionRequest = {
  id: string
  roleName: string
  roleTitle: string
  system: PermissionSystem
  action: string
  target: string
  payloadSummary: string
  status: PermissionStatus
  createdAt: string
  resolvedAt: string | null
  error: string | null
  /** Where the write plan was proposed. */
  surface?: "room" | "dm"
}

export type EnvDeployRecord = {
  url: string
  at: string
  smokeResult: "pass" | "fail" | null
  job: string | null
}

export type Room = {
  id: string
  requirement: string
  confluencePageUrl: string | null
  pastedBrd: string | null
  figmaFileUrl: string | null
  jiraBoardUrl: string | null
  jiraProjectKey: string | null
  jiraEpicKey: string | null
  gitRepos: GitRepoRef[]
  permissions: PermissionRequest[]
  deployUrl: string | null
  deployEnv: string | null
  jenkinsJob: string | null
  /** Last known deploy URL per env (Dev / Testing / Preprod / Prod). */
  deploymentsByEnv: Record<string, EnvDeployRecord>
  lastSmokeReport: unknown | null
  lastHealthReport: unknown | null
  /** Active swarm team id (default SDLC Sprint Team when null). */
  teamId: string | null
  messages: ChatMessage[]
  stages: StageState[]
  notes: string[]
}

export type Packet = {
  requirement: string
  projectMarkdown: string
  role: AgentFile
  prior: { title: string; output: string }[]
  notes: string[]
  sources: SourceDoc[]
  memory: string
  /** Extra context for 1:1 DM turns. */
  dmHistory?: string
}
