const $ = (selector) => document.querySelector(selector)

// Layout
const sidebar = $("#sidebar")
const sidebarScrim = $("#sidebar-scrim")
const menuButton = $("#menu")
const sprintName = $("#sprint-name")
const viewTitle = $("#view-title")
const viewSub = $("#view-sub")
const engine = $("#engine")
const kickoffDot = $("#kickoff-dot")
const buildDot = $("#build-dot")
const views = {
  wizard: $("#view-wizard"),
  kickoff: $("#view-kickoff"),
  build: $("#view-build"),
  dm: $("#view-dm"),
  settings: $("#view-settings"),
}

// Wizard
const wizardBody = $("#wizard-body")
const wizardError = $("#wizard-error")
const wizardBack = $("#wizard-back")
const wizardSkip = $("#wizard-skip")
const wizardNext = $("#wizard-next")
const setupConnect = $("#setup-connect")
const setupSources = $("#setup-sources")
const setupDeploy = $("#setup-deploy")
const setupRequirement = $("#setup-requirement")
const settingsSources = $("#settings-sources")

// Kickoff (group chat)
const groupThread = $("#group-thread")
const groupStatus = $("#group-status")
const groupForm = $("#group-form")
const groupInput = $("#group-input")
const groupSend = $("#group-send")
const groupPause = $("#group-pause")
const groupHandoff = $("#group-handoff")
const groupReset = $("#group-reset")

// Build (pipeline)
const chips = $("#chips")
const transcript = $("#transcript")
const permissionsPanel = $("#permissions")
const permissionList = $("#permission-list")
const composer = $("#composer")

// Runtime asks
const liveAsks = $("#live-asks")
const liveAskList = $("#live-ask-list")

// DMs
const agentList = $("#agent-list")
const dmThread = $("#dm-thread")
const dmForm = $("#dm-form")
const dmInput = $("#dm-input")

// Sources
const atlassianStatus = $("#atlassian-status")
const connectAtlassian = $("#connect-atlassian")
const disconnectAtlassian = $("#disconnect-atlassian")
const figmaStatus = $("#figma-status")
const connectFigma = $("#connect-figma")
const disconnectFigma = $("#disconnect-figma")
const githubStatus = $("#github-status")
const connectGitHub = $("#connect-github")
const disconnectGitHub = $("#disconnect-github")
const figmaForm = $("#figma-form")
const figmaUrl = $("#figma-url")
const figmaPreview = $("#figma-preview")
const gitForm = $("#git-form")
const gitRepoUrl = $("#git-repo-url")
const gitBranch = $("#git-branch")
const gitPreview = $("#git-preview")
const gitRepoList = $("#git-repo-list")
const jiraForm = $("#jira-form")
const jiraBoardUrl = $("#jira-board-url")
const jiraPreview = $("#jira-preview")
const deployForm = $("#deploy-form")
const deployEnv = $("#deploy-env")
const deployUrl = $("#deploy-url")
const jenkinsJob = $("#jenkins-job")
const deployPreview = $("#deploy-preview")
const sourceForm = $("#source-form")
const confluenceUrl = $("#confluence-url")
const pastedBrd = $("#pasted-brd")
const sourcePreview = $("#source-preview")
const requirementForm = $("#requirement-form")
const requirementText = $("#requirement-text")
const requirementPreview = $("#requirement-preview")

// Settings
const memoryList = $("#memory-list")
const memoryForm = $("#memory-form")
const memoryTitle = $("#memory-title")
const memoryBody = $("#memory-body")
const memoryPreview = $("#memory-preview")
const accountStatus = $("#account-status")
const accountSignedIn = $("#account-signed-in")
const accountUser = $("#account-user")
const accountPreview = $("#account-preview")
const loginForm = $("#login-form")
const registerForm = $("#register-form")
const logoutBtn = $("#logout")
const catalogList = $("#catalog-list")
const catalogEdit = $("#catalog-edit")
const catalogEditTitle = $("#catalog-edit-title")
const catalogTitle = $("#catalog-title")
const catalogTools = $("#catalog-tools")
const catalogNeedsApproval = $("#catalog-needs-approval")
const catalogInstructions = $("#catalog-instructions")
const catalogDraft = $("#catalog-draft")
const catalogPreview = $("#catalog-preview")
const teamsList = $("#teams-list")
const teamCreate = $("#team-create")
const teamName = $("#team-name")
const teamAgents = $("#team-agents")
const teamsPreview = $("#teams-preview")

let currentView = null
let wizardStep = 1
let lastRoom = null
let lastGroup = null
let kickoffMembers = ["sa", "software-lead", "qa-design"]
let activeDmAgent = null
let editingCatalogName = null
let streaming = false
let polling = false
let dmInFlight = false
let groupStreaming = false
let askPolling = false
let liveAskIds = ""
let session = null

// ---------- Views ----------

function showView(name, options = {}) {
  currentView = name
  for (const [key, section] of Object.entries(views)) section.hidden = key !== name
  for (const item of sidebar.querySelectorAll("[data-view]")) {
    item.classList.toggle("active", item.getAttribute("data-view") === name)
  }
  for (const button of agentList.querySelectorAll("[data-agent]")) {
    button.classList.toggle("active", name === "dm" && button.getAttribute("data-agent") === activeDmAgent)
  }
  // The permission panel follows whichever chat is open.
  const slot = views[name].querySelector(".ask-slot")
  if (slot) slot.appendChild(liveAsks)
  setSidebarOpen(false)
  if (name !== "wizard") remember("view", name === "dm" ? `dm:${activeDmAgent}` : name)

  if (name === "wizard") {
    wizardStep = options.step || 1
    renderWizard()
  }
  if (name === "kickoff") loadGroup()
  if (name === "build") {
    if (lastRoom) render(lastRoom)
    transcript.scrollTop = transcript.scrollHeight
  }
  if (name === "settings") {
    mount(settingsSources, [setupConnect, setupSources, setupDeploy])
    showTab(options.tab || recall("tab") || "sources")
  }
  renderViewHead()
}

function renderViewHead() {
  if (currentView === "wizard") {
    viewTitle.textContent = "Set up the sprint"
    viewSub.textContent = `Step ${wizardStep} of 3`
  } else if (currentView === "kickoff") {
    viewTitle.textContent = "Kickoff"
    viewSub.textContent = lastGroup?.members?.length
      ? `${lastGroup.members.map((member) => member.title).join(", ")} discuss the sprint`
      : "SA, Lead and QA discuss the sprint"
  } else if (currentView === "build") {
    viewTitle.textContent = "Build & ship"
    viewSub.textContent = buildStages(lastRoom).map((stage) => stage.title).join(" → ")
  } else if (currentView === "dm") {
    const button = agentList.querySelector(`[data-agent="${cssEscape(activeDmAgent || "")}"]`)
    viewTitle.textContent = button?.textContent || "Direct message"
    viewSub.textContent = "Just you and this agent"
  } else if (currentView === "settings") {
    viewTitle.textContent = "Settings"
    viewSub.textContent = ""
  }
}

function setSidebarOpen(open) {
  sidebar.classList.toggle("open", open)
  sidebarScrim.hidden = !open
}

function mount(container, blocks) {
  for (const block of blocks) container.appendChild(block)
}

function showTab(name) {
  remember("tab", name)
  for (const tab of views.settings.querySelectorAll("[data-tab]")) {
    tab.classList.toggle("active", tab.getAttribute("data-tab") === name)
  }
  for (const panel of views.settings.querySelectorAll("[data-panel]")) {
    panel.hidden = panel.getAttribute("data-panel") !== name
  }
  if (name === "memory") loadMemory()
  if (name === "team") {
    loadTeams()
    loadCatalog()
  }
}

function remember(key, value) {
  try {
    localStorage.setItem(`agent-room:${key}`, value)
  } catch {
    /* storage can be blocked */
  }
}

function recall(key) {
  try {
    return localStorage.getItem(`agent-room:${key}`)
  } catch {
    return null
  }
}

sidebar.addEventListener("click", (event) => {
  const item = event.target.closest("[data-view]")
  if (item) showView(item.getAttribute("data-view"))
})
menuButton.addEventListener("click", () => setSidebarOpen(!sidebar.classList.contains("open")))
sidebarScrim.addEventListener("click", () => setSidebarOpen(false))
views.settings.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-tab]")
  if (tab) showTab(tab.getAttribute("data-tab"))
})
for (const status of [atlassianStatus, figmaStatus, githubStatus]) {
  status.addEventListener("click", () => showView("settings", { tab: "sources" }))
}
accountStatus.addEventListener("click", () => showView("settings", { tab: "account" }))
$("#edit-setup").addEventListener("click", () => showView("wizard", { step: 2 }))
$("#new-sprint").addEventListener("click", async () => {
  if (busyAnywhere()) {
    window.alert("Wait until the agents finish talking.")
    return
  }
  if (!window.confirm("Start a new sprint? Sources are kept; the discussion and build steps start fresh.")) return
  const room = await fetchJson("/api/room/reset", { hard: false })
  if (room.error) {
    window.alert(room.error)
    return
  }
  await fetchJson("/api/group/reset", {})
  render(room)
  requirementText.value = ""
  showView("wizard", { step: 1 })
})
// ---------- Environments and rooms ----------

const envSelect = $("#env-select")
const roomList = $("#room-list")
let envState = null
let browsedEnvId = null

const ROOM_STATE = { new: "New", running: "Working", waiting: "Needs your OK", error: "Problem", done: "Done" }

async function loadEnvironments() {
  const payload = await fetch("/api/environments").then((response) => response.json()).catch(() => null)
  if (!payload || payload.error) return
  envState = payload
  if (!browsedEnvId || !payload.environments.some((env) => env.id === browsedEnvId)) browsedEnvId = payload.activeEnvironmentId
  renderEnvironments()
}

function renderEnvironments() {
  if (!envState) return
  envSelect.innerHTML = envState.environments
    .map((env) => `<option value="${escape(env.id)}">${escape(env.name)} (${env.roomCount})</option>`)
    .join("")
  envSelect.value = browsedEnvId
  const rooms = envState.rooms.filter((item) => item.environmentId === browsedEnvId)
  roomList.innerHTML = rooms.length
    ? rooms
        .map(
          (item) =>
            `<li><button type="button" class="side-item${item.slot === envState.activeSlot ? " current" : ""}" data-slot="${escape(item.slot)}" title="${escape(item.requirement || "")}"><span class="side-text">${escape(shorten(item.requirement || "New sprint", 34))}</span><span class="faint">${escape(ROOM_STATE[item.state] || "")}</span></button></li>`,
        )
        .join("")
    : `<li class="faint" style="padding:4px 10px;font-size:12px">No rooms yet</li>`
}

/** Reloads everything the screen shows for the room that is now open. */
async function reloadAfterSwitch(room) {
  const group = await fetch("/api/group").then((response) => response.json())
  render(room || (await fetch("/api/room").then((response) => response.json())))
  if (!group.error) renderGroup(group)
  await Promise.all([loadEnvironments(), loadCatalog(), loadTeams(), loadAgentCatalog()])
  const started = Boolean(lastRoom.confluencePageUrl || lastRoom.pastedBrd || group.thread?.messages?.length)
  if (started) showView("kickoff")
  else showView("wizard", { step: 1 })
}

function guardSwitch() {
  if (!busyAnywhere()) return true
  window.alert("Wait until the agents finish talking.")
  return false
}

envSelect.addEventListener("change", () => {
  browsedEnvId = envSelect.value
  renderEnvironments()
})

roomList.addEventListener("click", async (event) => {
  const item = event.target.closest("[data-slot]")
  if (!item || !guardSwitch()) return
  const result = await fetchJson(`/api/rooms/${encodeURIComponent(item.getAttribute("data-slot"))}/open`, {})
  if (result.error) return window.alert(result.error)
  setSidebarOpen(false)
  await reloadAfterSwitch(result)
})

$("#new-room").addEventListener("click", async () => {
  if (!guardSwitch()) return
  const result = await fetchJson(`/api/environments/${encodeURIComponent(browsedEnvId)}/rooms`, {})
  if (result.error) return window.alert(result.error)
  setSidebarOpen(false)
  await reloadAfterSwitch()
})

$("#new-env").addEventListener("click", async () => {
  if (!guardSwitch()) return
  const name = window.prompt("Name for the new environment (a client or program):")
  if (!name || !name.trim()) return
  const result = await fetchJson("/api/environments", { name })
  if (result.error) return window.alert(result.error)
  browsedEnvId = result.activeEnvironmentId
  setSidebarOpen(false)
  await reloadAfterSwitch()
})

$("#env-repos").addEventListener("click", async () => {
  const result = await fetchJson(`/api/environments/${encodeURIComponent(browsedEnvId)}/repos-from-room`, {})
  if (result.error) return window.alert(result.error)
  envState = result
  window.alert("Saved. New rooms in this environment start with these repos.")
})

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setSidebarOpen(false)
})

// ---------- Wizard ----------

function renderWizard() {
  const blocks = { 1: [setupConnect], 2: [setupSources], 3: [setupRequirement] }
  wizardBody.replaceChildren(...blocks[wizardStep])
  views.wizard.classList.add("wizard")
  for (const tab of views.wizard.querySelectorAll("[data-step-tab]")) {
    const step = Number(tab.getAttribute("data-step-tab"))
    tab.classList.toggle("active", step === wizardStep)
    tab.classList.toggle("done", step < wizardStep)
  }
  wizardError.textContent = ""
  wizardBack.hidden = wizardStep === 1
  wizardSkip.hidden = wizardStep === 3
  wizardNext.textContent = wizardStep === 3 ? "Start kickoff" : "Continue"
  if (wizardStep === 3) requirementText.focus()
  renderViewHead()
}

wizardBack.addEventListener("click", () => {
  wizardStep = Math.max(1, wizardStep - 1)
  renderWizard()
})
wizardSkip.addEventListener("click", () => {
  wizardStep = Math.min(3, wizardStep + 1)
  renderWizard()
})
wizardNext.addEventListener("click", async () => {
  wizardNext.disabled = true
  wizardError.textContent = ""
  try {
    if (wizardStep === 2) {
      const ok = await saveChangedSources()
      if (!ok) return
    }
    if (wizardStep === 3) {
      await startKickoff()
      return
    }
    wizardStep += 1
    renderWizard()
  } finally {
    wizardNext.disabled = false
  }
})

/** Step 2 has one Continue button: save only the fields that changed. */
async function saveChangedSources() {
  const room = lastRoom || {}
  const jobs = []
  if (jiraBoardUrl.value.trim() !== (room.jiraBoardUrl || room.jiraProjectKey || "")) jobs.push(saveJira)
  if (figmaUrl.value.trim() !== (room.figmaFileUrl || "")) jobs.push(saveFigma)
  if (
    !confluenceUrl.disabled &&
    (confluenceUrl.value.trim() !== (room.confluencePageUrl || "") || pastedBrd.value.trim() !== (room.pastedBrd || ""))
  ) {
    jobs.push(saveBrs)
  }
  for (const job of jobs) {
    if (!(await job())) {
      wizardError.textContent = "Fix the highlighted field, or Skip."
      return false
    }
  }
  return true
}

async function startKickoff() {
  const requirement = requirementText.value.trim()
  if (!requirement) {
    requirementPreview.classList.add("error")
    requirementPreview.textContent = "Describe what the team should work on."
    return
  }
  const started = lastRoom?.stages?.some((stage) => stage.status !== "pending")
  const payload = started
    ? await fetchJson("/api/room/reset", { hard: false, requirement })
    : await fetchJson("/api/room/requirement", { requirement })
  if (payload.error) {
    requirementPreview.classList.add("error")
    requirementPreview.textContent = payload.error
    return
  }
  requirementPreview.classList.remove("error")
  requirementPreview.textContent = ""
  render(payload)
  showView("kickoff")
  await runGroupRequest("")
}

// ---------- Kickoff (group chat) ----------

groupForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  const body = groupInput.value.trim()
  if (groupStreaming) {
    // Mid-run: the message joins the live discussion before the next turn.
    if (!body) return
    const payload = await fetchJson("/api/group/message", { body })
    if (payload.error) {
      window.alert(payload.error)
      return
    }
    groupInput.value = ""
    renderGroup(payload)
    return
  }
  groupInput.value = ""
  await runGroupRequest(body)
})
submitOnEnter(groupInput, groupForm)
groupPause.addEventListener("click", async () => {
  groupPause.disabled = true
  groupStatus.textContent = "Pausing after the current turn…"
  await fetch("/api/group/pause", { method: "POST" })
})
groupReset.addEventListener("click", async () => {
  if (!window.confirm("Clear this discussion and start it again?")) return
  const payload = await fetchJson("/api/group/reset", {})
  if (payload.error) {
    window.alert(payload.error)
    return
  }
  renderGroup(payload)
})
groupHandoff.addEventListener("click", async () => {
  showView("build")
  await post("/api/group/handoff")
  await loadGroup()
})

async function loadGroup() {
  const payload = await fetch("/api/group").then((response) => response.json())
  if (payload.error) {
    groupStatus.textContent = payload.error
    return
  }
  renderGroup(payload)
}

async function runGroupRequest(body) {
  groupStreaming = true
  renderGroupControls(true, Boolean(lastGroup?.thread?.messages?.length))
  setDot(kickoffDot, "talking")
  pollLiveAsks()
  const response = await fetch("/api/group/message", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  })
  const type = response.headers.get("content-type") || ""
  if (type.includes("application/json")) {
    const payload = await response.json()
    groupStreaming = false
    if (!response.ok) window.alert(payload.error || "Group chat failed")
    await loadGroup()
    return
  }
  await readStream(response, (event) => {
    if (event.type === "group") renderGroup(event)
    if (event.type === "delta") appendLive(groupThread, event)
  })
  groupStreaming = false
  await loadGroup()
}

function renderGroup(payload) {
  lastGroup = payload
  if (payload.members?.length) kickoffMembers = payload.members.map((member) => member.name)
  const thread = payload.thread
  const messages = thread?.messages || []
  groupThread.innerHTML = messages.length
    ? messages.map((message) => renderBubble(message)).join("")
    : emptyState(
        "Kickoff discussion",
        "System Analyst, Software Lead and QA Design read the BRS, Figma and code, then talk it through. Start the discussion, or write a first message to steer it.",
      )
  groupThread.scrollTop = groupThread.scrollHeight
  const running = groupStreaming || payload.running
  groupStatus.textContent = running ? "The team is talking…" : thread?.waitingReason || ""
  renderGroupControls(running, messages.length > 0)
  setDot(kickoffDot, running ? "talking" : groupDotState(thread))
  if (currentView === "kickoff") renderViewHead()
}

function groupDotState(thread) {
  if (!thread?.messages?.length) return ""
  if (kickoffHandedOff(lastRoom)) return "done"
  if (thread.status === "error") return "error"
  return "waiting"
}

function renderGroupControls(running, started) {
  groupSend.textContent = running ? "Send" : started ? "Send" : "Start discussion"
  groupInput.placeholder = running
    ? "Jump in. Your message is read before the next turn."
    : started
      ? "Reply, ask @sa, @lead or @qa, or press Send to let them continue."
      : "Optional: give the team a first instruction."
  groupPause.hidden = !running
  groupPause.disabled = false
  groupHandoff.hidden = running || !started || kickoffHandedOff(lastRoom)
  groupReset.disabled = running
}

// ---------- Build (pipeline) ----------

/** Pipeline stages after the kickoff members. */
function buildStages(room) {
  return (room?.stages || []).filter((stage) => !kickoffMembers.includes(stage.name))
}

function kickoffHandedOff(room) {
  const kickoff = (room?.stages || []).filter((stage) => kickoffMembers.includes(stage.name))
  return kickoff.length > 0 && kickoff.every((stage) => stage.status === "done")
}

async function post(url, body) {
  streaming = true
  setDot(buildDot, "talking")
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  })
  const type = response.headers.get("content-type") || ""
  if (type.includes("application/json")) {
    const payload = await response.json()
    streaming = false
    if (!response.ok) {
      window.alert(payload.error || "Request failed")
      if (lastRoom) render(lastRoom)
      return
    }
    render(payload)
    return
  }
  pollLiveAsks()
  await readStream(response, (event) => {
    if (event.type === "delta") appendLive(transcript, event)
    if (event.type === "room") render(event.room)
  })
  streaming = false
  render(await fetch("/api/room").then((response) => response.json()))
}

function render(room) {
  lastRoom = room
  engine.textContent = room.engine === "draft" ? "Draft mode" : room.engine === "cursor-cloud" ? "Live · Cursor cloud" : "Live · Cursor"
  engine.classList.toggle("draft", room.engine === "draft")
  engine.title =
    room.engine === "draft"
      ? "No CURSOR_API_KEY: agents reply with offline sample text. Add the key to .env for real discussions."
      : "Agents run on Cursor."
  sprintName.textContent = shorten(room.requirement || "New sprint", 70)
  sprintName.title = room.requirement || ""

  if (document.activeElement !== confluenceUrl) confluenceUrl.value = room.confluencePageUrl || ""
  if (document.activeElement !== pastedBrd) pastedBrd.value = room.pastedBrd || ""
  if (document.activeElement !== figmaUrl) figmaUrl.value = room.figmaFileUrl || ""
  if (document.activeElement !== jiraBoardUrl) jiraBoardUrl.value = room.jiraBoardUrl || room.jiraProjectKey || ""
  deployEnv.value = room.deployEnv || ""
  deployUrl.value = room.deployUrl || ""
  jenkinsJob.value = room.jenkinsJob || ""
  if (!requirementText.value) requirementText.value = room.requirement || ""

  // The BRS is fixed once Build starts; start a new sprint to change it.
  const started = room.stages.some((stage) => stage.status !== "pending")
  confluenceUrl.disabled = started || streaming
  pastedBrd.disabled = started || streaming
  sourceForm.querySelector("button").disabled = started || streaming
  if (started && !sourcePreview.textContent) sourcePreview.textContent = "Locked while this sprint is in Build. Use New sprint to change it."
  for (const field of [figmaUrl, gitRepoUrl, gitBranch, jiraBoardUrl, deployEnv, deployUrl, jenkinsJob]) {
    field.disabled = streaming
  }
  for (const form of [figmaForm, gitForm, jiraForm, deployForm]) form.querySelector("button").disabled = streaming
  renderGitRepos(room.gitRepos || [], streaming)
  renderPermissions(room.permissions || [])
  renderDeployPreview(room)

  const handedOff = kickoffHandedOff(room)
  const stages = buildStages(room)
  chips.innerHTML = [
    `<div class="chip ${handedOff ? "done" : "pending"}"><span class="title">Kickoff</span><span class="state">${handedOff ? "Done" : "In progress"}</span></div>`,
    ...stages.map(
      (stage) =>
        `<div class="chip ${stage.status}"><span class="title">${escape(stage.title)}</span><span class="state">${label(stage.status)}</span></div>`,
    ),
  ].join("")

  const kickoffTitles = new Set(room.stages.filter((stage) => kickoffMembers.includes(stage.name)).map((stage) => stage.title))
  const buildMessages = room.messages.filter((message) => !(message.kind === "agent" && kickoffTitles.has(message.title)))
  transcript.innerHTML = handedOff
    ? buildMessages.map(renderMessage).join("")
    : emptyState("Build starts after the kickoff", "When SA, Lead and QA agree, press Finish kickoff → Build. Architecture takes over from there.")
  transcript.scrollTop = transcript.scrollHeight

  setDot(buildDot, buildDotState(stages))
  renderComposer(handedOff, stages)
  if (currentView === "build") renderViewHead()
  watch(room)
}

function buildDotState(stages) {
  if (streaming || stages.some((stage) => stage.status === "running")) return "talking"
  if (stages.some((stage) => stage.status === "error")) return "error"
  if (stages.some((stage) => stage.status === "waiting_approval")) return "waiting"
  if (stages.length && stages.every((stage) => stage.status === "done")) return "done"
  return ""
}

function renderComposer(handedOff, stages) {
  const waiting = stages.find((stage) => stage.status === "waiting_approval")
  const failed = stages.find((stage) => stage.status === "error")
  const writing = stages.find((stage) => stage.status === "running")
  const finished = stages.every((stage) => stage.status === "done")

  if (!handedOff) {
    composer.innerHTML = `<p>Finish the kickoff discussion first.</p><button type="submit">Go to Kickoff</button>`
    composer.onsubmit = (event) => {
      event.preventDefault()
      showView("kickoff")
    }
    return
  }
  if (streaming || writing) {
    composer.innerHTML = `<p>${escape((writing || {}).title || "An agent")} is working…</p>`
    composer.onsubmit = (event) => event.preventDefault()
    return
  }
  if (failed) {
    composer.innerHTML = `<p>${escape(failed.title)} hit a problem.</p><button type="submit">Try again</button>`
    composer.onsubmit = (event) => {
      event.preventDefault()
      post("/api/room/retry")
    }
    return
  }
  if (waiting) {
    composer.innerHTML = `<input id="note" placeholder="Optional note for the next agent" /><button type="submit">Looks good — continue</button>`
    composer.onsubmit = (event) => {
      event.preventDefault()
      post("/api/room/approve", { note: $("#note").value })
    }
    return
  }
  if (!finished) {
    const next = stages.find((stage) => stage.status === "pending")
    composer.innerHTML = `<p>Ready for ${escape(next?.title || "the next step")}.</p><button type="submit">Start</button>`
    composer.onsubmit = (event) => {
      event.preventDefault()
      post("/api/group/handoff")
    }
    return
  }
  composer.onsubmit = (event) => event.preventDefault()
  composer.innerHTML = `<p>Every step is done for this sprint.</p>`
}

function watch(room) {
  if (polling || streaming) return
  if (!room.stages.some((stage) => stage.status === "running")) return
  polling = true
  setTimeout(async () => {
    polling = false
    if (streaming) return
    render(await fetch("/api/room").then((response) => response.json()))
  }, 1500)
}

function renderMessage(message) {
  const extra = [
    message.packet
      ? `<details class="seen"><summary>What this agent saw</summary>${renderPacket(message.packet)}</details>`
      : "",
  ].join("")
  return renderBubble(message, extra)
}

function renderPacket(packet) {
  const stages = packet.givenStages.map((stage) => `${stage.title}\n${stage.output}`).join("\n\n")
  const sources = (packet.sources || []).map((source) => `${source.title}\n${source.url}\n\n${source.body}`).join("\n\n")
  return `<div class="packet-block">Sources:
${escape(sources || "None")}

Shared memory:
${escape(packet.memory || "None yet.")}

Notes from you:
${escape(packet.notes.length ? packet.notes.join("\n") : "None")}

Earlier steps:
${escape(stages || "None. This is the first step.")}</div>`
}

permissionList.addEventListener("click", async (event) => {
  const approve = event.target.closest("[data-approve-perm]")
  const deny = event.target.closest("[data-deny-perm]")
  const id = approve?.getAttribute("data-approve-perm") || deny?.getAttribute("data-deny-perm")
  if (!id) return
  const payload = await fetchJson(`/api/room/permissions/${id}/${approve ? "approve" : "deny"}`, {})
  if (payload.error) {
    window.alert(payload.error)
    if (payload.room) render(payload.room)
    return
  }
  render(payload)
})

function renderPermissions(items) {
  // Live asks show in the chat; this list holds Write plan cards and recent outcomes.
  const visible = (items || [])
    .filter((item) => !(item.mode === "runtime" && item.status === "pending"))
    .slice(-8)
  permissionsPanel.hidden = !visible.some((item) => item.status === "pending")
  permissionList.innerHTML = visible
    .filter((item) => item.status === "pending")
    .map(
      (item) => `<li class="ask-card">
        <p class="ask-line">${avatar(item.roleTitle, item.roleName)}<span><strong>${escape(item.roleTitle)}</strong> wants to ${escape(askSentence(item))}</span></p>
        <details><summary>Details</summary><div class="md">${renderMarkdown(item.payloadSummary)}</div></details>
        <div class="ask-actions">
          <button type="button" class="primary small" data-approve-perm="${escape(item.id)}">Allow</button>
          <button type="button" class="ghost small" data-deny-perm="${escape(item.id)}">Deny</button>
        </div>
      </li>`,
    )
    .join("")
}

// ---------- Runtime permission asks ----------

/** While an agent runs (build, kickoff or DM), show its runtime asks in the open chat. */
async function pollLiveAsks() {
  if (askPolling) return
  askPolling = true
  while (busyAnywhere()) {
    try {
      const payload = await fetch("/api/permissions/live").then((response) => response.json())
      renderLiveAsks(payload.pending || [])
    } catch {
      /* next tick retries */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  liveAskIds = null
  renderLiveAsks([])
  askPolling = false
}

function renderLiveAsks(items) {
  const ids = items.map((item) => item.id).join(",")
  if (ids === liveAskIds) return
  liveAskIds = ids
  liveAsks.hidden = items.length === 0
  liveAskList.innerHTML = items
    .map(
      (item) => `<li class="ask-card live">
        <p class="ask-line">${avatar(item.roleTitle, item.roleName)}<span><strong>${escape(item.roleTitle)}</strong> wants to ${escape(askSentence(item))}</span></p>
        <details open><summary>What it will write</summary><div class="md">${renderMarkdown(item.payloadSummary)}</div></details>
        <div class="ask-actions">
          <button type="button" class="primary small" data-allow="${escape(item.id)}">Allow</button>
          <button type="button" class="ghost small" data-allow-run="${escape(item.id)}" title="Allow this kind of write from this agent until the run ends">Always allow this run</button>
          <input class="ask-reason" data-reason="${escape(item.id)}" placeholder="Why not? (optional)" />
          <button type="button" class="ghost small deny" data-deny="${escape(item.id)}">Deny</button>
        </div>
      </li>`,
    )
    .join("")
  if (items.length) liveAsks.scrollIntoView({ block: "nearest" })
}

liveAskList.addEventListener("click", async (event) => {
  const allow = event.target.closest("[data-allow]")
  const allowRun = event.target.closest("[data-allow-run]")
  const deny = event.target.closest("[data-deny]")
  const id = allow?.getAttribute("data-allow") || allowRun?.getAttribute("data-allow-run") || deny?.getAttribute("data-deny")
  if (!id) return
  const body = deny
    ? { reason: liveAskList.querySelector(`[data-reason="${cssEscape(id)}"]`)?.value || "" }
    : { remember: Boolean(allowRun) }
  // Close the card right away; the agent continues on the server.
  event.target.closest(".ask-card")?.remove()
  if (!liveAskList.children.length) liveAsks.hidden = true
  const payload = await fetchJson(`/api/room/permissions/${id}/${deny ? "deny" : "approve"}`, body)
  if (payload.error) window.alert(payload.error)
  // Force a redraw: "" would equal an empty pending list and skip it, leaving a stale card.
  liveAskIds = null
  const live = await fetch("/api/permissions/live").then((response) => response.json())
  renderLiveAsks(live.pending || [])
})

/** Plain-language version of a write, e.g. "create a Jira Story". */
function askSentence(item) {
  const action = String(item.action || "")
  const target = String(item.target || "")
  if (item.system === "jira") {
    if (/comment/i.test(action)) return `comment on Jira ${target}`
    if (/^update/i.test(action)) return `change Jira ${target}`
    if (/^attach image/i.test(action)) return `attach a marked-up screen to Jira ${target}`
    if (/^move to sprint/i.test(action)) return `move ${item.params?.issue_keys || "issues"} into Jira sprint "${target}"`
    const type = action.replace(/^create\s+/i, "") || "issue"
    return `create a Jira ${type}${/^under /i.test(target) ? ` ${target}` : ""}`
  }
  if (item.system === "confluence") return "comment on the BRS page in Confluence"
  if (item.system === "figma") return "comment on the Figma design"
  if (item.system === "github") return `open a pull request on ${target}`
  if (item.system === "jenkins") return `${action.toLowerCase() || "run a deploy"} with Jenkins`
  return `${action} (${item.system}) → ${target}`
}

// ---------- DMs ----------

agentList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-agent]")
  if (!button) return
  activeDmAgent = button.getAttribute("data-agent")
  showView("dm")
  await loadDm(activeDmAgent)
})
dmForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  if (!activeDmAgent || busyAnywhere()) return
  const body = dmInput.value.trim()
  if (!body) return
  dmInput.value = ""
  dmThread.insertAdjacentHTML("beforeend", renderBubble({ kind: "human", title: "You", body }))
  dmThread.insertAdjacentHTML("beforeend", `<p class="typing">${escape(viewTitle.textContent)} is thinking…</p>`)
  dmThread.scrollTop = dmThread.scrollHeight
  dmForm.querySelector("button").disabled = true
  dmInFlight = true
  pollLiveAsks()
  const payload = await fetchJson(`/api/dm/${encodeURIComponent(activeDmAgent)}/message`, { body })
  dmInFlight = false
  dmForm.querySelector("button").disabled = false
  if (payload.error) {
    window.alert(payload.error)
    await loadDm(activeDmAgent)
    return
  }
  renderDmThread(payload.thread)
  if (payload.room) render(payload.room)
})
submitOnEnter(dmInput, dmForm)

async function loadAgentCatalog() {
  const payload = await fetch("/api/dm").then((response) => response.json())
  agentList.innerHTML = (payload.agents || [])
    .map(
      (agent) =>
        `<li><button type="button" class="side-item" data-agent="${escape(agent.name)}">${avatar(agent.title, agent.name)}<span class="side-text">${escape(agent.title)}</span></button></li>`,
    )
    .join("")
}

async function loadDm(agentName) {
  const payload = await fetch(`/api/dm/${encodeURIComponent(agentName)}`).then((response) => response.json())
  if (payload.error) {
    dmThread.innerHTML = emptyState("Agent not found", payload.error)
    return
  }
  renderDmThread(payload.thread)
  renderViewHead()
}

function renderDmThread(thread) {
  const messages = thread?.messages || []
  dmThread.innerHTML = messages.length
    ? messages.map((message) => renderBubble(message)).join("")
    : emptyState("Direct message", "Ask this agent anything about the sprint: a gap, a design, a test case. It sees the shared memory.")
  dmThread.scrollTop = dmThread.scrollHeight
}

// ---------- Sources ----------

disconnectAtlassian.addEventListener("click", async () => {
  await fetch("/api/atlassian/disconnect", { method: "POST" })
  await loadSession()
})
disconnectFigma.addEventListener("click", async () => {
  await fetch("/api/figma/disconnect", { method: "POST" })
  await loadSession()
})
disconnectGitHub.addEventListener("click", async () => {
  await fetch("/api/github/disconnect", { method: "POST" })
  await loadSession()
})

async function saveFigma() {
  return saveSource(figmaPreview, "/api/room/figma-source", { figmaFileUrl: figmaUrl.value }, (payload) =>
    payload.figmaPreview ? `Saved (file ${payload.figmaPreview.fileKey})` : "Figma link cleared",
  )
}

async function saveJira() {
  return saveSource(jiraPreview, "/api/room/jira-source", { jiraBoardUrl: jiraBoardUrl.value }, (payload) =>
    payload.jiraPreview
      ? `Saved project ${payload.jiraPreview.projectKey}${payload.jiraPreview.boardId ? ` (board ${payload.jiraPreview.boardId})` : ""}`
      : "Jira cleared",
  )
}

async function saveBrs() {
  sourcePreview.textContent = "Checking Confluence…"
  return saveSource(
    sourcePreview,
    "/api/room/source",
    { confluencePageUrl: confluenceUrl.value, pastedBrd: pastedBrd.value },
    (payload) => (payload.preview ? payload.warning || `Ready: ${payload.preview.title} (${payload.preview.chars} characters)` : ""),
    (payload) => Boolean(payload.warning),
  )
}

async function saveSource(preview, url, body, describe, isWarning = () => false) {
  preview.classList.remove("error")
  if (!preview.textContent) preview.textContent = "Saving…"
  const payload = await fetchJson(url, body)
  if (payload.error) {
    preview.classList.add("error")
    preview.textContent = payload.error
    return false
  }
  render(payload)
  preview.classList.toggle("error", isWarning(payload))
  preview.textContent = describe(payload)
  return true
}

figmaForm.addEventListener("submit", (event) => {
  event.preventDefault()
  saveFigma()
})
jiraForm.addEventListener("submit", (event) => {
  event.preventDefault()
  saveJira()
})
sourceForm.addEventListener("submit", (event) => {
  event.preventDefault()
  saveBrs()
})
requirementForm.addEventListener("submit", (event) => {
  event.preventDefault()
  startKickoff()
})
gitForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  gitPreview.classList.remove("error")
  gitPreview.textContent = "Adding…"
  const payload = await fetchJson("/api/room/git-source", {
    action: "add",
    gitRepoUrl: gitRepoUrl.value,
    gitBranch: gitBranch.value,
  })
  if (payload.error) {
    gitPreview.classList.add("error")
    gitPreview.textContent = payload.error
    return
  }
  gitRepoUrl.value = ""
  gitBranch.value = ""
  render(payload)
  gitPreview.textContent = payload.gitPreview
    ? `Added ${payload.gitPreview.owner}/${payload.gitPreview.repo} @ ${payload.gitPreview.branch}`
    : ""
})
gitRepoList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remove-repo]")
  if (!button) return
  const payload = await fetchJson("/api/room/git-source", { action: "remove", id: button.getAttribute("data-remove-repo") })
  if (payload.error) {
    gitPreview.classList.add("error")
    gitPreview.textContent = payload.error
    return
  }
  render(payload)
  gitPreview.textContent = "Repo removed"
})
deployForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  deployPreview.classList.remove("error")
  deployPreview.textContent = "Saving…"
  const payload = await fetchJson("/api/room/deploy-source", {
    deployEnv: deployEnv.value,
    deployUrl: deployUrl.value,
    jenkinsJob: jenkinsJob.value,
  })
  if (payload.error) {
    deployPreview.classList.add("error")
    deployPreview.textContent = payload.error
    return
  }
  render(payload)
  const preview = payload.deployPreview || {}
  const parts = [preview.deployEnv, preview.jenkinsJob, preview.deployUrl].filter(Boolean)
  deployPreview.textContent = parts.length ? `Saved: ${parts.join(" · ")}` : "Deploy settings cleared"
})

function renderGitRepos(repos, locked) {
  gitRepoList.innerHTML = (repos || [])
    .map(
      (item) => `<li>
        <div class="repo-meta">
          <span class="repo-name">${escape(item.owner)}/${escape(item.repo)}</span>
          <span class="repo-branch">${escape(item.branch)}</span>
        </div>
        <button type="button" data-remove-repo="${escape(item.id)}" ${locked ? "disabled" : ""}>Remove</button>
      </li>`,
    )
    .join("")
}

function renderDeployPreview(room) {
  const envBits = Object.entries(room.deploymentsByEnv || {}).map(([envName, rec]) => `${envName}: ${rec.smokeResult || "?"}`)
  if (room.lastSmokeReport?.summary) {
    const line = `Last smoke test: ${room.lastSmokeReport.result} — ${room.lastSmokeReport.summary}${envBits.length ? ` | ${envBits.join(", ")}` : ""}`
    if (!deployPreview.textContent || /^(Last smoke|Saved:)/.test(deployPreview.textContent)) deployPreview.textContent = line
  } else if (envBits.length && !deployPreview.textContent) {
    deployPreview.textContent = `Environments: ${envBits.join(", ")}`
  }
}

// ---------- Settings: memory, team, account ----------

memoryForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  memoryPreview.classList.remove("error")
  const payload = await fetchJson("/api/memory", { kind: "note", title: memoryTitle.value, body: memoryBody.value })
  if (payload.error) {
    memoryPreview.classList.add("error")
    memoryPreview.textContent = payload.error
    return
  }
  memoryTitle.value = ""
  memoryBody.value = ""
  memoryPreview.textContent = "Saved"
  renderMemory(payload.memory)
})

async function loadMemory() {
  renderMemory(await fetch("/api/memory").then((response) => response.json()))
}

function renderMemory(store) {
  const entries = [...(store?.entries || [])].reverse().slice(0, 60)
  memoryList.innerHTML = entries.length
    ? entries
        .map(
          (item) => `<li class="card">
            <div class="mem-kind">${escape(item.kind)} · ${escape(item.agent)}</div>
            <strong>${escape(item.title)}</strong>
            <div class="md">${renderMarkdown(item.body)}</div>
          </li>`,
        )
        .join("")
    : `<li class="lead">Nothing yet. The agents add gaps, decisions and tests here as they work.</li>`
}

teamsList.addEventListener("click", async (event) => {
  const use = event.target.closest("[data-use-team]")
  if (!use) return
  const payload = await fetchJson("/api/room/team", { teamId: use.getAttribute("data-use-team") })
  if (payload.error) {
    teamsPreview.classList.add("error")
    teamsPreview.textContent = payload.error
    return
  }
  teamsPreview.classList.remove("error")
  teamsPreview.textContent = `Active team: ${payload.team?.name || "set"}`
  render(payload)
  await loadTeams()
})
teamCreate.addEventListener("submit", async (event) => {
  event.preventDefault()
  teamsPreview.classList.remove("error")
  const agentNames = teamAgents.value.split(",").map((part) => part.trim()).filter(Boolean)
  const payload = await fetchJson("/api/teams", { name: teamName.value, agentNames })
  if (payload.error) {
    teamsPreview.classList.add("error")
    teamsPreview.textContent = payload.error
    return
  }
  teamName.value = ""
  teamAgents.value = ""
  teamsPreview.textContent = `Saved ${payload.team.name}`
  await loadTeams()
})

async function loadTeams() {
  const payload = await fetch("/api/teams").then((response) => response.json())
  const activeId = lastRoom?.teamId
  teamsList.innerHTML = (payload.teams || [])
    .map(
      (team) => `<li class="card">
        <div class="mem-kind">${team.isDefault ? "Default" : "Your team"}${team.id === activeId ? " · in use" : ""}</div>
        <strong>${escape(team.name)}</strong>
        <div class="lead">${escape((team.agentNames || []).join(" → "))}</div>
        ${team.id === activeId ? "" : `<div class="ask-actions"><button type="button" class="ghost small" data-use-team="${escape(team.id)}">Use this team</button></div>`}
      </li>`,
    )
    .join("")
}

$("#toolkit-import").addEventListener("submit", async (event) => {
  event.preventDefault()
  const preview = $("#toolkit-preview")
  preview.classList.remove("error")
  if (!session?.user) {
    preview.classList.add("error")
    preview.textContent = "Sign in to import agents."
    return
  }
  preview.textContent = "Importing…"
  const payload = await fetchJson("/api/toolkits/axian/import", {
    path: $("#toolkit-path").value.trim(),
    overwrite: $("#toolkit-overwrite").checked,
  })
  if (payload.error) {
    preview.classList.add("error")
    preview.textContent = payload.error
    return
  }
  const count = (status) => payload.agents.filter((agent) => agent.status === status).length
  preview.textContent =
    `Imported ${count("imported")}, updated ${count("updated")}, skipped ${count("skipped")}. ` +
    (payload.team ? `Team "${payload.team.name}" is ready to use.` : "") +
    (payload.warnings.length ? ` Notes: ${payload.warnings.join("; ")}` : "")
  await loadCatalog()
  await loadTeams()
})

catalogList.addEventListener("click", async (event) => {
  const dup = event.target.closest("[data-duplicate]")
  const edit = event.target.closest("[data-edit-catalog]")
  if (dup) {
    const payload = await fetchJson("/api/catalog/duplicate", { sourceName: dup.getAttribute("data-duplicate") })
    if (payload.error) {
      catalogPreview.classList.add("error")
      catalogPreview.textContent = payload.error
      return
    }
    catalogPreview.classList.remove("error")
    catalogPreview.textContent = `Copied as ${payload.agent.name}`
    await loadCatalog()
    return
  }
  if (edit) {
    const payload = await fetch(`/api/catalog/${encodeURIComponent(edit.getAttribute("data-edit-catalog"))}`).then((r) => r.json())
    if (!payload.agent) return
    editingCatalogName = payload.agent.name
    catalogEdit.hidden = false
    catalogEditTitle.textContent = `Edit ${payload.agent.title}`
    catalogTitle.value = payload.agent.title
    catalogTools.value = (payload.agent.tools || []).join(", ")
    catalogNeedsApproval.checked = Boolean(payload.agent.needsApproval)
    catalogInstructions.value = payload.agent.instructions || ""
    catalogDraft.value = payload.agent.draft || ""
    catalogEdit.scrollIntoView({ block: "start" })
  }
})
catalogEdit.addEventListener("submit", async (event) => {
  event.preventDefault()
  if (!editingCatalogName) return
  catalogPreview.classList.remove("error")
  const payload = await fetchJson(`/api/catalog/${encodeURIComponent(editingCatalogName)}`, {
    title: catalogTitle.value,
    tools: catalogTools.value.split(",").map((part) => part.trim()).filter(Boolean),
    needsApproval: catalogNeedsApproval.checked,
    instructions: catalogInstructions.value,
    draft: catalogDraft.value,
  })
  if (payload.error) {
    catalogPreview.classList.add("error")
    catalogPreview.textContent = payload.error
    return
  }
  catalogPreview.textContent = "Saved"
  await loadCatalog()
})

async function loadCatalog() {
  const payload = await fetch("/api/catalog").then((response) => response.json())
  const signedIn = Boolean(session?.user)
  catalogList.innerHTML = (payload.agents || [])
    .map((agent) => {
      const actions = [
        signedIn ? `<button type="button" class="ghost small" data-duplicate="${escape(agent.name)}">Make a copy</button>` : "",
        agent.origin === "custom" ? `<button type="button" class="ghost small" data-edit-catalog="${escape(agent.name)}">Edit</button>` : "",
      ].join("")
      return `<li class="card agent-card">
        ${avatar(agent.title, agent.name)}
        <div>
          <strong>${escape(agent.title)}</strong>
          <div class="lead">${agent.toolkit ? `Imported · ${escape(agent.toolkit)}` : agent.origin === "custom" ? "Your copy" : "Built in"}${agent.needsApproval ? " · pauses for your OK" : ""}</div>
          <div class="ask-actions">${actions || `<span class="lead">Sign in to copy and edit</span>`}</div>
        </div>
      </li>`
    })
    .join("")
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  accountPreview.classList.remove("error")
  const payload = await fetchJson("/api/auth/login", {
    email: $("#login-email").value,
    password: $("#login-password").value,
  })
  if (payload.error) {
    accountPreview.classList.add("error")
    accountPreview.textContent = payload.error
    return
  }
  accountPreview.textContent = `Signed in as ${payload.user.email}`
  await loadSession()
})
registerForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  accountPreview.classList.remove("error")
  const payload = await fetchJson("/api/auth/register", {
    name: $("#register-name").value,
    email: $("#register-email").value,
    password: $("#register-password").value,
    workspaceName: $("#register-workspace").value,
  })
  if (payload.error) {
    accountPreview.classList.add("error")
    accountPreview.textContent = payload.error
    return
  }
  accountPreview.textContent = `Workspace ${payload.workspace.name} ready`
  await loadSession()
})
logoutBtn.addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" })
  await loadSession()
})

function renderSession(next) {
  session = next
  renderConnection(atlassianStatus, connectAtlassian, disconnectAtlassian, "Atlassian", next.atlassian?.connected, next.atlassian?.siteName, next.atlassianConfigured)
  renderConnection(figmaStatus, connectFigma, disconnectFigma, "Figma", next.figma?.connected, next.figma?.userName, next.figmaConfigured)
  renderConnection(githubStatus, connectGitHub, disconnectGitHub, "GitHub", next.github?.connected, next.github?.userLogin, next.githubConfigured)
  if (next.user) {
    accountStatus.textContent = next.user.name || next.user.email
    accountStatus.classList.add("connected")
    accountSignedIn.hidden = false
    accountUser.textContent = `${next.user.email} · ${next.workspace?.name || "workspace"}`
    loginForm.hidden = true
    registerForm.hidden = true
  } else {
    accountStatus.textContent = "Guest"
    accountStatus.classList.remove("connected")
    accountSignedIn.hidden = true
    loginForm.hidden = false
    registerForm.hidden = false
  }
}

function renderConnection(status, connect, disconnect, name, connected, who, configured) {
  status.textContent = name
  status.classList.toggle("connected", Boolean(connected))
  status.title = connected ? `${name}: ${who}` : configured ? `${name} not connected` : `${name} app keys are not in .env`
  connect.hidden = Boolean(connected) || !configured
  connect.textContent = "Connect"
  disconnect.hidden = !connected
  const row = connect.closest(".connect-row")
  if (row) {
    row.classList.toggle("connected", Boolean(connected))
    const note = row.querySelector(".lead")
    if (note && !note.dataset.base) note.dataset.base = note.textContent
    if (note) note.textContent = connected ? `Connected as ${who}` : configured ? note.dataset.base : "Ask an admin to add the app keys to .env"
  }
}

async function loadSession() {
  renderSession(await fetch("/api/session").then((response) => response.json()))
}

// ---------- Messages and markdown ----------

function renderBubble(message, extra = "") {
  if (message.kind === "human") {
    return `<article class="msg human"><div class="msg-body"><div class="md">${renderMarkdown(message.body)}</div></div></article>`
  }
  return `<article class="msg agent">${avatar(message.title, message.speaker)}<div class="msg-body"><p class="who">${escape(message.title)}</p><div class="md">${renderMarkdown(message.body)}</div>${extra}</div></article>`
}

function appendLive(container, event) {
  let bubble = container.querySelector(`[data-live="${cssEscape(event.name)}"]`)
  if (!bubble) {
    container.querySelector(".empty-state")?.remove()
    container.insertAdjacentHTML(
      "beforeend",
      `<article class="msg agent live">${avatar(event.title, event.name)}<div class="msg-body"><p class="who">${escape(event.title)} <span class="typing">typing…</span></p><div class="md plain" data-live="${escape(event.name)}"></div></div></article>`,
    )
    bubble = container.querySelector(`[data-live="${cssEscape(event.name)}"]`)
  }
  bubble.textContent += event.text
  container.scrollTop = container.scrollHeight
}

function avatar(title, key) {
  const words = String(title || "?").split(/\s+/).filter(Boolean)
  const initials = words.length > 1 ? words[0][0] + words[1][0] : (words[0] || "?").slice(0, 2)
  let hash = 0
  for (const char of String(key || title || "")) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return `<span class="avatar" style="--hue:${hash}" aria-hidden="true">${escape(initials.toUpperCase())}</span>`
}

function emptyState(title, body) {
  return `<div class="empty-state"><h2>${escape(title)}</h2><p>${escape(body)}</p></div>`
}

/** Small safe markdown: escape first, then headings, lists, tables, code, bold, italics, links. */
function renderMarkdown(text) {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n")
  const out = []
  let i = 0
  const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line)
  const isRule = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)
  const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim())
  const special = (line) =>
    /^```/.test(line) || /^#{1,6}\s/.test(line) || /^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line) || isTableRow(line)

  while (i < lines.length) {
    const line = lines[i]
    if (/^```/.test(line)) {
      const code = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++])
      i++
      out.push(`<pre><code>${escape(code.join("\n"))}</code></pre>`)
      continue
    }
    if (isTableRow(line) && i + 1 < lines.length && isRule(lines[i + 1])) {
      const head = cells(line)
      i += 2
      const rows = []
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]))
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      )
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      const level = Math.min(heading[1].length + 2, 6)
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      i++
      continue
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const pattern = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/
      const items = []
      while (i < lines.length && pattern.test(lines[i])) items.push(lines[i++].replace(pattern, ""))
      const tag = ordered ? "ol" : "ul"
      out.push(`<${tag}>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</${tag}>`)
      continue
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push("<hr />")
      i++
      continue
    }
    if (!line.trim()) {
      i++
      continue
    }
    const para = []
    while (i < lines.length && lines[i].trim() && !special(lines[i])) para.push(lines[i++])
    if (!para.length) para.push(lines[i++])
    out.push(`<p>${para.map(inline).join("<br />")}</p>`)
  }
  return out.join("")
}

function inline(text) {
  return String(text)
    .split(/(`[^`]+`)/)
    .map((part, index) => {
      if (index % 2 === 1) return `<code>${escape(part.slice(1, -1))}</code>`
      return escape(part)
        // Only the app's own annotated screens are shown as images.
        .replace(
          /!\[([^\]]*)\]\((\/api\/annotations\/[\w.-]+\.png)\)/g,
          '<a href="$2" target="_blank" rel="noopener"><img class="annot" src="$2" alt="$1" loading="lazy" /></a>',
        )
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)"]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    })
    .join("")
}

// ---------- Helpers ----------

async function readStream(response, onEvent) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""
    for (const line of lines) {
      if (!line.trim()) continue
      const event = JSON.parse(line)
      if (event.type === "error") window.alert(event.message)
      else onEvent(event)
    }
  }
}

/** POST JSON and return the parsed body; failures come back as { error }. */
async function fetchJson(url, body) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) return { ...payload, error: payload.error || `Request failed (${response.status})` }
    return payload
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Network error" }
  }
}

function submitOnEnter(textarea, form) {
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      form.requestSubmit()
    }
  })
  textarea.addEventListener("input", () => {
    textarea.style.height = "auto"
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
  })
}

function busyAnywhere() {
  return streaming || dmInFlight || groupStreaming
}

function setDot(dot, state) {
  dot.className = `dot ${state || ""}`.trim()
  dot.title = { talking: "Working", waiting: "Waiting for you", done: "Done", error: "Needs attention" }[state] || ""
}

function label(status) {
  if (status === "waiting_approval") return "Needs your OK"
  if (status === "running") return "Working"
  if (status === "error") return "Problem"
  if (status === "done") return "Done"
  return "Next"
}

function shorten(text, max) {
  const clean = String(text).replace(/\s+/g, " ").trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function escape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function cssEscape(value) {
  if (window.CSS && CSS.escape) return CSS.escape(value)
  return String(value).replaceAll('"', "")
}

// ---------- Start ----------

async function boot() {
  const [room, group] = await Promise.all([
    fetch("/api/room").then((response) => response.json()),
    fetch("/api/group").then((response) => response.json()),
    loadSession(),
    loadAgentCatalog(),
    loadEnvironments(),
  ])
  render(room)
  if (!group.error) renderGroup(group)

  const hasSources = Boolean(room.confluencePageUrl || room.pastedBrd)
  const hasDiscussion = Boolean(group.thread?.messages?.length)
  if (!hasSources && !hasDiscussion) {
    showView("wizard", { step: 1 })
    return
  }
  const saved = recall("view") || "kickoff"
  if (saved.startsWith("dm:") && saved.slice(3) !== "null") {
    activeDmAgent = saved.slice(3)
    showView("dm")
    await loadDm(activeDmAgent)
    return
  }
  showView(views[saved] ? saved : "kickoff")
}

boot()
