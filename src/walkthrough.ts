import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadAgents } from "./agents.js"
import { decryptJson, encryptJson, loadSecrets, sealed, unseal } from "./crypto.js"
import { approveAndContinue, openRoom, runUntilWait, setMemoryRoot } from "./router.js"
import { buildPrompt, runLocal, type StageRunner } from "./runner.js"

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

console.log("walkthrough ok: credentials sealed, Confluence only for SA, prior outputs only")
