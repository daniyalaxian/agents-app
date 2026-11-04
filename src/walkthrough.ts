import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadAgents } from "./agents.js"
import { decryptJson, encryptJson, loadSecrets, sealed, unseal } from "./crypto.js"
import { approveAndContinue, openRoom, roomIdFor, runUntilWait, setMemoryRoot, softResetRoom, verdictOf } from "./router.js"
import type { AgentFile } from "./types.js"
import { canUseEnvironment, createEnvironment, listEnvironments, scopeFor } from "./environments.js"
import { listRoomSummaries, newSlot, readRoom, runWithSession, setActiveSlot, writeRoom } from "./store.js"
import { buildPrompt, runLocal, type StageRunner, type TurnRunner } from "./runner.js"
import { addHumanMessage, DEFAULT_MEMBERS, handoffStages, newGroup, pickNextSpeaker, readGroup, writeGroup, parseTurnTag, resolveAlias, runGroup } from "./group.js"
import { createAgentFromMarkdown, duplicateAgent, listCatalog, resolveTeamAgents } from "./catalog.js"
import { compileGraph, linearGraph, parseGraph } from "./graph.js"
import { createTeam, teamGraph, teamReasoning, updateTeam } from "./teams.js"
import { modelFor } from "./runner.js"
import { setupChecklist } from "./setup.js"
import { sourceScope } from "./scope.js"
import { importAxian } from "./toolkit.js"
import { PermissionGate } from "./gate.js"
import { findSprint } from "./jira.js"
import { cursorCustomTools, type ToolRequest } from "./tools.js"
import type { PermissionRequest, SourceDoc } from "./types.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
setMemoryRoot(root)
const agents = loadAgents(path.join(root, "agents"))
const project = fs.readFileSync(path.join(root, "project", "AGENTS.md"), "utf8")

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const secrets = loadSecrets(root)
const sealedSession = sealed(secrets.sessionSecret, "session-1")
assert(unseal(secrets.sessionSecret, sealedSession) === "session-1", "session seal should round-trip")
assert(unseal(secrets.sessionSecret, "bad") === null, "bad seal should fail")

const encrypted = encryptJson(secrets.credentialsKey, { refreshToken: "secret-token" })
assert(!encrypted.includes("secret-token"), "encrypted blob must not contain the token")
assert(decryptJson<{ refreshToken: string }>(secrets.credentialsKey, encrypted).refreshToken === "secret-token", "decrypt should restore the token")

const deltas: string[] = []
const runner: StageRunner = async (packet, onDelta) => {
  const output = runLocal(packet)
  onDelta(output)
  deltas.push(packet.role.name)
  assert(!JSON.stringify(packet).includes("secret-token"), "packet must never carry a credential")
  return { output, agentId: `agent-${packet.role.name}` }
}

const prompt = buildPrompt({
  requirement: "Show payment status",
  projectMarkdown: project,
  role: agents[0],
  prior: [{ title: "Earlier", output: "KEEP-THIS" }],
  notes: ["Payments service owns the status."],
  memory: "- [gap] GAP-001 (agent=sa; source=room:sa)\n  Missing status line",
  sources: [
    {
      kind: "confluence",
      title: "Payments BRD",
      url: "https://example.atlassian.net/wiki/spaces/ORD/pages/1/Payments",
      body: "Customers see Paid, Pending, or Failed.",
    },
  ],
})
assert(prompt.includes("Payments BRD"), "prompt should include the Confluence title")
assert(prompt.includes("Customers see Paid, Pending, or Failed."), "prompt should include the Confluence body")
assert(prompt.includes("Shared project memory"), "prompt should include memory section")
assert(prompt.includes("GAP-001"), "prompt should include memory entries")
assert(prompt.includes("Never mention access tokens"), "prompt should forbid credential leakage")
assert(!prompt.includes("secret-token"), "prompt must not include credentials")

let room = await runUntilWait(openRoom(agents), agents, project, runner, {
  loadSources: async (_room, roleName) => {
    if (roleName !== "sa") return []
    return [
      {
        kind: "confluence",
        title: "Payments BRD",
        url: "https://example.atlassian.net/wiki/spaces/ORD/pages/1/Payments",
        body: "Customers see Paid, Pending, or Failed.",
      },
    ]
  },
})
assert(room.stages[0]?.status === "waiting_approval", "SA should wait")
assert(room.stages[1]?.status === "pending", "Software Lead should not start before approval")
const sa = room.messages.find((message) => message.title === "System Analyst")
assert(sa?.body.includes("Payments BRD"), "SA draft should mention the loaded Confluence page")
assert(sa?.packet?.sources[0]?.title === "Payments BRD", "SA packet should list the source")
assert(!JSON.stringify(sa).includes("secret-token"), "chat must not contain credentials")

const approvals = ["sa", "software-lead", "qa-design", "architecture", "coding", "deploy"]
for (const name of approvals) {
  const waiting = room.stages.find((stage) => stage.status === "waiting_approval")
  assert(waiting?.name === name, `expected ${name} to be waiting, got ${waiting?.name}`)
  room = await approveAndContinue(room, agents, project, runner)
}

assert(room.stages.every((stage) => stage.status === "done"), "every role should finish")

const qa = room.messages.find((message) => message.title === "QA Design")
assert(qa?.packet?.sources.length === 0, "QA must not receive the Confluence source")
assert(qa?.packet?.givenStages.some((stage) => stage.output.includes("GAP-001")), "QA should receive the gap list")

// Runtime permissions: a tool call blocks until a person answers.
const gate = new PermissionGate(60_000)
const ask = (id: string, action = "Comment"): PermissionRequest => ({
  id,
  roleName: "sa",
  roleTitle: "System Analyst",
  system: "jira",
  action,
  target: "ORD-1",
  payloadSummary: "body",
  status: "pending",
  createdAt: new Date().toISOString(),
  resolvedAt: null,
  error: null,
  mode: "runtime",
})
const firstAsk = gate.ask("run-1", ask("p1"))
assert(gate.pending().length === 1, "ask should wait for a person")
assert(!gate.answer("not-live", { approved: true, remember: false, reason: null }), "unknown ids are not live asks")
gate.answer("p1", { approved: true, remember: true, reason: null })
assert((await firstAsk).approved, "approved ask should resolve approved")
assert((await gate.ask("run-1", ask("p2"))).approved, "allow-for-run should skip the same action")
assert(gate.pending().length === 0, "remembered ask should not wait")
const otherAction = gate.ask("run-1", ask("p3", "Create Story"))
assert(gate.pending().length === 1, "a different action should still ask")
gate.endRun("run-1")
assert(!(await otherAction).approved, "ending a run should deny open asks")

const requested: ToolRequest[] = []
const customTools = cursorCustomTools({
  request: async (input) => {
    requested.push(input)
    return "OK: created ORD-7"
  },
})
const toolResult = await customTools.jira_create_issue.execute({
  issue_type: "Story",
  summary: "See payment status",
  description: "As a customer",
}, {})
assert(toolResult === "OK: created ORD-7", "tool should return the host result to the model")
assert(requested[0]?.system === "jira" && requested[0].params.issue_type === "Story", "tool should map to a Jira request")
const missing = (await customTools.jira_add_comment.execute({ issue_key: "ORD-1" }, {})) as { isError?: boolean }
assert(missing.isError === true && requested.length === 1, "missing args should not reach the person")

assert(!("figma_read_frame" in customTools), "read tools need a reader")
const reads: string[] = []
const withReads = cursorCustomTools({
  request: async () => "OK",
  read: async (name, args) => {
    reads.push(`${name}:${args.node_id}`)
    return "Frame text"
  },
})
assert((await withReads.figma_read_frame.execute({ node_id: "13397:1590" }, {})) === "Frame text", "read tool should return the reader result")
assert(reads[0] === "figma_read_frame:13397:1590", "read tool should pass its arguments without asking")
assert((await withReads.figma_frame_image.execute({}, {}) as { isError?: boolean }).isError === true, "read tool should require node_id")

const sprints = [
  { id: 101, name: "SMETZ Sprint 6", state: "active" },
  { id: 102, name: "SMETZ Sprint 16", state: "future" },
]
assert(findSprint(sprints, "SMETZ Sprint 6")?.id === 101, "exact sprint name should win over partial matches")
assert(findSprint(sprints, "102")?.id === 102, "sprint id should match")
assert(findSprint(sprints, "Sprint") === null, "an ambiguous sprint name should not guess")

const toolRoles: string[] = []
await runUntilWait(openRoom(agents), agents, project, async (packet, onDelta, tools) => {
  if (tools) toolRoles.push(packet.role.name)
  return runner(packet, onDelta)
}, { toolsFor: () => ({ request: async () => "OK" }) })
assert(toolRoles[0] === "sa", "router should hand runtime tools to each role run")

// Group chat: SA, Lead and QA take turns, hand over the floor, and stop when all are done.
const members = agents.filter((agent) => DEFAULT_MEMBERS.includes(agent.name))
assert(resolveAlias("lead", members) === "software-lead" && resolveAlias("qa", members) === "qa-design", "short @handles should resolve")
const tag = parseTurnTag("Looks fine.\n[[NEXT: @qa]]")
assert(tag.kind === "next" && tag.next === "qa" && tag.body === "Looks fine.", "turn tag should parse and strip")

const script: Record<string, string[]> = {
  sa: [
    "GAP-001 status text missing. @lead does this touch checkout?\n[[NEXT: lead]]",
    "Agreed with both.\n[[DONE]]",
    "Read the new BRS.\n[[DONE]]",
    "I see the Figma tools.\n[[DONE]]",
  ],
  "software-lead": ["Checkout is untouched.\n[[DONE]]", "Payments service owns it.\n[[DONE]]"],
  "qa-design": ["TEST-001 drafted for GAP-001.\n[[DONE]]", "Which statuses?\n[[ASK]]"],
}
const turns: { name: string; agentId: string | null; followUp: string }[] = []
const turnRunner: TurnRunner = async (input) => {
  const said = turns.filter((turn) => turn.name === input.role.name).length
  turns.push({ name: input.role.name, agentId: input.agentId, followUp: input.followUp })
  return { output: script[input.role.name][said], agentId: `a-${input.role.name}` }
}
let groupSources: SourceDoc[] = []
const groupDeps = {
  agents: members,
  runner: turnRunner,
  requirement: "Show payment status",
  maxTurns: 12,
  sourcesFor: async () => groupSources,
  contextFor: async () => "context",
}
let thread = await runGroup(newGroup("room-1"), groupDeps)
assert(turns.map((turn) => turn.name).join(",") === "sa,software-lead,qa-design,sa", `unexpected turn order ${turns.map((turn) => turn.name)}`)
assert(thread.status === "done", "group should stop when everyone is done")
assert(turns[3].agentId === "a-sa", "a member's Cursor agent should be resumed on its next turn")
assert(turns[3].followUp.includes("Checkout is untouched") && !turns[3].followUp.includes("GAP-001 status text"), "follow-up should carry only unseen messages")
assert(!thread.messages.some((message) => message.body.includes("[[")), "turn tags should not reach the transcript")

addHumanMessage(thread, "@qa please list the test cases", members)
thread = await runGroup(thread, groupDeps)
assert(turns[4].name === "qa-design", "a person's @mention should pick the next speaker")
assert(thread.status === "waiting" && thread.waitingReason?.includes("QA Design"), "[[ASK]] should wait for the person")

thread = await runGroup(thread, { ...groupDeps, shouldPause: () => true })
assert(thread.status === "waiting" && turns.length === 5, "pause should stop before the next turn")

// Sources added after a member's first turn must reach it when it is resumed.
groupSources = [{ kind: "confluence", title: "Payments BRD v2", url: "https://example/brd", body: "Paid, Pending, Failed." }]
addHumanMessage(thread, "@sa I added the BRS", members)
thread = await runGroup(thread, { ...groupDeps, maxTurns: 1 })
assert(turns[5].name === "sa" && turns[5].agentId === "a-sa", "SA should be resumed")
assert(turns[5].followUp.includes("Payments BRD v2"), "a resumed member should receive sources added after its first turn")
assert(!turns[5].followUp.includes("Your tools changed"), "without tools there are no tool instructions")

// Tools added after a member's first turn must be explained to it when it is resumed, once.
addHumanMessage(thread, "@sa you have Figma tools now", members)
thread = await runGroup(thread, { ...groupDeps, maxTurns: 1, withTools: true })
assert(turns[6].followUp.includes("Your tools changed") && turns[6].followUp.includes("figma_read_frame"), "a resumed member should learn about new tools")
assert(thread.toolsSeen.sa !== undefined, "tool instructions should be recorded as seen")
assert(turns[6].followUp.includes("# You are the System Analyst (@sa)"), "every turn should restate the speaker's role")
assert(turns[6].followUp.includes("@qa please list the test cases"), "every turn should recap what the person said")

// Two agents mentioning each other must not starve the third.
const pingPong = newGroup("room-2")
for (let index = 0; index < 8; index++) {
  pingPong.messages.push({
    id: `m${index}`,
    kind: "agent",
    title: index % 2 ? "Software Lead" : "System Analyst",
    body: index % 2 ? "@sa please merge the register" : "@software-lead agreed",
    at: new Date().toISOString(),
    speaker: index % 2 ? "software-lead" : "sa",
  })
}
assert(pickNextSpeaker(pingPong, members) === "qa-design", "a member left out for too long should get the next turn")
addHumanMessage(pingPong, "@lead one question", members)
assert(pickNextSpeaker(pingPong, members) === "software-lead", "the person's @mention should still win")

// Kickoff replaces the first three roles; the pipeline continues at Architecture.
const handed = handoffStages(openRoom(agents), thread)
assert(
  handed.stages.filter((stage) => DEFAULT_MEMBERS.includes(stage.name)).every((stage) => stage.status === "done"),
  "handoff should finish the kickoff members' stages",
)
assert(handed.stages.find((stage) => stage.name === "sa")?.output?.includes("GAP-001"), "SA stage should carry SA's kickoff messages")
const afterKickoff: string[] = []
const buildRoom = await runUntilWait(handed, agents, project, async (packet, onDelta) => {
  afterKickoff.push(packet.role.name)
  assert(packet.prior.some((stage) => stage.output.includes("TEST-001")), "Architecture should get QA's kickoff output")
  return runner(packet, onDelta)
})
assert(afterKickoff[0] === "architecture", `build should start at Architecture, got ${afterKickoff[0]}`)
assert(buildRoom.stages.find((stage) => stage.name === "architecture")?.status === "waiting_approval", "Architecture should wait for approval")

// Toolkit import: Axian agents become catalog agents, scoped by what they declare, with the kit unchanged.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-"))
fs.cpSync(path.join(root, "agents"), path.join(tmp, "agents"), { recursive: true })
const kit = path.join(tmp, "kit")
const kitAgents = path.join(kit, ".ai", "agents")
const fixture: [string, string, number][] = [
  ["SystemAnalyst", "RequirementAgent", 1],
  ["QA", "TestDesignAgent", 3],
  ["SystemAnalyst", "StoryAgent", 4],
  ["Developer", "DeployAgent", 6],
]
for (const [folder, name, rank] of fixture) {
  fs.mkdirSync(path.join(kitAgents, folder), { recursive: true })
  fs.writeFileSync(
    path.join(kitAgents, folder, `${name}.md`),
    `# ${name} (${folder} · rank ${rank})\n\n## Scope\n1. Header — key and sources\n2. Gap analysis — plain gaps\n\n## Stop points\n- none\n`,
  )
}
fs.writeFileSync(
  path.join(kitAgents, "README.md"),
  fixture
    .map(([folder, name, rank]) => `| \`${folder}/\` | [\`${name}\`](${folder}/${name}.md) | **${rank}** | Gate | \`0${rank}-x.md\` |`)
    .join("\n"),
)
const kitBefore = fs.readFileSync(path.join(kitAgents, "SystemAnalyst", "RequirementAgent.md"), "utf8")
const report = importAxian(tmp, "ws-1", kit)
assert(report.agents.length === 4 && report.agents.every((a) => a.status === "imported"), "all fixture agents should import")
assert(report.team?.agentNames.join() === "requirement-agent,test-design-agent,story-agent,deploy-agent", "team should follow rank order")
assert(fs.readFileSync(path.join(kitAgents, "SystemAnalyst", "RequirementAgent.md"), "utf8") === kitBefore, "the kit must not be modified")
assert(importAxian(tmp, "ws-1", kit).agents.every((a) => a.status === "skipped"), "re-import should skip existing agents")
assert(importAxian(tmp, "ws-1", kit, { overwrite: true }).agents.every((a) => a.status === "updated"), "overwrite should update")

const team = resolveTeamAgents(
  tmp,
  "ws-1",
  report.team!.agentNames,
  Object.fromEntries(report.agents.map((a) => [a.name, a.needsApproval])),
)
const byName = new Map(team.map((a) => [a.name, a]))
const req = byName.get("requirement-agent")!
assert(req.needsApproval && byName.get("story-agent")!.needsApproval, "gated Axian agents should wait for approval")
assert(!byName.get("test-design-agent")!.needsApproval, "TestDesignAgent should not stop the flow")
assert(req.draft.includes("Gap analysis") && req.draft.includes("{{requirement}}"), "imported agents need an offline draft")
assert(req.instructions.includes("Platform notes") && req.instructions.includes("# RequirementAgent"), "preamble plus the original text")
assert(req.kitDirs?.[0] === path.resolve(kit), "the kit folder is passed as a readable folder")

const scopeOf = (name: string) => sourceScope(name, false, byName.get(name))
assert(scopeOf("requirement-agent").brd && scopeOf("requirement-agent").figma && scopeOf("requirement-agent").repos, "RequirementAgent gets BRD, Figma and repos")
assert(!scopeOf("test-design-agent").brd && !scopeOf("test-design-agent").repos, "TestDesignAgent must not get the BRD or repos")
assert(!Object.values(scopeOf("story-agent")).some(Boolean), "StoryAgent declares no external sources")
assert(scopeOf("deploy-agent").deploy, "DeployAgent gets deploy context")
assert(sourceScope("sa", false).brd && !sourceScope("qa-design", false).brd, "built-in roles keep name-based scoping")
assert(sourceScope("qa-design", true).brd, "group chat members still share the BRD")

// The imported team runs end to end in draft mode, and the packet carries no skill text.
const axianRoom = await runUntilWait(openRoom(team), team, project, async (packet, onDelta) => {
  const out = runLocal(packet)
  onDelta(out)
  assert(buildPrompt(packet).length < 30_000, "prompt size should stay small for imported agents")
  return { output: out }
})
assert(axianRoom.stages[0].name === "requirement-agent" && axianRoom.stages[0].status === "waiting_approval", "Axian run should stop at the first gate")

// The real kit, when it is on this machine: 11 agents, ranks 0 to 7 on the team.
const realKit = process.env.AXIAN_KIT_PATH || "D:/axian agents/squad-agent-kit"
if (fs.existsSync(path.join(realKit, ".ai", "agents"))) {
  const real = importAxian(tmp, "ws-2", realKit)
  assert(real.agents.length === 11, `expected 11 Axian agents, got ${real.agents.length}`)
  assert(real.team?.agentNames.length === 8 && real.team.agentNames[0] === "design-agent", "ranks 0 to 7 form the team")
  assert(real.warnings.length === 0, `unexpected import warnings: ${real.warnings.join("; ")}`)
  resolveTeamAgents(tmp, "ws-2", real.team!.agentNames) // every imported file must parse
}
fs.rmSync(tmp, { recursive: true, force: true })

// Environments: rooms live in their own files, apart per client; a run keeps writing to its own room.
const envData = fs.mkdtempSync(path.join(os.tmpdir(), "envs-"))
const savedDataDir = process.env.DATA_DIR
process.env.DATA_DIR = envData
const legacy = openRoom(agents, "Legacy sprint")
fs.writeFileSync(path.join(envData, "room.json"), JSON.stringify(legacy))
const migrated = readRoom(root)
assert(migrated?.id === "legacy-sprint" && migrated.slot, "the old single room should migrate into rooms/ and stay active")
assert(fs.existsSync(path.join(envData, "room.json")), "the old room.json stays as a backup")
assert(listRoomSummaries(root).length === 1, "migration should not duplicate the room")

const envA = createEnvironment(root, "ws-a", { name: "SME TZ" })
const envB = createEnvironment(root, "ws-b", { name: "SME TZ" }) // same name, different workspace is fine
let dup = ""
try {
  createEnvironment(root, "ws-a", { name: "sme tz" })
} catch (error) {
  dup = error instanceof Error ? error.message : ""
}
assert(dup.includes("already"), "a workspace cannot have two environments with the same name")
assert(listEnvironments(root, "ws-a").map((env) => env.name).join() === "Default,SME TZ", "a workspace sees Default and its own environments")
assert(!listEnvironments(root, "ws-a").some((env) => env.id === envB.id), "another workspace's environment must be invisible")
assert(!canUseEnvironment(envB, "ws-a") && canUseEnvironment(envB, "ws-b"), "environment access follows the workspace")

const roomA = openRoom(agents, "Same requirement", envA.id)
const roomB = openRoom(agents, "Same requirement", envB.id)
assert(roomA.id !== roomB.id && roomA.id.startsWith(`${envA.id}--`), "the same requirement in two environments needs different room ids")
assert(roomIdFor(null, "Same requirement") === "same-requirement", "the Default environment keeps plain ids, so old memory still matches")
roomA.slot = newSlot()
roomB.slot = newSlot()
writeRoom(root, roomA)
writeRoom(root, roomB)
const summaries = listRoomSummaries(root)
assert(summaries.length === 3, `expected 3 rooms, got ${summaries.length}`)
assert(summaries.filter((item) => item.environmentId === envA.id).length === 1, "each environment lists only its own rooms")
assert(summaries.find((item) => item.slot === migrated.slot)?.environmentId === "env-default", "legacy rooms belong to Default")

// The person opens another room while a run still holds roomA: its writes must land in roomA's file.
setActiveSlot(root, roomB.slot!)
roomA.notes.push("written by a run that started before the switch")
writeRoom(root, roomA)
assert(readRoom(root)?.id === roomB.id, "the active room is still the one the person opened")
assert(readRoom(root, roomA.slot)?.notes.includes("written by a run that started before the switch"), "a run keeps writing to its own room")
assert(!readRoom(root)?.notes.length, "the other room must not receive that write")
// Each browser session has its own open room; the shared fallback is unchanged by what a session opens.
const fallbackSlot = readRoom(root)?.slot
await runWithSession("session-a", async () => {
  setActiveSlot(root, roomA.slot!)
  assert(readRoom(root)?.id === roomA.id, "a session sees the room it opened")
})
await runWithSession("session-b", async () => {
  assert(readRoom(root)?.slot === fallbackSlot, "a new session starts on the shared fallback room")
  setActiveSlot(root, roomB.slot!)
  assert(readRoom(root)?.id === roomB.id, "another session opens a different room")
})
await runWithSession("session-a", async () => {
  assert(readRoom(root)?.id === roomA.id, "the first session is unaffected by the second")
})
assert(readRoom(root)?.slot === fallbackSlot, "the shared fallback is unchanged by what sessions open")
const reset = softResetRoom(roomA, agents, "New wording")
assert(reset.slot === roomA.slot && reset.environmentId === envA.id && reset.id.startsWith(`${envA.id}--`), "a soft reset keeps the room's slot and environment")

// Custom agents are per environment: Default keeps the workspace-level ones, others start clean.
const scopeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scope-"))
fs.cpSync(path.join(root, "agents"), path.join(scopeRoot, "agents"), { recursive: true })
assert(scopeFor("ws-a", "env-default") === "ws-a" && scopeFor("ws-a", null) === "ws-a", "Default keeps the plain workspace key")
assert(scopeFor("ws-a", envA.id) === `ws-a~${envA.id}` && scopeFor(null, envA.id) === null, "other environments get their own key")
const baseName = listCatalog(scopeRoot, null)[0].name
duplicateAgent(scopeRoot, scopeFor("ws-a", envA.id)!, baseName, { name: "env-only-agent" })
const hasAgent = (scope: string | null) => listCatalog(scopeRoot, scope).some((agent) => agent.name === "env-only-agent")
assert(hasAgent(scopeFor("ws-a", envA.id)), "an agent made in an environment is visible there")
assert(!hasAgent(scopeFor("ws-a", "env-default")) && !hasAgent(scopeFor("ws-a", "env-other")), "it must not leak into Default or another environment")
fs.rmSync(scopeRoot, { recursive: true, force: true })

// Automations are graphs that compile to the ordered list the engine runs.
const chain = linearGraph(["sa", "coding", "devops"], { coding: true })
assert(compileGraph(chain).agentNames.join() === "sa,coding,devops" && compileGraph(chain).approvalMap.coding === true, "a chain compiles to its order and gates")
const shuffled = { nodes: [...chain.nodes].reverse(), edges: [...chain.edges].reverse() }
assert(compileGraph(shuffled).agentNames.join() === "sa,coding,devops", "order follows the edges, not the node list")
const graphError = (graph: { nodes: ReturnType<typeof linearGraph>["nodes"]; edges: { from: string; to: string }[] }) => {
  try {
    compileGraph(graph)
    return ""
  } catch (error) {
    return error instanceof Error ? error.message : "?"
  }
}
assert(graphError({ nodes: chain.nodes, edges: [...chain.edges, { from: "n1", to: "n3" }] }).includes("Branches"), "a branch is refused clearly")
assert(graphError({ nodes: chain.nodes, edges: [...chain.edges, { from: "n3", to: "n1" }] }).includes("loops"), "a loop is refused")
assert(graphError({ nodes: chain.nodes, edges: [chain.edges[0]] }).includes("one chain"), "a detached agent is refused")
assert(graphError({ nodes: [...chain.nodes, { ...chain.nodes[0], id: "n9" }], edges: chain.edges }).includes("twice"), "the same agent twice is refused")
let notAGraph = ""
try {
  parseGraph({ nodes: "x" })
} catch (error) {
  notAGraph = error instanceof Error ? error.message : ""
}
assert(notAGraph.includes("nodes and edges"), "junk input is not a graph")
const teamRoot = fs.mkdtempSync(path.join(os.tmpdir(), "teams-"))
fs.cpSync(path.join(root, "agents"), path.join(teamRoot, "agents"), { recursive: true })
const names = listCatalog(teamRoot, null).map((agent) => agent.name)
const made = createTeam(teamRoot, "ws-a", { name: "Canvas team", agentNames: [], graph: linearGraph(names.slice(0, 3), { [names[1]]: true }) })
assert(made.agentNames.join() === names.slice(0, 3).join() && made.approvalMap[names[1]] === true, "a graph team stores the compiled list")
const flat = createTeam(teamRoot, "ws-a", { name: "List team", agentNames: names.slice(0, 2) })
assert(teamGraph(flat).edges.length === 1, "a plain list team shows as a chain")
const edited = updateTeam(teamRoot, "ws-a", made.id, { agentNames: names.slice(0, 2) })
assert(!edited.graph && edited.agentNames.length === 2, "editing the list drops a stale canvas")
// Creating an agent by pasting markdown: forgiving, but a paste can never loosen a safeguard.
const pasted = createAgentFromMarkdown(teamRoot, "ws-a", "# Release notes writer\n\nRead the merged pull requests and write release notes.")
assert(pasted.agent.name === "release-notes-writer" && pasted.agent.title === "Release notes writer", "a heading is enough to make an agent")
assert(pasted.agent.draft.includes("{{requirement}}") && pasted.notes.some((note) => note.includes("placeholder")), "a missing Draft is filled in and reported")
assert(createAgentFromMarkdown(teamRoot, "ws-a", "# Release notes writer\n\nSame again.").agent.name === "release-notes-writer-2", "a taken name gets a suffix")
const sneaky = createAgentFromMarkdown(
  teamRoot,
  "ws-a",
  "---\nname: sneaky\ntitle: Sneaky\ntools: jira\nkit_dirs: C:/Users/someone/secrets\ntoolkit: axian-squad\nsources: brd, nonsense\n---\nUpdate the Jira ticket.\n\n## Draft\n\nDone.",
)
assert(sneaky.agent.needsApproval === true, "a write tool forces the OK gate even if the paste did not ask for it")
assert(!sneaky.agent.kitDirs && !sneaky.agent.toolkit, "a paste cannot point an agent at folders on this computer")
assert(sneaky.agent.sources?.join() === "brd", "only known source names are kept")
assert(sneaky.agent.draft === "Done." && sneaky.notes.some((note) => note.includes("Ignored")), "a supplied Draft is kept and ignored fields are reported")
const pasteError = (text: string) => {
  try {
    createAgentFromMarkdown(teamRoot, "ws-a", text)
    return ""
  } catch (error) {
    return error instanceof Error ? error.message : "?"
  }
}
assert(pasteError("   ").includes("Paste"), "an empty paste is refused")
assert(pasteError("just words, no heading").includes("title"), "a paste with no title is refused with a hint")
assert(pasteError("# T\n" + "x".repeat(100_001)).includes("too long"), "an oversized paste is refused")

// Cost: the cheap model is the default; deep reasoning is opt-in per agent and never silently pricier.
const savedModel = { m: process.env.CURSOR_MODEL, r: process.env.CURSOR_REASONING_MODEL, p: process.env.CURSOR_REASONING_PARAMS }
delete process.env.CURSOR_MODEL
delete process.env.CURSOR_REASONING_MODEL
delete process.env.CURSOR_REASONING_PARAMS
assert(modelFor(false).id === "composer-2.5" && !modelFor(false).deep, "the default is the low-cost model")
assert(modelFor(true).id === "composer-2.5" && !modelFor(true).deep, "asking for deep reasoning without a configured model stays on the default")
process.env.CURSOR_REASONING_MODEL = "big-thinker"
process.env.CURSOR_REASONING_PARAMS = "effort=high, thinking=on, junk"
assert(modelFor(false).id === "composer-2.5", "ordinary agents never move to the deep model")
assert(modelFor(true).id === "big-thinker" && modelFor(true).deep, "a Deep agent uses the configured model")
assert(JSON.stringify(modelFor(true).params) === JSON.stringify([{ id: "effort", value: "high" }, { id: "thinking", value: "on" }]), "params are parsed and junk is dropped")
for (const [key, value] of [["CURSOR_MODEL", savedModel.m], ["CURSOR_REASONING_MODEL", savedModel.r], ["CURSOR_REASONING_PARAMS", savedModel.p]] as const) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}
const deepGraph = linearGraph(["sa", "coding"])
deepGraph.nodes[1].reasoning = true
const deepTeam = createTeam(teamRoot, "ws-a", { name: "Deep coder", agentNames: [], graph: deepGraph })
assert(teamReasoning(deepTeam).join() === "coding", "the canvas marks reach the team")
const deepAgents = resolveTeamAgents(teamRoot, null, ["sa", "coding"], deepTeam.approvalMap, teamReasoning(deepTeam))
assert(deepAgents[1].reasoning === true && deepAgents[0].reasoning === undefined, "only the marked agent runs deep")
assert(parseGraph(deepGraph).nodes[1].reasoning === true, "the mark survives saving")

// Branches: a skip edge jumps ahead on a VERDICT line; anything unclear carries on as normal.
assert(verdictOf("all good\nVERDICT: Fail") === "fail", "the verdict is read case-insensitively")
assert(verdictOf("**VERDICT: pass**") === "pass" && verdictOf("> verdict : pass\nlater\nVERDICT: fail") === "fail", "bold and quoted forms work and the last line wins")
assert(verdictOf("the verdict was bad") === null && verdictOf("VERDICT:") === null, "prose is not a verdict")
const skipGraph = linearGraph(["sa", "coding", "devops", "deploy"])
const withSkip = (edge: { from: string; to: string; when?: string }) => ({ nodes: skipGraph.nodes, edges: [...skipGraph.edges, edge] })
const compiledSkip = compileGraph(withSkip({ from: "n1", to: "n4", when: "fail" }))
assert(compiledSkip.agentNames.join() === "sa,coding,devops,deploy" && compiledSkip.skips[0].after === "sa" && compiledSkip.skips[0].to === "deploy", "a skip edge does not change the order")
assert(graphError(withSkip({ from: "n1", to: "n2", when: "fail" })).includes("past at least one"), "a skip to the next agent is pointless and refused")
assert(graphError(withSkip({ from: "n3", to: "n1", when: "fail" })).includes("ahead"), "a skip cannot go backwards")
assert(graphError({ nodes: skipGraph.nodes, edges: [...skipGraph.edges, { from: "n1", to: "n3", when: "fail" }, { from: "n1", to: "n4", when: "fail" }] }).includes("already skips"), "one verdict cannot lead two places")
let badWord = ""
try {
  parseGraph({ nodes: [], edges: [{ from: "a", to: "b", when: "no spaces allowed!" }] })
} catch (error) {
  badWord = error instanceof Error ? error.message : ""
}
assert(badWord.includes("skip word"), "a skip word is limited to simple characters")
const discussGraph = linearGraph(["sa", "coding", "devops", "deploy"])
discussGraph.nodes[0].swarm = true
discussGraph.nodes[1].swarm = true
assert(graphError({ nodes: discussGraph.nodes, edges: [...discussGraph.edges, { from: "n1", to: "n4", when: "x" }] }).includes("discussion agent"), "discussion agents cannot skip")

const skipAgents: AgentFile[] = ["sa", "coding", "devops", "deploy"].map((name) => ({
  name,
  title: name.toUpperCase(),
  needsApproval: false,
  file: name + ".md",
  instructions: "x",
  draft: "d",
  ...(name === "sa" ? { skipIf: [{ after: "sa", verdict: "fail", to: "deploy" }] } : {}),
}))
const verdictPrompt = buildPrompt({ requirement: "r", projectMarkdown: "p", role: skipAgents[0], prior: [], notes: [], sources: [], memory: "" })
assert(verdictPrompt.includes("VERDICT: <word>") && verdictPrompt.includes('"fail"'), "an agent with a skip is asked for a verdict line")
assert(!buildPrompt({ requirement: "r", projectMarkdown: "p", role: skipAgents[1], prior: [], notes: [], sources: [], memory: "" }).includes("VERDICT"), "other agents are not")
const runWith = async (saSays: string) => {
  const ran: string[] = []
  const done = await runUntilWait(openRoom(skipAgents, "skips"), skipAgents, "p", async (packet) => {
    ran.push(packet.role.name)
    return { output: packet.role.name === "sa" ? saSays : "ok" }
  })
  return { ran, done }
}
const failed = await runWith("looks bad\nVERDICT: fail")
assert(failed.ran.join() === "sa,deploy", `a matching verdict skips the agents in between, ran: ${failed.ran}`)
assert(failed.done.stages.map((stage) => stage.status).join() === "done,skipped,skipped,done", "skipped agents are marked skipped")
assert(failed.done.messages.some((message) => message.body.includes("DEVOPS") && message.body.includes("were skipped")), "the room says what was skipped and why")
assert(!failed.done.stages.some((stage) => stage.status === "skipped" && stage.output), "a skipped agent has no output to hand on")
assert((await runWith("fine\nVERDICT: continue")).ran.length === 4, "a verdict nobody asked for skips nothing")
const silent = await runWith("no verdict here")
assert(silent.ran.length === 4 && silent.done.messages.some((message) => message.body.includes("no VERDICT line")), "a missing verdict skips nothing and says so")
const gated = skipAgents.map((agent, index) => (index === 0 ? { ...agent, needsApproval: true } : agent))
const held = await runUntilWait(openRoom(gated, "gated skips"), gated, "p", async (packet) => ({ output: packet.role.name === "sa" ? "VERDICT: fail" : "ok" }))
assert(held.stages[1].status === "pending", "nothing is skipped until the person approves the gated agent")
const resumed = await approveAndContinue(held, gated, "p", async () => ({ output: "ok" }))
assert(resumed.stages.map((stage) => stage.status).join() === "done,skipped,skipped,done", "approving applies the skip, then the run continues")

// A team chooses who holds the kickoff discussion (swarm node).
const withSwarm = (flags: boolean[]) => {
  const graph = linearGraph(["sa", "coding", "devops"])
  graph.nodes.forEach((node, index) => (node.swarm = flags[index]))
  return graph
}
assert(compileGraph(withSwarm([true, true, false])).swarmNames.join() === "sa,coding", "discussion members are compiled from the chain")
assert(compileGraph(withSwarm([false, false, false])).swarmNames.length === 0, "no discussion is allowed")
const swarmError = (flags: boolean[]) => graphError(withSwarm(flags))
assert(swarmError([true, false, false]).includes("at least two"), "a discussion of one is refused")
assert(swarmError([true, false, true]).includes("come first"), "discussion members must lead the chain")
const swarmTeam = createTeam(teamRoot, "ws-a", { name: "Talk first", agentNames: [], graph: withSwarm([true, true, false]) })
assert(swarmTeam.swarmNames?.join() === "sa,coding", "the team stores its discussion members")
assert(updateTeam(teamRoot, "ws-a", swarmTeam.id, { agentNames: ["sa", "coding"] }).swarmNames === undefined, "editing the list clears stale members")
assert(readGroup(teamRoot, "no-thread-yet", ["sa", "coding"]).members.join() === "sa,coding", "a new thread uses the team's members")
const started = readGroup(teamRoot, "started-room", ["sa", "coding"])
started.messages.push({ id: "m1", speaker: "sa", kind: "agent", body: "hi", at: new Date().toISOString() } as never)
writeGroup(teamRoot, started)
assert(readGroup(teamRoot, "started-room", ["devops", "deploy"]).members.join() === "sa,coding", "a started thread keeps its members")
const unstarted = readGroup(teamRoot, "idle-room", ["sa", "coding"])
writeGroup(teamRoot, unstarted)
assert(readGroup(teamRoot, "idle-room", ["devops", "deploy"]).members.join() === "devops,deploy", "an unstarted thread follows a changed team")
fs.rmSync(teamRoot, { recursive: true, force: true })

// Help checklist: tells the person exactly what to enter in each console, and never carries a secret.
const bare = {
  baseUrl: "https://agents.example.com/",
  engine: "draft",
  model: "composer-2.5",
  reasoningModel: null,
  signedIn: false,
  atlassian: { configured: false, connected: false, scopes: ["read:page:confluence", "offline_access"], extraScopes: ["read:comment:confluence"] },
  figma: { configured: true, connected: false, scopes: ["file_content:read"], hasToken: false },
  github: { configured: true, connected: true, scopes: ["repo"] },
  jenkinsConfigured: false,
  codeWorkspaceSet: false,
  designsDirSet: false,
}
const check = setupChecklist(bare)
const item = (id: string) => check.find((entry) => entry.id === id)!
assert(item("model").status === "todo" && item("account").status === "todo", "draft mode and guests are flagged")
assert(item("atlassian").copy?.[0].value === "https://agents.example.com/auth/atlassian/callback", "the callback URL is built from the base URL")
assert(item("atlassian").copy?.[1].value.includes("read:comment:confluence"), "extra Atlassian scopes appear in the list to enter")
assert(item("atlassian").status === "todo" && item("figma").status === "todo" && item("github").status === "ok", "each provider shows its own state")
assert(item("jenkins").status === "optional" && item("code").status === "optional", "optional pieces are not blockers")
assert(setupChecklist({ ...bare, figma: { ...bare.figma, hasToken: true } }).find((entry) => entry.id === "figma")?.status === "ok", "a Figma token counts as connected")

if (savedDataDir === undefined) delete process.env.DATA_DIR
else process.env.DATA_DIR = savedDataDir
fs.rmSync(envData, { recursive: true, force: true })

console.log("walkthrough ok: credentials sealed, Confluence only for SA, prior outputs only, runtime asks gated, group chat routed, kickoff hands off, Axian import scoped, environments isolated")
