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
  pageIdFromUrl,
  refreshed,
} from "./atlassian.js"
import {
  addFigmaComment,
  authorizeUrl as figmaAuthorizeUrl,
  exchangeCode as figmaExchangeCode,
  fetchFigmaFileSummary,
  figmaConfig,
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
import { engineName, selectRunner } from "./runner.js"
import { ensureSession } from "./session.js"
import { readRoom, writeRoom } from "./store.js"
import { slugifyRequirement, parseWritePlans } from "./permissions.js"
import {
  addMemory,
  formatMemoryForPacket,
  indexPermissionResult,
  isMemoryKind,
  memoryEntriesForRoom,
  readMemory,
} from "./memory.js"
import { listDmAgents, readDm, writeDm } from "./dm.js"
import { buildPrFiles, extractJiraKeys, writeLocalMirror } from "./workdir.js"
import type { PermissionRequest, Room, SourceDoc } from "./types.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
loadEnv(root)
setMemoryRoot(root)
const port = Number(process.env.PORT ?? 4173)
const baseUrl = (process.env.APP_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, "")
const workdir = path.join(root, "data", "workdir")
const secrets = loadSecrets(root)
const credentials = new CredentialStore(root, secrets.credentialsKey)
let busy = false

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

app.post("/api/room/permissions/:id/approve", async (req, res) => {
  const sessionId = ensureSession(req, res, secrets.sessionSecret)
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
  try {
    const thread = readDm(root, room.id, agentName)
    thread.messages.push({
      id: crypto.randomUUID(),
      kind: "human",
      title: "You",
      body,
      at: new Date().toISOString(),
    })

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
    const result = await runner(packet, () => undefined)
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
    res.status(502).json({ error: message })
  } finally {
    busy = false
  }
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
  }
  try {
    const room = await work(hooks)
    writeRoom(root, room)
    emit({ type: "room", room: present(room) })
  } catch (error) {
    const message = error instanceof Error ? error.message : "The run failed"
    emit({ type: "error", message })
  } finally {
    busy = false
    res.end()
  }
}

async function loadSourcesForRole(sessionId: string, room: Room, roleName: string): Promise<SourceDoc[]> {
  const sources: SourceDoc[] = []
  const needsBrd = roleName === "sa" || roleName === "software-lead"
  const needsFigma = roleName === "sa" || roleName === "software-lead"
  const needsGit =
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

  if (needsBrd && room.confluencePageUrl) {
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
    sources.push(await fetchConfluencePage(fresh, room.confluencePageUrl))
  }

  if (needsFigma && room.figmaFileUrl) {
    const config = figmaConfig(baseUrl)
    if (!config) {
      throw new Error("Figma OAuth is not configured on the server")
    }
    const saved = credentials.getFigma(sessionId)
    if (!saved) {
      throw new Error("Connect Figma before this role can read the sprint Figma file")
    }
    const fresh = await refreshedFigma(config, saved)
    credentials.setFigma(sessionId, fresh)
    const summary = await fetchFigmaFileSummary(fresh, room.figmaFileUrl)
    sources.push({
      kind: "figma",
      title: summary.title,
      url: summary.url,
      body: summary.body,
    })
  }

  if (needsGit && room.gitRepos?.length) {
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
    const issueType = inferJiraIssueType(permission.action, permission.payloadSummary)
    const summary = summaryFromPayload(permission.payloadSummary, permission.action)
    const parentKey =
      issueType === "Story" || issueType === "Subtask" || issueType === "Task"
        ? room.jiraEpicKey || undefined
        : undefined
    const created = await createJiraIssue(fresh, {
      projectKey,
      summary,
      issueType,
      parentKey,
      description: `${permission.payloadSummary}\n\nRequested by ${permission.roleTitle} in room ${room.id}.`,
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
    const config = figmaConfig(baseUrl)
    const saved = credentials.getFigma(sessionId)
    if (!config || !saved) {
      throw new Error("Connect Figma before approving Figma writes")
    }
    const fresh = await refreshedFigma(config, saved)
    credentials.setFigma(sessionId, fresh)
    const commented = await addFigmaComment(
      fresh,
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
    const title = summaryFromPayload(permission.payloadSummary, permission.action)
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
