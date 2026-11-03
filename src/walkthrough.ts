import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadAgents } from "./agents.js"
import { decryptJson, encryptJson, loadSecrets, sealed, unseal } from "./crypto.js"
import { approveAndContinue, openRoom, runUntilWait, setMemoryRoot } from "./router.js"
import { buildPrompt, runLocal, type StageRunner, type TurnRunner } from "./runner.js"
import { addHumanMessage, DEFAULT_MEMBERS, handoffStages, newGroup, pickNextSpeaker, parseTurnTag, resolveAlias, runGroup } from "./group.js"
import { resolveTeamAgents } from "./catalog.js"
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

console.log("walkthrough ok: credentials sealed, Confluence only for SA, prior outputs only, runtime asks gated, group chat routed, kickoff hands off, Axian import scoped")
