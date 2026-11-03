import express from "express"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  bindSession,
  loginUser,
  publicUser,
  registerUser,
  requireUser,
  unbindSession,
  userForSession,
  workspaceForSession,
} from "./auth.js"
import {
  deleteCustomAgent,
  duplicateAgent,
  findCatalogAgent,
  listCatalog,
  resolveTeamAgents,
  updateCustomAgent,
} from "./catalog.js"
import {
  createTeam,
  deleteTeam,
  ensureDefaultTeam,
  getTeam,
  listTeams,
  updateTeam,
} from "./teams.js"
import { loadEnv } from "./env.js"
import {
  addConfluenceFooterComment,
  atlassianConfig,
  authorizeUrl,
  exchangeCode,
  fetchConfluencePage,
  listConfluenceFooterComments,
  pageIdFromUrl,
  refreshed,
} from "./atlassian.js"
import {
  addFigmaComment,
  authorizeUrl as figmaAuthorizeUrl,
  exchangeCode as figmaExchangeCode,
  fetchFigmaFileSummary,
  figmaConfig,
  listFigmaFrames,
  oauthAuth,
  readFigmaFrame,
  renderFigmaFrame,
  tokenAuth,
  type FigmaAuth,
  fileKeyFromUrl,
  refreshed as refreshedFigma,
} from "./figma.js"
import {
  authorizeUrl as githubAuthorizeUrl,
  exchangeCode as githubExchangeCode,
  githubConfig,
  normalizeBranch,
  openPullRequestFromBase,
  parseRepoUrl,
} from "./github.js"
import {
  addJiraComment,
  createJiraIssue,
  inferJiraIssueType,
  issueKeyFromTarget,
  parseJiraBoardUrl,
  summaryFromPayload,
  updateJiraIssue,
  attachJiraFile,
  findSprint,
  listSprints,
  moveIssuesToSprint,
} from "./jira.js"
import { buildHealthReport } from "./devops.js"
import { jenkinsConfig, smokeToken, triggerJenkinsJob } from "./jenkins.js"
import { runSmoke, type SmokeMode } from "./smoke.js"
import { qaTestUser } from "./e2e.js"
import { CredentialStore } from "./credentials.js"
import { loadSecrets, sealed, unseal } from "./crypto.js"
import {
  approveAndContinue,
  openRoom,
  recover,
  retry,
  runUntilWait,
  setMemoryRoot,
  softResetRoom,
  type RunHooks,
} from "./router.js"
import { engineName, selectRunner, selectTurnRunner, supportsRuntimeTools } from "./runner.js"
import { ensureSession } from "./session.js"
import { readRoom, writeRoom } from "./store.js"
import { slugifyRequirement, parseWritePlans } from "./permissions.js"
import {
  addMemory,
  formatMemoryForPacket,
  indexAgentOutput,
  indexPermissionResult,
  isMemoryKind,
  memoryEntriesForRoom,
  readMemory,
} from "./memory.js"
import { listDmAgents, readDm, writeDm } from "./dm.js"
import { buildPrFiles, extractJiraKeys, writeLocalMirror } from "./workdir.js"
import { annotatePng } from "./annotate.js"
import { findLocalRepo, localRepos, snapshotRepo } from "./code.js"
import { PermissionGate } from "./gate.js"
import {
  addHumanMessage,
  groupContext,
  handoffStages,
  newGroup,
  readGroup,
  runGroup,
  writeGroup,
  type GroupThread,
} from "./group.js"
import type { ReadToolName, RuntimeTools, ToolRequest } from "./tools.js"
import type { SDKCustomToolResult } from "@cursor/sdk"
import type { AgentFile, PermissionRequest, Room, SourceDoc } from "./types.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
loadEnv(root)
setMemoryRoot(root)
const port = Number(process.env.PORT ?? 4173)
const baseUrl = (process.env.APP_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, "")
const workdir = path.join(root, "data", "workdir")
const secrets = loadSecrets(root)
const credentials = new CredentialStore(root, secrets.credentialsKey)
const gate = new PermissionGate()
let busy = false
/** The group thread a run is working on, so messages sent mid-run join it. */
let liveGroup: { thread: GroupThread; agents: AgentFile[]; pause: boolean } | null = null

const app = express()
app.use(express.json())
app.use(express.static(path.join(root, "public")))

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    engine: engineName(),
    atlassianConfigured: Boolean(atlassianConfig(baseUrl)),
    figmaConfigured: Boolean(figmaConfig(baseUrl)),
    githubConfigured: Boolean(githubConfig(baseUrl)),
    jenkinsConfigured: Boolean(jenkinsConfig()),
    smokeConfigured: Boolean(smokeToken()),
    qaTestUserConfigured: Boolean(qaTestUser()),
  })
})

app.get("/api/session", (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  const atlassian = credentials.getAtlassian(sessionId)
  const figma = credentials.getFigma(sessionId)
  const github = credentials.getGitHub(sessionId)
  const user = userForSession(root, sessionId)
  const workspace = workspaceForSession(root, sessionId)
  ensureDefaultTeam(root)
  res.json({
    engine: engineName(),
    atlassianConfigured: Boolean(atlassianConfig(baseUrl)),
    figmaConfigured: Boolean(figmaConfig(baseUrl)),
    githubConfigured: Boolean(githubConfig(baseUrl)),
    jenkinsConfigured: Boolean(jenkinsConfig()),
    smokeConfigured: Boolean(smokeToken()),
    qaTestUserConfigured: Boolean(qaTestUser()),
    user: user ? publicUser(user) : null,
    workspace: workspace ? { id: workspace.id, name: workspace.name } : null,
    atlassian: atlassian
      ? { connected: true, siteName: atlassian.siteName, siteUrl: atlassian.siteUrl }
      : { connected: false },
    figma: figma
      ? { connected: true, userName: figma.userName, userEmail: figma.userEmail }
      : { connected: false },
    github: github
      ? { connected: true, userLogin: github.userLogin, userName: github.userName }
      : { connected: false },
  })
})

app.post("/api/auth/register", (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  try {
    const { user, workspace } = registerUser(root, {
      email: typeof req.body?.email === "string" ? req.body.email : "",
      password: typeof req.body?.password === "string" ? req.body.password : "",
      name: typeof req.body?.name === "string" ? req.body.name : "",
      workspaceName: typeof req.body?.workspaceName === "string" ? req.body.workspaceName : undefined,
    })
    bindSession(root, sessionId, user)
    ensureDefaultTeam(root)
    res.json({ user: publicUser(user), workspace: { id: workspace.id, name: workspace.name } })
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Register failed" })
  }
})

app.post("/api/auth/login", (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  try {
    const user = loginUser(root, {
      email: typeof req.body?.email === "string" ? req.body.email : "",
      password: typeof req.body?.password === "string" ? req.body.password : "",
    })
    bindSession(root, sessionId, user)
    const workspace = workspaceForSession(root, sessionId)
    res.json({
      user: publicUser(user),
      workspace: workspace ? { id: workspace.id, name: workspace.name } : null,
    })
  } catch (error) {
    res.status(401).json({ error: error instanceof Error ? error.message : "Login failed" })
  }
})

app.post("/api/auth/logout", (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  unbindSession(root, sessionId)
  res.json({ ok: true })
})

app.get("/api/catalog", (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  const user = userForSession(root, sessionId)
  const catalog = listCatalog(root, user?.workspaceId ?? null).map((agent) => ({
    name: agent.name,
    title: agent.title,
    needsApproval: agent.needsApproval,
    origin: agent.origin,
    tools: agent.tools,
    clonedFrom: agent.clonedFrom,
    file: agent.file,
  }))
  res.json({ agents: catalog })
})

app.get("/api/catalog/:name", (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  const user = userForSession(root, sessionId)
  const agent = findCatalogAgent(root, user?.workspaceId ?? null, String(req.params.name))
  if (!agent) {
    res.status(404).json({ error: "Agent not found" })
    return
  }
  res.json({
    agent: {
      name: agent.name,
      title: agent.title,
      needsApproval: agent.needsApproval,
      origin: agent.origin,
      tools: agent.tools,
      clonedFrom: agent.clonedFrom,
      instructions: agent.instructions,
      draft: agent.draft,
    },
  })
})

app.post("/api/catalog/duplicate", (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  try {
    const user = requireUser(root, sessionId)
    const sourceName = typeof req.body?.sourceName === "string" ? req.body.sourceName.trim() : ""
    if (!sourceName) {
      res.status(400).json({ error: "sourceName required" })
      return
    }
    const agent = duplicateAgent(root, user.workspaceId, sourceName, {
      name: typeof req.body?.name === "string" ? req.body.name : undefined,
      title: typeof req.body?.title === "string" ? req.body.title : undefined,
    })
    res.json({
      agent: {
        name: agent.name,
        title: agent.title,
        needsApproval: agent.needsApproval,
        origin: agent.origin,
        tools: agent.tools,
        clonedFrom: agent.clonedFrom,
      },
    })
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Duplicate failed" })
  }
})

app.post("/api/catalog/:name", (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  try {
    const user = requireUser(root, sessionId)
    const agent = updateCustomAgent(root, user.workspaceId, String(req.params.name), {
      title: typeof req.body?.title === "string" ? req.body.title : undefined,
      instructions: typeof req.body?.instructions === "string" ? req.body.instructions : undefined,
      draft: typeof req.body?.draft === "string" ? req.body.draft : undefined,
      needsApproval: typeof req.body?.needsApproval === "boolean" ? req.body.needsApproval : undefined,
      tools: Array.isArray(req.body?.tools)
        ? req.body.tools.filter((item: unknown): item is string => typeof item === "string")
        : undefined,
    })
    res.json({
      agent: {
        name: agent.name,
        title: agent.title,
        needsApproval: agent.needsApproval,
        origin: agent.origin,
        tools: agent.tools,
        instructions: agent.instructions,
        draft: agent.draft,
      },
    })
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Update failed" })
  }
})

app.delete("/api/catalog/:name", (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  try {
    const user = requireUser(root, sessionId)
    deleteCustomAgent(root, user.workspaceId, String(req.params.name))
    res.json({ ok: true })
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Delete failed" })
  }
})

app.get("/api/teams", (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  const user = userForSession(root, sessionId)
  res.json({ teams: listTeams(root, user?.workspaceId ?? null) })
})

app.post("/api/teams", (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  try {
    const user = requireUser(root, sessionId)
    const agentNames = Array.isArray(req.body?.agentNames)
      ? req.body.agentNames.filter((item: unknown): item is string => typeof item === "string")
      : []
    const team = createTeam(root, user.workspaceId, {
      name: typeof req.body?.name === "string" ? req.body.name : "",
      description: typeof req.body?.description === "string" ? req.body.description : undefined,
      agentNames,
      approvalMap:
        req.body?.approvalMap && typeof req.body.approvalMap === "object" ? req.body.approvalMap : undefined,
    })
    res.json({ team })
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Create team failed" })
  }
})

app.post("/api/teams/:id", (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  try {
    const user = requireUser(root, sessionId)
    const team = updateTeam(root, user.workspaceId, String(req.params.id), {
      name: typeof req.body?.name === "string" ? req.body.name : undefined,
      description: typeof req.body?.description === "string" ? req.body.description : undefined,
      agentNames: Array.isArray(req.body?.agentNames)
        ? req.body.agentNames.filter((item: unknown): item is string => typeof item === "string")
        : undefined,
      approvalMap:
        req.body?.approvalMap && typeof req.body.approvalMap === "object" ? req.body.approvalMap : undefined,
    })
    res.json({ team })
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Update team failed" })
  }
})

app.delete("/api/teams/:id", (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  try {
    const user = requireUser(root, sessionId)
    deleteTeam(root, user.workspaceId, String(req.params.id))
    res.json({ ok: true })
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Delete team failed" })
  }
})

app.post("/api/room/team", (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  const room = current()
  if (room.stages.some((stage) => stage.status !== "pending")) {
    res.status(409).json({ error: "Change team before the room starts (or Reset first)" })
    return
  }
  const teamId = typeof req.body?.teamId === "string" ? req.body.teamId.trim() : ""
  const user = userForSession(root, sessionId)
  try {
    const team = teamId ? getTeam(root, teamId) : ensureDefaultTeam(root)
    if (!team) {
      res.status(404).json({ error: "Team not found" })
      return
    }
    if (team.workspaceId && team.workspaceId !== user?.workspaceId) {
      res.status(403).json({ error: "Team not in your workspace" })
      return
    }
    const swarm = resolveTeamAgents(root, user?.workspaceId ?? null, team.agentNames, team.approvalMap)
    room.teamId = team.id
    room.stages = swarm.map((agent) => ({
      name: agent.name,
      title: agent.title,
      status: "pending" as const,
      output: null,
      agentId: null,
    }))
    writeRoom(root, room)
    res.json({ ...present(room), team })
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not set team" })
  }
})

app.get("/auth/atlassian", (req, res) => {
  const config = atlassianConfig(baseUrl)
  if (!config) {
    res.status(503).send("Set ATLASSIAN_CLIENT_ID and ATLASSIAN_CLIENT_SECRET, then restart the server.")
    return
  }
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  const state = sealed(secrets.sessionSecret, sessionId)
  res.redirect(authorizeUrl(config, state))
})

app.get("/auth/atlassian/callback", async (req, res) => {
  const config = atlassianConfig(baseUrl)
  if (!config) {
    res.status(503).send("Atlassian OAuth is not configured.")
    return
  }
  const code = typeof req.query.code === "string" ? req.query.code : ""
  const state = typeof req.query.state === "string" ? req.query.state : ""
  const sessionId = unseal(secrets.sessionSecret, state)
  if (!code || !sessionId) {
    res.status(400).send("Atlassian login did not return a valid code.")
    return
  }
  try {
    const credential = await exchangeCode(config, code)
    credentials.setAtlassian(sessionId, credential)
    res.redirect("/?connected=atlassian")
  } catch (error) {
    const message = error instanceof Error ? error.message : "Atlassian login failed"
    res.status(502).send(message)
  }
})

app.post("/api/atlassian/disconnect", (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  credentials.clearAtlassian(sessionId)
  res.json({ ok: true })
})

app.get("/auth/figma", (req, res) => {
  const config = figmaConfig(baseUrl)
  if (!config) {
    res.status(503).send("Set FIGMA_CLIENT_ID and FIGMA_CLIENT_SECRET, then restart the server.")
    return
  }
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  const state = sealed(secrets.sessionSecret, sessionId)
  res.redirect(figmaAuthorizeUrl(config, state))
})

app.get("/auth/figma/callback", async (req, res) => {
  const config = figmaConfig(baseUrl)
  if (!config) {
    res.status(503).send("Figma OAuth is not configured.")
    return
  }
  const code = typeof req.query.code === "string" ? req.query.code : ""
  const state = typeof req.query.state === "string" ? req.query.state : ""
  const sessionId = unseal(secrets.sessionSecret, state)
  if (!code || !sessionId) {
    res.status(400).send("Figma login did not return a valid code.")
    return
  }
  try {
    const credential = await figmaExchangeCode(config, code)
    credentials.setFigma(sessionId, credential)
    res.redirect("/?connected=figma")
  } catch (error) {
    const message = error instanceof Error ? error.message : "Figma login failed"
    res.status(502).send(message)
  }
})

app.post("/api/figma/disconnect", (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  credentials.clearFigma(sessionId)
  res.json({ ok: true })
})

app.get("/auth/github", (req, res) => {
  const config = githubConfig(baseUrl)
  if (!config) {
    res.status(503).send("Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, then restart the server.")
    return
  }
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  const state = sealed(secrets.sessionSecret, sessionId)
  res.redirect(githubAuthorizeUrl(config, state))
})

app.get("/auth/github/callback", async (req, res) => {
  const config = githubConfig(baseUrl)
  if (!config) {
    res.status(503).send("GitHub OAuth is not configured.")
    return
  }
  const code = typeof req.query.code === "string" ? req.query.code : ""
  const state = typeof req.query.state === "string" ? req.query.state : ""
  const sessionId = unseal(secrets.sessionSecret, state)
  if (!code || !sessionId) {
    res.status(400).send("GitHub login did not return a valid code.")
    return
  }
  try {
    const credential = await githubExchangeCode(config, code)
    credentials.setGitHub(sessionId, credential)
    res.redirect("/?connected=github")
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub login failed"
    res.status(502).send(message)
  }
})

app.post("/api/github/disconnect", (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  credentials.clearGitHub(sessionId)
  res.json({ ok: true })
})

app.get("/api/room", (req, res) => {
  ensureSession(req, res, secrets.sessionSecret)
  res.json(present(current()))
})

app.post("/api/room/reset", (req, res) => {
  if (busy) {
    res.status(409).json({ error: "A role is already running" })
    return
  }
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  const workspaceId = userForSession(root, sessionId)?.workspaceId ?? null
  const hard = Boolean(req.body?.hard)
  const requirement =
    typeof req.body?.requirement === "string" && req.body.requirement.trim()
      ? req.body.requirement.trim()
      : undefined
  const prior = hard ? null : current()
  const swarm = roomAgents(prior, workspaceId)
  const room = hard ? openRoom(swarm, requirement) : softResetRoom(prior!, swarm, requirement)
  if (!room.teamId) room.teamId = ensureDefaultTeam(root).id
  writeRoom(root, room)
  res.json(present(room))
})

app.post("/api/room/requirement", (req, res) => {
  ensureSession(req, res, secrets.sessionSecret)
  const room = current()
  if (room.stages.some((stage) => stage.status !== "pending")) {
    res.status(409).json({ error: "Requirement can only change before the room starts. Use Reset." })
    return
  }
  const requirement = typeof req.body?.requirement === "string" ? req.body.requirement.trim() : ""
  if (!requirement) {
    res.status(400).json({ error: "Requirement text is required." })
    return
  }
  room.requirement = requirement
  room.id = slugifyRequirement(requirement)
  room.messages = [
    {
      id: crypto.randomUUID(),
      kind: "human",
      title: "You",
      body: requirement,
      at: new Date().toISOString(),
    },
  ]
  writeRoom(root, room)
  res.json(present(room))
})

/** Annotated screens made by design_annotate (file names only, no paths). */
app.get("/api/annotations/:file", (req, res) => {
  const file = path.basename(String(req.params.file))
  const full = path.join(annotationsDir, file)
  if (!/\.png$/i.test(file) || !fs.existsSync(full)) {
    res.status(404).end()
    return
  }
  res.sendFile(full)
})

/** Runtime asks an agent is blocked on right now (room run or DM). */
app.get("/api/permissions/live", (req, res) => {
  ensureSession(req, res, secrets.sessionSecret)
  res.json({ pending: gate.pending() })
})

app.post("/api/room/permissions/:id/approve", async (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  // A live ask: wake the blocked tool call. The run itself makes the write.
  if (gate.answer(req.params.id, { approved: true, remember: req.body?.remember === true, reason: null })) {
    res.json({ ok: true, live: true })
    return
  }
  const room = current()
  const permission = room.permissions?.find((item) => item.id === req.params.id)
  if (!permission) {
    res.status(404).json({ error: "Permission request not found" })
    return
  }
  if (permission.status !== "pending") {
    res.status(409).json({ error: `Permission is already ${permission.status}` })
    return
  }
  try {
    await executePermission(sessionId, room, permission)
    permission.status = "executed"
    permission.resolvedAt = new Date().toISOString()
    permission.error = null
    indexPermissionResult({
      root,
      roomId: room.id,
      agentName: permission.roleName,
      system: permission.system,
      action: permission.action,
      target: permission.target,
      status: "executed",
      detail: permission.payloadSummary,
      surface: permission.surface || "room",
    })
    room.messages.push({
      id: crypto.randomUUID(),
      kind: "human",
      title: "You",
      body: `Approved write: ${permission.system} — ${permission.action} → ${permission.target}`,
      at: new Date().toISOString(),
    })
    writeRoom(root, room)
    res.json(present(room))
  } catch (error) {
    permission.status = "failed"
    permission.resolvedAt = new Date().toISOString()
    permission.error = error instanceof Error ? error.message : "Write failed"
    indexPermissionResult({
      root,
      roomId: room.id,
      agentName: permission.roleName,
      system: permission.system,
      action: permission.action,
      target: permission.target,
      status: "failed",
      detail: permission.error,
      surface: permission.surface || "room",
    })
    writeRoom(root, room)
    res.status(502).json({ error: permission.error, room: present(room) })
  }
})

app.post("/api/room/permissions/:id/deny", (req, res) => {
  ensureSession(req, res, secrets.sessionSecret)
  const reason = typeof req.body?.reason === "string" && req.body.reason.trim() ? req.body.reason.trim() : null
  if (gate.answer(req.params.id, { approved: false, remember: false, reason })) {
    res.json({ ok: true, live: true })
    return
  }
  const room = current()
  const permission = room.permissions?.find((item) => item.id === req.params.id)
  if (!permission) {
    res.status(404).json({ error: "Permission request not found" })
    return
  }
  if (permission.status !== "pending") {
    res.status(409).json({ error: `Permission is already ${permission.status}` })
    return
  }
  permission.status = "denied"
  permission.resolvedAt = new Date().toISOString()
  indexPermissionResult({
    root,
    roomId: room.id,
    agentName: permission.roleName,
    system: permission.system,
    action: permission.action,
    target: permission.target,
    status: "denied",
    detail: "Denied by human",
    surface: permission.surface || "room",
  })
  room.messages.push({
    id: crypto.randomUUID(),
    kind: "human",
    title: "You",
    body: `Denied write: ${permission.system} — ${permission.action}`,
    at: new Date().toISOString(),
  })
  writeRoom(root, room)
  res.json(present(room))
})

app.get("/api/memory", (req, res) => {
  ensureSession(req, res, secrets.sessionSecret)
  const room = current()
  const store = readMemory(root, room.id)
  res.json(store)
})

app.post("/api/memory", (req, res) => {
  ensureSession(req, res, secrets.sessionSecret)
  const room = current()
  const kindRaw = typeof req.body?.kind === "string" ? req.body.kind.trim() : "note"
  const kind = isMemoryKind(kindRaw) ? kindRaw : "note"
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : ""
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : ""
  if (!title || !body) {
    res.status(400).json({ error: "title and body are required" })
    return
  }
  const entry = addMemory(root, room.id, {
    kind,
    title,
    body,
    agent: "human",
    source: "room:note",
  })
  res.json({ entry, memory: readMemory(root, room.id) })
})

app.get("/api/dm", (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  const room = current()
  const workspaceId = userForSession(root, sessionId)?.workspaceId ?? null
  const catalog = listCatalog(root, workspaceId).map((agent) => ({
    name: agent.name,
    title: agent.title,
    needsApproval: agent.needsApproval,
  }))
  const active = listDmAgents(root, room.id)
  res.json({ agents: catalog, activeThreads: active })
})

app.get("/api/dm/:agentName", (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  const room = current()
  const agentName = String(req.params.agentName || "")
  const workspaceId = userForSession(root, sessionId)?.workspaceId ?? null
  const agent = findCatalogAgent(root, workspaceId, agentName)
  if (!agent) {
    res.status(404).json({ error: "Unknown agent" })
    return
  }
  const thread = readDm(root, room.id, agentName)
  res.json({
    agent: { name: agent.name, title: agent.title, needsApproval: agent.needsApproval },
    thread,
    memoryPreview: formatMemoryForPacket(memoryEntriesForRoom(root, room), 12),
  })
})

app.post("/api/dm/:agentName/message", async (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  if (busy) {
    res.status(409).json({ error: "A role is already running" })
    return
  }
  const room = current()
  const agentName = String(req.params.agentName || "")
  const workspaceId = userForSession(root, sessionId)?.workspaceId ?? null
  const agent = findCatalogAgent(root, workspaceId, agentName)
  if (!agent) {
    res.status(404).json({ error: "Unknown agent" })
    return
  }
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : ""
  if (!body) {
    res.status(400).json({ error: "Message body required" })
    return
  }

  busy = true
  const runId = crypto.randomUUID()
  const thread = readDm(root, room.id, agentName)
  thread.messages.push({
    id: crypto.randomUUID(),
    kind: "human",
    title: "You",
    body,
    at: new Date().toISOString(),
  })
  try {
    const sources = await loadSourcesForRole(sessionId, room, agent.name)
    const dmHistory = thread.messages
      .slice(-20)
      .map((msg) => `${msg.title}: ${msg.body}`)
      .join("\n\n")
    const packet = {
      requirement: room.requirement,
      projectMarkdown: projectMarkdown(),
      role: agent,
      prior: finishedStageOutputs(room),
      notes: room.notes,
      sources,
      memory: formatMemoryForPacket(memoryEntriesForRoom(root, room)),
      dmHistory,
    }

    const runner = selectRunner(workdir)
    const tools = runtimeTools({
      sessionId,
      room,
      agent,
      runId,
      surface: "dm",
      onChange: () => writeRoom(root, room),
    })
    const result = await runner(packet, () => undefined, tools)
    const output = appendDmAck(result.output, body)

    const { indexAgentOutput } = await import("./memory.js")
    indexAgentOutput({
      root,
      roomId: room.id,
      agentName: agent.name,
      agentTitle: agent.title,
      output,
      surface: "dm",
    })

    const plans = parseWritePlans(output, {
      roleName: agent.name,
      roleTitle: agent.title,
      surface: "dm",
    })
    if (plans.length) {
      room.permissions = [...(room.permissions || []), ...plans]
      writeRoom(root, room)
    }

    thread.messages.push({
      id: crypto.randomUUID(),
      kind: "agent",
      title: agent.title,
      body: output,
      at: new Date().toISOString(),
      agentId: result.agentId,
    })
    writeDm(root, thread)

    res.json({
      thread,
      room: present(room),
      permissionsAdded: plans.length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "DM failed"
    // Keep the person's message and show the failure in the thread, so nothing is lost.
    thread.messages.push({
      id: crypto.randomUUID(),
      kind: "agent",
      title: agent.title,
      body: `I could not reply: ${message}`,
      at: new Date().toISOString(),
    })
    writeDm(root, thread)
    res.status(502).json({ error: message, thread })
  } finally {
    gate.endRun(runId)
    busy = false
  }
})

app.get("/api/group", (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  const room = current()
  const thread = liveGroup?.thread ?? readGroup(root, room.id)
  res.json(presentGroup(thread, groupAgents(thread, sessionId)))
})

/** Send a message. Mid-run it joins the live thread; otherwise it starts a run (NDJSON stream). */
app.post("/api/group/message", async (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : ""
  if (liveGroup) {
    if (!body) {
      res.status(409).json({ error: "The group is already talking" })
      return
    }
    addHumanMessage(liveGroup.thread, body, liveGroup.agents)
    writeGroup(root, liveGroup.thread)
    res.json({ queued: true, ...presentGroup(liveGroup.thread, liveGroup.agents) })
    return
  }
  if (busy) {
    res.status(409).json({ error: "A role is already running" })
    return
  }
  const room = current()
  const thread = readGroup(root, room.id)
  const agents = groupAgents(thread, sessionId)
  if (body) addHumanMessage(thread, body, agents)
  await streamGroup(res, sessionId, room, thread, agents)
})

/** Finish kickoff: its members' stages are done; the pipeline continues at the next role. */
app.post("/api/group/handoff", async (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  if (liveGroup || busy) {
    res.status(409).json({ error: "Wait until the group has stopped talking" })
    return
  }
  const room = current()
  const thread = readGroup(root, room.id)
  if (!thread.messages.some((message) => message.kind === "agent")) {
    res.status(409).json({ error: "Run the kickoff discussion first" })
    return
  }
  const handed = handoffStages(room, thread)
  writeRoom(root, handed)
  const workspaceId = userForSession(root, sessionId)?.workspaceId ?? null
  await streamRun(res, sessionId, (hooks) =>
    runUntilWait(handed, roomAgents(handed, workspaceId), projectMarkdown(), selectRunner(workdir), hooks),
  )
})

app.post("/api/group/pause", (req, res) => {
  ensureSession(req, res, secrets.sessionSecret)
  if (liveGroup) liveGroup.pause = true
  res.json({ ok: true })
})

app.post("/api/group/reset", (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  if (liveGroup) {
    res.status(409).json({ error: "Pause the group before starting over" })
    return
  }
  const thread = newGroup(current().id)
  writeGroup(root, thread)
  res.json(presentGroup(thread, groupAgents(thread, sessionId)))
})

app.post("/api/room/source", async (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  const room = current()
  if (room.stages.some((stage) => stage.status !== "pending")) {
    res.status(409).json({ error: "Set the BRS source before the room starts" })
    return
  }

  const url = typeof req.body?.confluencePageUrl === "string" ? req.body.confluencePageUrl.trim() : ""
  const pasted =
    typeof req.body?.pastedBrd === "string" ? req.body.pastedBrd.trim() : room.pastedBrd?.trim() || ""

  if (typeof req.body?.pastedBrd === "string") {
    room.pastedBrd = pasted || null
  }

  if (!url) {
    room.confluencePageUrl = null
    writeRoom(root, room)
    res.json({
      ...present(room),
      preview: room.pastedBrd
        ? { title: "Pasted BRS", url: "pasted://brs", chars: room.pastedBrd.length }
        : null,
    })
    return
  }

  if (!pageIdFromUrl(url)) {
    res.status(400).json({
      error:
        "That does not look like a Confluence page link. Open the page in Confluence, copy the browser URL, and use one that contains /pages/<number>/.",
    })
    return
  }

  const config = atlassianConfig(baseUrl)
  const saved = credentials.getAtlassian(sessionId)
  if (!config || !saved) {
    res.status(400).json({ error: "Connect Atlassian before saving a Confluence page, or paste the BRS text instead." })
    return
  }

  try {
    const fresh = await refreshed(config, saved)
    credentials.setAtlassian(sessionId, fresh)
    const preview = await fetchConfluencePage(fresh, url)
    room.confluencePageUrl = url
    writeRoom(root, room)
    res.json({
      ...present(room),
      preview: { title: preview.title, url: preview.url, chars: preview.body.length },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read that Confluence page"
    if (room.pastedBrd?.trim()) {
      room.confluencePageUrl = null
      writeRoom(root, room)
      res.json({
        ...present(room),
        preview: { title: "Pasted BRS", url: "pasted://brs", chars: room.pastedBrd.length },
        warning: `Confluence link could not be read, so the pasted BRS will be used instead. ${message}`,
      })
      return
    }
    res.status(400).json({ error: message })
  }
})

app.post("/api/room/figma-source", (req, res) => {
  ensureSession(req, res, secrets.sessionSecret)
  const room = current()

  const url = typeof req.body?.figmaFileUrl === "string" ? req.body.figmaFileUrl.trim() : ""
  if (!url) {
    room.figmaFileUrl = null
    writeRoom(root, room)
    res.json({ ...present(room), figmaPreview: null })
    return
  }

  const fileKey = fileKeyFromUrl(url)
  if (!fileKey) {
    res.status(400).json({
      error:
        "That does not look like a Figma file link. Open the file in Figma, copy the browser URL (file, design, proto, or board).",
    })
    return
  }

  room.figmaFileUrl = url
  writeRoom(root, room)
  res.json({
    ...present(room),
    figmaPreview: { fileKey, url },
  })
})

app.post("/api/room/jira-source", (req, res) => {
  ensureSession(req, res, secrets.sessionSecret)
  const room = current()

  const url = typeof req.body?.jiraBoardUrl === "string" ? req.body.jiraBoardUrl.trim() : ""
  if (!url) {
    room.jiraBoardUrl = null
    room.jiraProjectKey = null
    writeRoom(root, room)
    res.json({ ...present(room), jiraPreview: null })
    return
  }

  const parsed = parseJiraBoardUrl(url)
  if (!parsed) {
    res.status(400).json({
      error:
        "That does not look like a Jira board/project link. Paste a board URL or a project key (e.g. ORD).",
    })
    return
  }

  room.jiraBoardUrl = parsed.boardUrl
  room.jiraProjectKey = parsed.projectKey
  writeRoom(root, room)
  res.json({
    ...present(room),
    jiraPreview: {
      projectKey: parsed.projectKey,
      boardId: parsed.boardId,
      url: parsed.boardUrl,
    },
  })
})

app.post("/api/room/git-source", (req, res) => {
  ensureSession(req, res, secrets.sessionSecret)
  const room = current()
  if (!Array.isArray(room.gitRepos)) room.gitRepos = []

  const action = typeof req.body?.action === "string" ? req.body.action : "add"

  if (action === "remove") {
    const id = typeof req.body?.id === "string" ? req.body.id : ""
    if (!id) {
      res.status(400).json({ error: "Missing repo id to remove." })
      return
    }
    room.gitRepos = room.gitRepos.filter((item) => item.id !== id)
    writeRoom(root, room)
    res.json({ ...present(room) })
    return
  }

  const repoRaw = typeof req.body?.gitRepoUrl === "string" ? req.body.gitRepoUrl.trim() : ""
  const branchRaw = typeof req.body?.gitBranch === "string" ? req.body.gitBranch.trim() : ""

  if (!repoRaw) {
    res.status(400).json({ error: "Paste a GitHub repository URL (https://github.com/owner/repo)." })
    return
  }

  const parsed = parseRepoUrl(repoRaw)
  if (!parsed) {
    res.status(400).json({
      error: "That does not look like a GitHub repo link. Use https://github.com/owner/repo.",
    })
    return
  }

  const branch = branchRaw ? normalizeBranch(branchRaw) : "main"
  if (branchRaw && !branch) {
    res.status(400).json({ error: "Branch name looks invalid." })
    return
  }

  const existing = room.gitRepos.find((item) => item.owner === parsed.owner && item.repo === parsed.repo)
  if (existing) {
    existing.branch = branch!
    existing.url = parsed.url
  } else {
    room.gitRepos.push({
      id: crypto.randomUUID(),
      url: parsed.url,
      owner: parsed.owner,
      repo: parsed.repo,
      branch: branch!,
    })
  }

  writeRoom(root, room)
  res.json({
    ...present(room),
    gitPreview: { owner: parsed.owner, repo: parsed.repo, url: parsed.url, branch },
  })
})

app.post("/api/room/deploy-source", (req, res) => {
  ensureSession(req, res, secrets.sessionSecret)
  const room = current()

  const deployUrl =
    typeof req.body?.deployUrl === "string" ? req.body.deployUrl.trim() : room.deployUrl || ""
  const deployEnv =
    typeof req.body?.deployEnv === "string" ? req.body.deployEnv.trim() : room.deployEnv || ""
  const jenkinsJob =
    typeof req.body?.jenkinsJob === "string" ? req.body.jenkinsJob.trim() : room.jenkinsJob || ""

  if (deployUrl && !/^https?:\/\//i.test(deployUrl)) {
    res.status(400).json({ error: "Deploy URL must start with http:// or https://." })
    return
  }

  room.deployUrl = deployUrl || null
  room.deployEnv = deployEnv || null
  room.jenkinsJob = jenkinsJob || null
  writeRoom(root, room)
  res.json({
    ...present(room),
    deployPreview: {
      deployUrl: room.deployUrl,
      deployEnv: room.deployEnv,
      jenkinsJob: room.jenkinsJob,
    },
  })
})

app.post("/api/jenkins/smoke", async (req, res) => {
  const expected = smokeToken()
  if (!expected) {
    res.status(503).json({ error: "Set JENKINS_SMOKE_TOKEN so Jenkins can call this smoke endpoint." })
    return
  }
  const auth = typeof req.headers.authorization === "string" ? req.headers.authorization : ""
  const token = auth.replace(/^Bearer\s+/i, "").trim()
  if (!token || token !== expected) {
    res.status(401).json({ error: "Unauthorized smoke callback" })
    return
  }

  const room = current()
  const roomId = typeof req.body?.roomId === "string" ? req.body.roomId.trim() : ""
  if (roomId && roomId !== room.id) {
    res.status(404).json({ error: `Room ${roomId} is not the active room (${room.id})` })
    return
  }

  const modeRaw = typeof req.body?.mode === "string" ? req.body.mode.trim().toLowerCase() : "api"
  const mode: SmokeMode =
    modeRaw === "e2e" || modeRaw === "both" || modeRaw === "api" ? modeRaw : "api"
  const base =
    (typeof req.body?.baseUrl === "string" && req.body.baseUrl.trim()) ||
    room.deployUrl ||
    ""
  if (!base) {
    res.status(400).json({ error: "Provide baseUrl in the body or set Deploy URL in Setup" })
    return
  }
  const env =
    (typeof req.body?.env === "string" && req.body.env.trim()) || room.deployEnv || "Dev"
  const checks = Array.isArray(req.body?.checks)
    ? req.body.checks.filter((item: unknown): item is string => typeof item === "string")
    : undefined
  const probePath =
    typeof req.body?.probePath === "string" ? req.body.probePath.trim() : undefined

  try {
    const report = await runSmoke({
      room,
      baseUrl: base,
      env,
      mode,
      checks,
      probePath,
      root,
    })
    room.lastSmokeReport = report
    room.deployUrl = base
    room.deployEnv = env
    if (!room.deploymentsByEnv) room.deploymentsByEnv = {}
    room.deploymentsByEnv[env] = {
      url: base,
      at: report.at,
      smokeResult: report.result,
      job: room.jenkinsJob,
    }
    const health = await buildHealthReport({ room, env, smoke: report })
    room.lastHealthReport = health
    writeRoom(root, room)
    res.status(report.result === "pass" ? 200 : 422).json({ ...report, health })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Smoke run failed"
    res.status(500).json({ error: message })
  }
})

app.get("/api/room/health-report", async (req, res) => {
  ensureSession(req, res, secrets.sessionSecret)
  const room = current()
  const health = await buildHealthReport({ room })
  room.lastHealthReport = health
  writeRoom(root, room)
  res.json(health)
})

app.post("/api/room/start", async (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  const room = current()
  if (room.stages.some((stage) => stage.status !== "pending")) {
    res.json(present(room))
    return
  }
  await streamRun(res, sessionId, (hooks) =>
    runUntilWait(room, roomAgents(room, userForSession(root, sessionId)?.workspaceId ?? null), projectMarkdown(), selectRunner(workdir), hooks),
  )
})

app.post("/api/room/approve", async (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  const room = current()
  if (!room.stages.some((stage) => stage.status === "waiting_approval")) {
    res.status(409).json({ error: "Nothing is waiting for approval" })
    return
  }
  const note = typeof req.body?.note === "string" ? req.body.note : undefined
  await streamRun(res, sessionId, (hooks) =>
    approveAndContinue(room, roomAgents(room, userForSession(root, sessionId)?.workspaceId ?? null), projectMarkdown(), selectRunner(workdir), note, hooks),
  )
})

app.post("/api/room/retry", async (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
  const room = current()
  if (!room.stages.some((stage) => stage.status === "error")) {
    res.status(409).json({ error: "Nothing needs a retry" })
    return
  }
  await streamRun(res, sessionId, (hooks) =>
    retry(room, roomAgents(room, userForSession(root, sessionId)?.workspaceId ?? null), projectMarkdown(), selectRunner(workdir), hooks),
  )
})

app.listen(port, () => {
  console.log(`Agent room at ${baseUrl} (${engineName()})`)
})

async function streamRun(
  res: express.Response,
  sessionId: string,
  work: (hooks: RunHooks) => Promise<Room>,
) {
  if (busy) {
    res.status(409).json({ error: "A role is already running" })
    return
  }
  busy = true
  const runId = crypto.randomUUID()
  res.status(200)
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8")
  res.setHeader("Cache-Control", "no-cache, no-transform")
  res.flushHeaders()
  const emit = (event: unknown) => {
    res.write(`${JSON.stringify(event)}\n`)
  }
  const hooks: RunHooks = {
    onRoom: (room) => {
      writeRoom(root, room)
      emit({ type: "room", room: present(room) })
    },
    onDelta: (roleName, text) => {
      const title =
        roomAgents(current(), null).find((agent) => agent.name === roleName)?.title ?? roleName
      emit({ type: "delta", name: roleName, title, text })
    },
    loadSources: (room, roleName) => loadSourcesForRole(sessionId, room, roleName),
    toolsFor: (room, agent) =>
      runtimeTools({
        sessionId,
        room,
        agent,
        runId,
        surface: "room",
        onChange: () => {
          writeRoom(root, room)
          emit({ type: "room", room: present(room) })
        },
      }),
  }
  try {
    const room = await work(hooks)
    writeRoom(root, room)
    emit({ type: "room", room: present(room) })
  } catch (error) {
    const message = error instanceof Error ? error.message : "The run failed"
    emit({ type: "error", message })
  } finally {
    gate.endRun(runId)
    busy = false
    res.end()
  }
}

function groupAgents(thread: GroupThread, sessionId: string): AgentFile[] {
  const workspaceId = userForSession(root, sessionId)?.workspaceId ?? null
  return thread.members.map((name) => {
    const agent = findCatalogAgent(root, workspaceId, name)
    if (!agent) throw new Error(`Group member ${name} is not in the agent catalog`)
    return agent
  })
}

function presentGroup(thread: GroupThread, agents: AgentFile[]) {
  return {
    thread,
    members: agents.map((agent) => ({ name: agent.name, title: agent.title })),
    running: Boolean(liveGroup),
    engine: engineName(),
  }
}

async function streamGroup(
  res: express.Response,
  sessionId: string,
  room: Room,
  thread: GroupThread,
  agents: AgentFile[],
) {
  busy = true
  liveGroup = { thread, agents, pause: false }
  const live = liveGroup
  const runId = crypto.randomUUID()
  res.status(200)
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8")
  res.setHeader("Cache-Control", "no-cache, no-transform")
  res.flushHeaders()
  const emit = (event: unknown) => {
    res.write(`${JSON.stringify(event)}\n`)
  }
  const sync = () => {
    writeGroup(root, thread)
    emit({ type: "group", ...presentGroup(thread, agents) })
  }
  let sharedSources: Promise<SourceDoc[]> | null = null
  try {
    await runGroup(thread, {
      agents,
      runner: selectTurnRunner(workdir),
      requirement: room.requirement,
      maxTurns: Number(process.env.GROUP_MAX_TURNS) || 12,
      withTools: supportsRuntimeTools(),
      // Members share the same sources, so load them once per run.
      sourcesFor: (agent) => (sharedSources ??= loadSourcesForRole(sessionId, room, agent.name, true)),
      contextFor: async (agent, sources) =>
        groupContext({
          agent,
          projectMarkdown: projectMarkdown(),
          requirement: room.requirement,
          memory: formatMemoryForPacket(memoryEntriesForRoom(root, room)),
          sources,
          notes: room.notes,
        }),
      toolsFor: (agent) =>
        runtimeTools({
          sessionId,
          room,
          agent,
          runId,
          surface: "group",
          onChange: () => writeRoom(root, room),
        }),
      onThread: sync,
      onDelta: (agent, text) => emit({ type: "delta", name: agent.name, title: agent.title, text }),
      onMessage: (agent, message) => {
        indexAgentOutput({
          root,
          roomId: room.id,
          agentName: agent.name,
          agentTitle: agent.title,
          output: message.body,
          surface: "group",
        })
      },
      shouldPause: () => live.pause,
    })
  } catch (error) {
    emit({ type: "error", message: error instanceof Error ? error.message : "The group run failed" })
  } finally {
    gate.endRun(runId)
    liveGroup = null
    busy = false
    sync()
    res.end()
  }
}

/** `shared`: group chat members all read the BRS, Figma and repos together. */
async function loadSourcesForRole(
  sessionId: string,
  room: Room,
  roleName: string,
  shared = false,
): Promise<SourceDoc[]> {
  const sources: SourceDoc[] = []
  const needsBrd = shared || roleName === "sa" || roleName === "software-lead"
  const needsFigma = shared || roleName === "sa" || roleName === "software-lead"
  const needsGit =
    shared ||
    roleName === "sa" ||
    roleName === "software-lead" ||
    roleName === "architecture" ||
    roleName === "coding"

  if (needsBrd && room.pastedBrd?.trim()) {
    sources.push({
      kind: "paste",
      title: "Pasted BRS",
      url: "pasted://brs",
      body: room.pastedBrd.trim(),
    })
  }

  // One unreadable source (e.g. Figma rate limit) must not stop a chat or a role: the agent gets a note instead.
  const load = async (kind: SourceDoc["kind"], name: string, url: string, read: () => Promise<SourceDoc>) => {
    try {
      sources.push(await read())
    } catch (error) {
      sources.push({
        kind,
        title: `${name} (could not be loaded)`,
        url,
        body: `The app could not read this source: ${error instanceof Error ? error.message : "unknown error"}. Do not guess its contents. Tell the person, and work from the other sources.`,
      })
    }
  }

  if (needsBrd && room.confluencePageUrl) {
    const pageUrl = room.confluencePageUrl
    await load("confluence", "Confluence BRS", pageUrl, async () => {
      const config = atlassianConfig(baseUrl)
      if (!config) {
        throw new Error("Atlassian OAuth is not configured on the server")
      }
      const saved = credentials.getAtlassian(sessionId)
      if (!saved) {
        throw new Error("Connect Atlassian before this role can read Confluence")
      }
      const fresh = await refreshed(config, saved)
      credentials.setAtlassian(sessionId, fresh)
      return fetchConfluencePage(fresh, pageUrl)
    })
  }

  if (needsFigma && process.env.DESIGNS_DIR?.trim()) {
    sources.push(designsSource(process.env.DESIGNS_DIR.trim()))
  }

  if (needsFigma && room.figmaFileUrl) {
    const fileUrl = room.figmaFileUrl
    await load("figma", "Figma file", fileUrl, async () => {
      const summary = await cachedFigmaSummary(sessionId, fileUrl)
      return { kind: "figma", title: summary.title, url: summary.url, body: summary.body }
    })
  }

  if (needsGit && room.gitRepos?.length) {
    sources.push(...(await codeSources(room)))
    const lines = room.gitRepos.map(
      (item, index) => `${index + 1}. ${item.owner}/${item.repo} @ ${item.branch}\n   ${item.url}`,
    )
    sources.push({
      kind: "github",
      title: "Sprint GitHub repositories",
      url: room.gitRepos[0]?.url ?? "github://repos",
      body: [
        "Microservice repositories configured for this room:",
        ...lines,
        "",
        room.jiraProjectKey ? `Jira project key: ${room.jiraProjectKey}` : "Jira project key: (not set)",
        room.jiraBoardUrl ? `Jira board: ${room.jiraBoardUrl}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    })
  }

  const needsDeployCtx =
    roleName === "deploy" ||
    roleName === "qa-unit" ||
    roleName === "qa-e2e" ||
    roleName === "devops"
  if (needsDeployCtx) {
    const envLines = Object.entries(room.deploymentsByEnv || {}).map(
      ([envName, rec]) =>
        `- ${envName}: ${rec.url} (smoke=${rec.smokeResult ?? "n/a"} @ ${rec.at}${rec.job ? `; job ${rec.job}` : ""})`,
    )
    sources.push({
      kind: "paste",
      title: "Deploy / smoke context",
      url: "room://deploy",
      body: [
        `Current env: ${room.deployEnv || "(not set)"}`,
        `Deploy URL: ${room.deployUrl || "(not set)"}`,
        `Jenkins job: ${room.jenkinsJob || "(not set)"}`,
        `QA test user configured: ${qaTestUser() ? "yes (secret; do not print credentials)" : "no"}`,
        "",
        "Env ladder records:",
        envLines.length ? envLines.join("\n") : "- (none yet)",
        "",
        "Last smoke:",
        room.lastSmokeReport ? JSON.stringify(room.lastSmokeReport, null, 2).slice(0, 4000) : "(none)",
        "",
        "Last health:",
        room.lastHealthReport ? JSON.stringify(room.lastHealthReport, null, 2).slice(0, 2000) : "(none)",
      ].join("\n"),
    })
  }

  return sources
}

function current(): Room {
  const existing = readRoom(root)
  if (!existing) {
    const defaultTeam = ensureDefaultTeam(root)
    const room = openRoom(roomAgents(null, null))
    room.teamId = defaultTeam.id
    writeRoom(root, room)
    return room
  }
  const recovered = recover(existing)
  if (!recovered.teamId) {
    recovered.teamId = ensureDefaultTeam(root).id
    writeRoom(root, recovered)
  }
  if (recovered !== existing) writeRoom(root, recovered)
  return recovered
}

function present(room: Room) {
  const memory = readMemory(root, room.id)
  const team = room.teamId ? getTeam(root, room.teamId) : ensureDefaultTeam(root)
  return {
    ...room,
    engine: engineName(),
    atlassianConfigured: Boolean(atlassianConfig(baseUrl)),
    figmaConfigured: Boolean(figmaConfig(baseUrl)),
    githubConfigured: Boolean(githubConfig(baseUrl)),
    jenkinsConfigured: Boolean(jenkinsConfig()),
    smokeConfigured: Boolean(smokeToken()),
    qaTestUserConfigured: Boolean(qaTestUser()),
    memoryCount: memory.entries.length,
    memoryPreview: formatMemoryForPacket(memory.entries, 8),
    team: team
      ? { id: team.id, name: team.name, agentNames: team.agentNames, isDefault: team.isDefault }
      : null,
  }
}

function roomAgents(room: Room | null, workspaceId: string | null) {
  const team =
    (room?.teamId && getTeam(root, room.teamId)) || ensureDefaultTeam(root)
  return resolveTeamAgents(root, workspaceId, team.agentNames, team.approvalMap)
}

function finishedStageOutputs(room: Room): { title: string; output: string }[] {
  return room.stages
    .filter((stage) => stage.status === "done" && stage.output)
    .map((stage) => ({ title: stage.title, output: stage.output as string }))
}

function appendDmAck(output: string, ask: string): string {
  if (engineName() !== "draft") return output
  return [
    output.trim(),
    "",
    "## DM reply",
    `You asked: ${ask}`,
    "Shared memory and this DM thread are in my packet. If you need an external write, I include a Write plan; approve it from Permission cards.",
  ].join("\n")
}

function projectMarkdown(): string {
  return fs.readFileSync(path.join(root, "project", "AGENTS.md"), "utf8")
}

/**
 * Write tools for one role run. Each call records a pending permission on the live
 * room, blocks until the person answers, then makes the write and tells the model.
 */
function runtimeTools(input: {
  sessionId: string
  room: Room
  agent: AgentFile
  runId: string
  surface: "room" | "dm" | "group"
  onChange: () => void
}): RuntimeTools {
  const { sessionId, room, agent, runId, surface, onChange } = input
  return {
    read: (name, args) => readTool(sessionId, room, name, args),
    request: async (ask: ToolRequest) => {
      const permission: PermissionRequest = {
        id: crypto.randomUUID(),
        roleName: agent.name,
        roleTitle: agent.title,
        system: ask.system,
        action: ask.action,
        target: ask.target,
        payloadSummary: ask.payloadSummary,
        status: "pending",
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        error: null,
        surface,
        mode: "runtime",
        params: ask.params,
      }
      room.permissions = [...(room.permissions || []), permission]
      onChange()

      const decision = await gate.ask(runId, permission)
      permission.resolvedAt = new Date().toISOString()
      const record = (status: "executed" | "denied" | "failed", detail: string) =>
        indexPermissionResult({
          root,
          roomId: room.id,
          agentName: agent.name,
          system: permission.system,
          action: permission.action,
          target: permission.target,
          status,
          detail,
          surface,
        })

      if (!decision.approved) {
        permission.status = "denied"
        permission.error = decision.reason
        record("denied", decision.reason || "Denied by human")
        onChange()
        return `DENIED by the person${decision.reason ? `: ${decision.reason}` : ""}. Do not retry this write.`
      }

      try {
        await executePermission(sessionId, room, permission)
        permission.status = "executed"
        record("executed", permission.payloadSummary)
        onChange()
        const approval = decision.remember && decision.reason ? "allowed earlier in this run by the person" : "approved by the person"
        // Say who approved: the model cannot see the Allow click and otherwise claims it never asked.
        return `OK (${approval} at ${permission.resolvedAt?.slice(11, 16)} UTC; you, the ${agent.title}, made this write): ${permission.payloadSummary.split(" → ").pop()}`
      } catch (error) {
        permission.status = "failed"
        permission.error = error instanceof Error ? error.message : "Write failed"
        record("failed", permission.error)
        onChange()
        return `FAILED: ${permission.error}`
      }
    },
  }
}

/**
 * Read-only code for agents: each Setup repo found among the local clones in CODE_WORKSPACE is
 * exported (its Setup branch) into data/workdir/code and handed to the agent as a folder to read.
 */
async function codeSources(room: Room): Promise<SourceDoc[]> {
  const workspace = process.env.CODE_WORKSPACE?.trim()
  if (!workspace) return []
  const clones = await localRepos(workspace)
  return Promise.all(
    room.gitRepos.map(async (item): Promise<SourceDoc> => {
      const name = `${item.owner}/${item.repo}`
      const clone = findLocalRepo(clones, item.owner, item.repo)
      if (!clone) {
        return {
          kind: "github",
          title: `Code: ${name} (no local clone)`,
          url: item.url,
          body: `${name} is not among the local clones in CODE_WORKSPACE, so its code cannot be read. Tell the person.`,
        }
      }
      try {
        const snap = await snapshotRepo(root, clone, item.branch)
        return {
          kind: "github",
          title: `Code: ${name} @ ${snap.ref} (read-only)`,
          url: item.url,
          localPath: snap.dir,
          body: [
            `Read-only copy of ${name}, branch ${snap.ref}, commit ${snap.commit.slice(0, 10)} (${snap.committedAt}).`,
            `Folder: ${snap.dir}`,
            "Use your read, grep, glob and ls tools on this folder to see what is already implemented. Cite file paths.",
            "You cannot change these files. Code changes are proposed later, through pull requests.",
            snap.fetchError ? `Note: git fetch failed (${snap.fetchError}); this is the last fetched state.` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        }
      } catch (error) {
        return {
          kind: "github",
          title: `Code: ${name} (could not be read)`,
          url: item.url,
          body: `The app could not export ${name} @ ${item.branch}: ${error instanceof Error ? error.message : "error"}. Tell the person.`,
        }
      }
    }),
  )
}

const annotationsDir = path.join(root, "data", "workdir", "annotations")

/** design_annotate: red boxes on a copy of an exported screen, shown back to the model to check. */
function annotateTool(args: Record<string, string>): SDKCustomToolResult {
  const designs = process.env.DESIGNS_DIR?.trim()
  if (!designs) throw new Error("No Figma exports folder (DESIGNS_DIR) is set")
  const base = path.resolve(designs)
  const source = path.resolve(base, args.image)
  if (!source.startsWith(base + path.sep) || !fs.existsSync(source)) {
    throw new Error(`No image "${args.image}" in the Figma exports folder. Use a file name from the exports list.`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(args.boxes)
  } catch {
    throw new Error("boxes must be a list of {x, y, width, height, label} in percent")
  }
  const boxes = (Array.isArray(raw) ? raw : []).map((item) => {
    const box = item as Record<string, unknown>
    const num = (key: string) => Math.min(100, Math.max(0, Number(box[key])))
    return { x: num("x"), y: num("y"), width: num("width"), height: num("height"), label: String(box.label ?? "").slice(0, 200) }
  })
  if (!boxes.length || boxes.some((box) => [box.x, box.y, box.width, box.height].some(Number.isNaN) || !box.width || !box.height)) {
    throw new Error("Each box needs numeric x, y, width and height in percent (width and height above 0)")
  }
  const result = annotatePng(source, boxes, annotationsDir)
  const legend = result.boxes.map((box) => `${box.n}. ${box.label}`).join("\n")
  return {
    content: [
      {
        type: "text",
        text: [
          `Annotated copy of ${args.image}: file "${result.file}". Check the boxes in the image below; if one misses its target, call design_annotate again.`,
          "Put this line in your message so the person sees it:",
          `![${path.basename(args.image)} – issues](/api/annotations/${result.file})`,
          "",
          legend,
        ].join("\n"),
      },
      { type: "image", data: result.preview, mimeType: "image/png" },
    ],
  }
}

const DESIGN_IMAGE = /\.(png|jpe?g|webp|gif)$/i

/**
 * Screens exported from Figma by hand (no API limits). Agents open them with their read tool,
 * which shows the image to the model. Modified times are listed so re-exports reach resumed agents.
 */
function designsSource(dir: string): SourceDoc {
  if (!fs.existsSync(dir)) {
    return {
      kind: "figma",
      title: "Figma exports (folder not found)",
      url: dir,
      body: `DESIGNS_DIR points to ${dir}, which does not exist. Tell the person.`,
    }
  }
  const files: { rel: string; kb: number; at: string }[] = []
  const walk = (folder: string) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (DESIGN_IMAGE.test(entry.name) && files.length < 400) {
        const stat = fs.statSync(full)
        files.push({ rel: path.relative(dir, full), kb: Math.round(stat.size / 1024), at: stat.mtime.toISOString().slice(0, 16) })
      }
    }
  }
  walk(dir)
  files.sort((a, b) => a.rel.localeCompare(b.rel))
  return {
    kind: "figma",
    title: `Figma exports: ${files.length} screen images`,
    url: dir,
    localPath: dir,
    body: [
      `Folder: ${dir}`,
      "These are screens exported from Figma. File and folder names are the Figma frame and page names.",
      "Open an image with your read tool to see the screen before you comment on it. Cite the file name.",
      "",
      ...(files.length ? files.map((file) => `- ${file.rel} (${file.kb} KB, exported ${file.at})`) : ["(the folder has no images yet)"]),
    ].join("\n"),
  }
}

const FIGMA_SUMMARY_TTL_MS = 10 * 60 * 1000
const figmaSummaries = new Map<string, { at: number; summary: Awaited<ReturnType<typeof fetchFigmaFileSummary>> }>()

/**
 * The Figma page/frame outline changes rarely and Figma rate-limits its API, so reuse it for
 * 10 minutes, and fall back to the last good copy when Figma refuses (e.g. rate limit).
 */
async function cachedFigmaSummary(sessionId: string, fileUrl: string) {
  const cached = figmaSummaries.get(fileUrl)
  if (cached && Date.now() - cached.at < FIGMA_SUMMARY_TTL_MS) return cached.summary
  try {
    const summary = await fetchFigmaFileSummary(await figmaAccess(sessionId), fileUrl)
    figmaSummaries.set(fileUrl, { at: Date.now(), summary })
    return summary
  } catch (error) {
    if (!cached) throw error
    const minutes = Math.round((Date.now() - cached.at) / 60000)
    return {
      ...cached.summary,
      body: `${cached.summary.body}\n\n(Figma refused a fresh read: ${error instanceof Error ? error.message : "error"}. This outline is ${minutes} minutes old.)`,
    }
  }
}

async function atlassianAccess(sessionId: string) {
  const config = atlassianConfig(baseUrl)
  const saved = credentials.getAtlassian(sessionId)
  if (!config || !saved) throw new Error("Connect Atlassian in Settings")
  const fresh = await refreshed(config, saved)
  credentials.setAtlassian(sessionId, fresh)
  return fresh
}

/** The Jira Software board from Setup's board URL (…/boards/4887). */
function boardIdFor(room: Room): string {
  const boardId = room.jiraBoardUrl ? parseJiraBoardUrl(room.jiraBoardUrl)?.boardId : null
  if (!boardId) throw new Error("Set a Jira board URL (…/boards/<id>) in Setup, not just a project key")
  return boardId
}

/** Figma access for API calls: FIGMA_ACCESS_TOKEN when set, otherwise the person's OAuth login. */
async function figmaAccess(sessionId: string): Promise<FigmaAuth> {
  const token = tokenAuth()
  if (token) return token
  const config = figmaConfig(baseUrl)
  const saved = credentials.getFigma(sessionId)
  if (!config || !saved) {
    throw new Error("Connect Figma in Settings, or set FIGMA_ACCESS_TOKEN in .env")
  }
  const fresh = await refreshedFigma(config, saved)
  credentials.setFigma(sessionId, fresh)
  return oauthAuth(fresh)
}

/** Read-only tools for agents. Errors go back to the model as text so it can say what failed. */
async function readTool(
  sessionId: string,
  room: Room,
  name: ReadToolName,
  args: Record<string, string>,
): Promise<SDKCustomToolResult> {
  try {
    if (name === "design_annotate") return annotateTool(args)
    if (name === "jira_list_sprints") {
      const sprints = await listSprints(await atlassianAccess(sessionId), boardIdFor(room))
      return sprints.length
        ? sprints
            .map(
              (sprint) =>
                `- ${sprint.id}: ${sprint.name} (${sprint.state}${sprint.startDate ? `, ${sprint.startDate.slice(0, 10)} → ${sprint.endDate?.slice(0, 10) ?? "?"}` : ""})`,
            )
            .join("\n")
        : "No active or future sprints on this board."
    }
    if (name === "confluence_read_comments") {
      if (!room.confluencePageUrl) throw new Error("No Confluence BRS page is set in Setup")
      return await listConfluenceFooterComments(await atlassianAccess(sessionId), room.confluencePageUrl)
    }
    const fileUrl = args.file_url?.trim() || room.figmaFileUrl
    if (!fileUrl) throw new Error("No Figma file is set in Setup")
    const auth = await figmaAccess(sessionId)
    if (name === "figma_list_frames") return await listFigmaFrames(auth, fileUrl, args.page)
    if (name === "figma_read_frame") return await readFigmaFrame(auth, fileUrl, args.node_id)
    const image = await renderFigmaFrame(auth, fileUrl, args.node_id)
    return {
      content: [
        { type: "text", text: `Frame ${args.node_id}${image.scale < 1 ? ` (rendered at ${image.scale}x)` : ""}` },
        { type: "image", data: image.data, mimeType: image.mimeType },
      ],
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `FAILED: ${error instanceof Error ? error.message : "Figma read failed"}` }],
      isError: true,
    }
  }
}

async function executePermission(
  sessionId: string,
  room: Room,
  permission: PermissionRequest,
): Promise<void> {
  const action = permission.action.toLowerCase()

  if (permission.system === "jira") {
    const config = atlassianConfig(baseUrl)
    const saved = credentials.getAtlassian(sessionId)
    if (!config || !saved) {
      throw new Error("Connect Atlassian before approving Jira writes")
    }
    const fresh = await refreshed(config, saved)
    credentials.setAtlassian(sessionId, fresh)

    if (permission.mode === "runtime" && action === "attach image") {
      const issueKey = permission.params?.issue_key || issueKeyFromTarget(permission.target)
      const file = path.basename(permission.params?.image ?? "")
      const full = path.join(annotationsDir, file)
      if (!issueKey) throw new Error("Jira attach needs an issue key")
      if (!file || !fs.existsSync(full)) throw new Error(`No annotated image "${permission.params?.image}"; run design_annotate first`)
      const attachmentId = await attachJiraFile(fresh, issueKey, full)
      if (permission.params?.comment?.trim()) {
        await addJiraComment(fresh, issueKey, `${permission.params.comment.trim()}\n\n(See attachment ${file})`)
      }
      permission.payloadSummary = `${permission.payloadSummary} → attached ${file} to ${issueKey} (attachment ${attachmentId})`
      return
    }

    if (permission.mode === "runtime" && action === "move to sprint") {
      const keys = (permission.params?.issue_keys ?? "")
        .split(/[\s,]+/)
        .map((key) => key.trim().toUpperCase())
        .filter((key) => /^[A-Z][A-Z0-9]+-\d+$/.test(key))
      if (!keys.length) throw new Error("Give at least one issue key, e.g. SMETZ-114")
      const sprints = await listSprints(fresh, boardIdFor(room))
      const sprint = findSprint(sprints, permission.params?.sprint ?? permission.target)
      if (!sprint) {
        throw new Error(
          `No single active or future sprint matches "${permission.params?.sprint}". Sprints: ${sprints.map((item) => `${item.id}: ${item.name}`).join(", ") || "none"}`,
        )
      }
      await moveIssuesToSprint(fresh, sprint.id, keys)
      permission.payloadSummary = `${permission.payloadSummary} → moved ${keys.join(", ")} into ${sprint.name} (${sprint.id})`
      return
    }

    if (permission.mode === "runtime" && action === "update") {
      const issueKey = permission.params?.issue_key || issueKeyFromTarget(permission.target)
      if (!issueKey) throw new Error("Jira update needs an issue key")
      await updateJiraIssue(fresh, issueKey, {
        summary: permission.params?.summary,
        description: permission.params?.description,
      })
      permission.payloadSummary = `${permission.payloadSummary} → updated ${issueKey}`
      return
    }

    if (action.includes("comment") || action.includes("ac") || action.includes("attach")) {
      const issueKey = issueKeyFromTarget(permission.target) || issueKeyFromTarget(permission.payloadSummary)
      if (!issueKey) {
        throw new Error("Jira comment needs an issue key in Target (e.g. ORD-12)")
      }
      const commented = await addJiraComment(fresh, issueKey, permission.payloadSummary)
      permission.payloadSummary = `${permission.payloadSummary} → commented on ${issueKey} (${commented.id})`
      return
    }

    const projectKey = room.jiraProjectKey
    if (!projectKey) {
      throw new Error("Set a Jira project key in Setup before approving Jira writes")
    }
    const params = permission.params ?? {}
    const issueType =
      (params.issue_type as "Epic" | "Story" | "Subtask" | "Task" | "Bug" | undefined) ||
      inferJiraIssueType(permission.action, permission.payloadSummary)
    const summary = params.summary || summaryFromPayload(permission.payloadSummary, permission.action)
    const parentKey =
      params.parent_key ||
      (issueType === "Story" || issueType === "Subtask" || issueType === "Task"
        ? room.jiraEpicKey || undefined
        : undefined)
    const created = await createJiraIssue(fresh, {
      projectKey,
      summary,
      issueType,
      parentKey,
      description: `${params.description || permission.payloadSummary}\n\nRequested by ${permission.roleTitle} in room ${room.id}.`,
    })
    if (issueType === "Epic") room.jiraEpicKey = created.key
    permission.payloadSummary = `${permission.payloadSummary} → created ${created.key}${parentKey ? ` under ${parentKey}` : ""}`
    return
  }

  if (permission.system === "confluence") {
    if (!room.confluencePageUrl) {
      throw new Error("Set a Confluence BRS URL in Setup before approving Confluence comments")
    }
    const config = atlassianConfig(baseUrl)
    const saved = credentials.getAtlassian(sessionId)
    if (!config || !saved) {
      throw new Error("Connect Atlassian before approving Confluence writes")
    }
    const fresh = await refreshed(config, saved)
    credentials.setAtlassian(sessionId, fresh)
    const commented = await addConfluenceFooterComment(
      fresh,
      room.confluencePageUrl,
      `${permission.payloadSummary}\n\n— ${permission.roleTitle} / room ${room.id}`,
    )
    permission.payloadSummary = `${permission.payloadSummary} → Confluence comment ${commented.id}`
    return
  }

  if (permission.system === "figma") {
    if (!room.figmaFileUrl) {
      throw new Error("Set a Figma file URL in Setup before approving Figma comments")
    }
    const commented = await addFigmaComment(
      await figmaAccess(sessionId),
      room.figmaFileUrl,
      `${permission.payloadSummary}\n\n— ${permission.roleTitle} / room ${room.id}`,
    )
    permission.payloadSummary = `${permission.payloadSummary} → Figma comment ${commented.id}`
    return
  }

  if (permission.system === "github") {
    const saved = credentials.getGitHub(sessionId)
    if (!saved) {
      throw new Error("Connect GitHub before approving repo writes")
    }
    if (!room.gitRepos?.length) {
      throw new Error("Add at least one GitHub repo in Setup before approving PRs")
    }
    const parsedTarget = parseRepoUrl(permission.target)
    const repo =
      room.gitRepos.find(
        (item) =>
          parsedTarget &&
          item.owner.toLowerCase() === parsedTarget.owner.toLowerCase() &&
          item.repo.toLowerCase() === parsedTarget.repo.toLowerCase(),
      ) ||
      room.gitRepos.find((item) =>
        permission.target.toLowerCase().includes(`${item.owner}/${item.repo}`.toLowerCase()),
      ) ||
      room.gitRepos[0]
    const headBranch = `agent-room/${room.id}`.slice(0, 100)
    const title = permission.params?.title || summaryFromPayload(permission.payloadSummary, permission.action)
    const files = buildPrFiles({
      room,
      repo,
      headBranch,
      payloadSummary: permission.payloadSummary,
      title,
    })
    const localPath = writeLocalMirror(root, repo, files)
    const jiraKeys = extractJiraKeys(
      `${permission.payloadSummary}\n${permission.target}\n${room.messages
        .filter((m) => m.kind === "agent")
        .map((m) => m.body)
        .join("\n")}`,
    )
    const body = [
      permission.payloadSummary,
      "",
      "Opened by Agent Room after human approval.",
      `Room: ${room.id}`,
      `Role: ${permission.roleTitle}`,
      `Repo: ${repo.owner}/${repo.repo} (base ${repo.branch || "main"})`,
      `Local mirror: ${localPath}`,
      "",
      "Files in this PR:",
      ...files.map((file) => `- \`${file.path}\` — ${file.note}`),
      "",
      jiraKeys.length ? `Jira: ${jiraKeys.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n")

    const pr = await openPullRequestFromBase({
      accessToken: saved.accessToken,
      owner: repo.owner,
      repo: repo.repo,
      baseBranch: repo.branch || "main",
      headBranch,
      title,
      body,
      files: files.map((file) => ({ path: file.path, content: file.content })),
    })

    // Comment PR URL onto related Jira issues when Atlassian is connected.
    const jiraLinked: string[] = []
    const atlassian = atlassianConfig(baseUrl)
    const atlassianCred = credentials.getAtlassian(sessionId)
    if (atlassian && atlassianCred && jiraKeys.length) {
      try {
        const fresh = await refreshed(atlassian, atlassianCred)
        credentials.setAtlassian(sessionId, fresh)
        for (const key of jiraKeys.slice(0, 8)) {
          try {
            await addJiraComment(
              fresh,
              key,
              `Agent Room opened PR #${pr.number}: ${pr.htmlUrl}\nFiles: ${pr.filesCommitted.join(", ")}`,
            )
            jiraLinked.push(key)
          } catch {
            /* issue may not exist yet */
          }
        }
      } catch {
        /* Jira comment is best-effort after PR */
      }
    }

    permission.payloadSummary = `${permission.payloadSummary} → PR #${pr.number} ${pr.htmlUrl} (${pr.filesCommitted.length} files)${
      jiraLinked.length ? `; Jira commented ${jiraLinked.join(", ")}` : ""
    }`
    return
  }

  if (permission.system === "jenkins") {
    const jobName =
      room.jenkinsJob?.trim() ||
      permission.target.trim() ||
      process.env.JENKINS_DEFAULT_JOB?.trim() ||
      ""
    if (!jobName) {
      throw new Error("Set a Jenkins job in Setup (or Write plan Target) before approving Deploy")
    }
    const env =
      paramFromPayload(permission.payloadSummary, "env") ||
      room.deployEnv ||
      "Dev"
    const deployUrl =
      paramFromPayload(permission.payloadSummary, "deploy_url") ||
      paramFromPayload(permission.payloadSummary, "deploy-url") ||
      room.deployUrl ||
      ""
    const smokeUrl = `${baseUrl}/api/jenkins/smoke`
    const triggered = await triggerJenkinsJob({
      jobName,
      parameters: {
        ROOM_ID: room.id,
        ENV: env,
        DEPLOY_URL: deployUrl,
        SMOKE_URL: smokeUrl,
        SMOKE_TOKEN: smokeToken() || "",
        BUILD_REF: paramFromPayload(permission.payloadSummary, "build_ref") || "",
      },
    })
    room.jenkinsJob = jobName
    room.deployEnv = env
    if (deployUrl) room.deployUrl = deployUrl
    permission.payloadSummary = `${permission.payloadSummary} → triggered ${jobName} (${triggered.jobUrl})${triggered.queueUrl ? `; queue ${triggered.queueUrl}` : ""}`
    return
  }

  throw new Error(`No executor wired for ${permission.system} yet`)
}

function paramFromPayload(summary: string, key: string): string | null {
  const re = new RegExp(`(?:^|[;,]\\s*|\\s)${key}\\s*[=:]\\s*([^;|,\\n]+)`, "i")
  const match = summary.match(re)
  return match?.[1]?.trim() || null
}
