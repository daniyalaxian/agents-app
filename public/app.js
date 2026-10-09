const chips = document.querySelector("#chips")
const transcript = document.querySelector("#transcript")
const empty = document.querySelector("#empty")
const permissionsPanel = document.querySelector("#permissions")
const permissionList = document.querySelector("#permission-list")
const composer = document.querySelector("#composer")
const reset = document.querySelector("#reset")
const requirementForm = document.querySelector("#requirement-form")
const requirementText = document.querySelector("#requirement-text")
const requirementPreview = document.querySelector("#requirement-preview")
const engine = document.querySelector("#engine")
const atlassianStatus = document.querySelector("#atlassian-status")
const connectAtlassian = document.querySelector("#connect-atlassian")
const disconnectAtlassian = document.querySelector("#disconnect-atlassian")
const figmaStatus = document.querySelector("#figma-status")
const connectFigma = document.querySelector("#connect-figma")
const disconnectFigma = document.querySelector("#disconnect-figma")
const figmaForm = document.querySelector("#figma-form")
const figmaUrl = document.querySelector("#figma-url")
const figmaPreview = document.querySelector("#figma-preview")
const githubStatus = document.querySelector("#github-status")
const connectGitHub = document.querySelector("#connect-github")
const disconnectGitHub = document.querySelector("#disconnect-github")
const gitForm = document.querySelector("#git-form")
const gitRepoUrl = document.querySelector("#git-repo-url")
const gitBranch = document.querySelector("#git-branch")
const gitPreview = document.querySelector("#git-preview")
const gitRepoList = document.querySelector("#git-repo-list")
const jiraForm = document.querySelector("#jira-form")
const jiraBoardUrl = document.querySelector("#jira-board-url")
const jiraPreview = document.querySelector("#jira-preview")
const deployForm = document.querySelector("#deploy-form")
const deployEnv = document.querySelector("#deploy-env")
const deployUrl = document.querySelector("#deploy-url")
const jenkinsJob = document.querySelector("#jenkins-job")
const deployPreview = document.querySelector("#deploy-preview")
const sourceForm = document.querySelector("#source-form")
const confluenceUrl = document.querySelector("#confluence-url")
const pastedBrd = document.querySelector("#pasted-brd")
const sourcePreview = document.querySelector("#source-preview")
const openSetup = document.querySelector("#open-setup")
const closeSetup = document.querySelector("#close-setup")
const setupDrawer = document.querySelector("#setup-drawer")
const setupBackdrop = document.querySelector("#setup-backdrop")
const openAgents = document.querySelector("#open-agents")
const closeAgents = document.querySelector("#close-agents")
const agentsDrawer = document.querySelector("#agents-drawer")
const agentList = document.querySelector("#agent-list")
const dmTitle = document.querySelector("#dm-title")
const dmThread = document.querySelector("#dm-thread")
const dmForm = document.querySelector("#dm-form")
const dmInput = document.querySelector("#dm-input")
const openMemory = document.querySelector("#open-memory")
const closeMemory = document.querySelector("#close-memory")
const memoryDrawer = document.querySelector("#memory-drawer")
const memoryList = document.querySelector("#memory-list")
const memoryForm = document.querySelector("#memory-form")
const memoryTitle = document.querySelector("#memory-title")
const memoryBody = document.querySelector("#memory-body")
const memoryPreview = document.querySelector("#memory-preview")
const accountStatus = document.querySelector("#account-status")
const openAccount = document.querySelector("#open-account")
const closeAccount = document.querySelector("#close-account")
const accountDrawer = document.querySelector("#account-drawer")
const accountSignedIn = document.querySelector("#account-signed-in")
const accountUser = document.querySelector("#account-user")
const accountPreview = document.querySelector("#account-preview")
const loginForm = document.querySelector("#login-form")
const registerForm = document.querySelector("#register-form")
const logoutBtn = document.querySelector("#logout")
const openCatalog = document.querySelector("#open-catalog")
const closeCatalog = document.querySelector("#close-catalog")
const catalogDrawer = document.querySelector("#catalog-drawer")
const catalogList = document.querySelector("#catalog-list")
const catalogEdit = document.querySelector("#catalog-edit")
const catalogEditTitle = document.querySelector("#catalog-edit-title")
const catalogTitle = document.querySelector("#catalog-title")
const catalogTools = document.querySelector("#catalog-tools")
const catalogNeedsApproval = document.querySelector("#catalog-needs-approval")
const catalogInstructions = document.querySelector("#catalog-instructions")
const catalogDraft = document.querySelector("#catalog-draft")
const catalogPreview = document.querySelector("#catalog-preview")
const openTeams = document.querySelector("#open-teams")
const closeTeams = document.querySelector("#close-teams")
const teamsDrawer = document.querySelector("#teams-drawer")
const teamsList = document.querySelector("#teams-list")
const teamCreate = document.querySelector("#team-create")
const teamName = document.querySelector("#team-name")
const teamAgents = document.querySelector("#team-agents")
const teamsPreview = document.querySelector("#teams-preview")

let activeDmAgent = null
let editingCatalogName = null

const engineLabel = {
  draft: "Local drafts",
  "cursor-local": "Cursor on this machine",
  "cursor-cloud": "Cursor cloud agents",
}

let streaming = false
let polling = false
let session = null

openSetup.addEventListener("click", () => setSetupOpen(true))
closeSetup.addEventListener("click", () => setSetupOpen(false))
setupBackdrop.addEventListener("click", () => closeAllDrawers())
openAgents.addEventListener("click", () => setAgentsOpen(true))
closeAgents.addEventListener("click", () => setAgentsOpen(false))
openMemory.addEventListener("click", () => setMemoryOpen(true))
closeMemory.addEventListener("click", () => setMemoryOpen(false))
openAccount.addEventListener("click", () => setAccountOpen(true))
closeAccount.addEventListener("click", () => setAccountOpen(false))
openCatalog.addEventListener("click", () => setCatalogOpen(true))
closeCatalog.addEventListener("click", () => setCatalogOpen(false))
openTeams.addEventListener("click", () => setTeamsOpen(true))
closeTeams.addEventListener("click", () => setTeamsOpen(false))
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeAllDrawers()
})
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  accountPreview.classList.remove("error")
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: document.querySelector("#login-email").value,
      password: document.querySelector("#login-password").value,
    }),
  })
  const payload = await response.json()
  if (!response.ok) {
    accountPreview.classList.add("error")
    accountPreview.textContent = payload.error || "Sign in failed"
    return
  }
  accountPreview.textContent = `Signed in as ${payload.user.email}`
  await loadSession()
})
registerForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  accountPreview.classList.remove("error")
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: document.querySelector("#register-name").value,
      email: document.querySelector("#register-email").value,
      password: document.querySelector("#register-password").value,
      workspaceName: document.querySelector("#register-workspace").value,
    }),
  })
  const payload = await response.json()
  if (!response.ok) {
    accountPreview.classList.add("error")
    accountPreview.textContent = payload.error || "Register failed"
    return
  }
  accountPreview.textContent = `Workspace ${payload.workspace.name} ready`
  await loadSession()
})
logoutBtn.addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" })
  await loadSession()
})
catalogList.addEventListener("click", async (event) => {
  const dup = event.target.closest("[data-duplicate]")
  const edit = event.target.closest("[data-edit-catalog]")
  if (dup) {
    const response = await fetch("/api/catalog/duplicate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceName: dup.getAttribute("data-duplicate") }),
    })
    const payload = await response.json()
    if (!response.ok) {
      catalogPreview.classList.add("error")
      catalogPreview.textContent = payload.error || "Duplicate needs sign-in"
      return
    }
    catalogPreview.classList.remove("error")
    catalogPreview.textContent = `Cloned ${payload.agent.name}`
    await loadCatalog()
    return
  }
  if (edit) {
    const name = edit.getAttribute("data-edit-catalog")
    const payload = await fetch(`/api/catalog/${encodeURIComponent(name)}`).then((r) => r.json())
    if (!payload.agent) return
    editingCatalogName = payload.agent.name
    catalogEdit.hidden = false
    catalogEditTitle.textContent = `Edit ${payload.agent.name}`
    catalogTitle.value = payload.agent.title
    catalogTools.value = (payload.agent.tools || []).join(", ")
    catalogNeedsApproval.checked = Boolean(payload.agent.needsApproval)
    catalogInstructions.value = payload.agent.instructions || ""
    catalogDraft.value = payload.agent.draft || ""
  }
})
catalogEdit.addEventListener("submit", async (event) => {
  event.preventDefault()
  if (!editingCatalogName) return
  catalogPreview.classList.remove("error")
  const response = await fetch(`/api/catalog/${encodeURIComponent(editingCatalogName)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: catalogTitle.value,
      tools: catalogTools.value.split(",").map((part) => part.trim()).filter(Boolean),
      needsApproval: catalogNeedsApproval.checked,
      instructions: catalogInstructions.value,
      draft: catalogDraft.value,
    }),
  })
  const payload = await response.json()
  if (!response.ok) {
    catalogPreview.classList.add("error")
    catalogPreview.textContent = payload.error || "Save failed"
    return
  }
  catalogPreview.textContent = "Saved"
  await loadCatalog()
})
teamsList.addEventListener("click", async (event) => {
  const use = event.target.closest("[data-use-team]")
  if (!use) return
  const response = await fetch("/api/room/team", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ teamId: use.getAttribute("data-use-team") }),
  })
  const payload = await response.json()
  if (!response.ok) {
    teamsPreview.classList.add("error")
    teamsPreview.textContent = payload.error || "Could not set team"
    return
  }
  teamsPreview.classList.remove("error")
  teamsPreview.textContent = `Active team: ${payload.team?.name || "set"}`
  render(payload)
})
teamCreate.addEventListener("submit", async (event) => {
  event.preventDefault()
  teamsPreview.classList.remove("error")
  const agentNames = teamAgents.value.split(",").map((part) => part.trim()).filter(Boolean)
  const response = await fetch("/api/teams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: teamName.value, agentNames }),
  })
  const payload = await response.json()
  if (!response.ok) {
    teamsPreview.classList.add("error")
    teamsPreview.textContent = payload.error || "Create team needs sign-in"
    return
  }
  teamName.value = ""
  teamAgents.value = ""
  teamsPreview.textContent = `Saved ${payload.team.name}`
  await loadTeams()
})
agentList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-agent]")
  if (!button) return
  activeDmAgent = button.getAttribute("data-agent")
  await loadDm(activeDmAgent)
})
dmForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  if (!activeDmAgent || streaming) return
  const body = dmInput.value.trim()
  if (!body) return
  dmForm.querySelector("button").disabled = true
  const response = await fetch(`/api/dm/${encodeURIComponent(activeDmAgent)}/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  })
  const payload = await response.json()
  dmForm.querySelector("button").disabled = false
  if (!response.ok) {
    window.alert(payload.error || "DM failed")
    return
  }
  dmInput.value = ""
  renderDmThread(payload.thread)
  if (payload.room) render(payload.room)
})
memoryForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  memoryPreview.classList.remove("error")
  const response = await fetch("/api/memory", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "note", title: memoryTitle.value, body: memoryBody.value }),
  })
  const payload = await response.json()
  if (!response.ok) {
    memoryPreview.classList.add("error")
    memoryPreview.textContent = payload.error || "Could not save memory"
    return
  }
  memoryTitle.value = ""
  memoryBody.value = ""
  memoryPreview.textContent = "Saved"
  renderMemory(payload.memory)
})

reset.addEventListener("click", () =>
  post("/api/room/reset", { hard: false, requirement: requirementText?.value || undefined }),
)
requirementForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  requirementPreview.classList.remove("error")
  requirementPreview.textContent = "Saving…"
  const response = await fetch("/api/room/requirement", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requirement: requirementText.value }),
  })
  const payload = await response.json()
  if (!response.ok) {
    requirementPreview.classList.add("error")
    requirementPreview.textContent = payload.error || "Could not save requirement"
    return
  }
  render(payload)
  requirementPreview.textContent = `Saved room id: ${payload.id}`
})
permissionList.addEventListener("click", async (event) => {
  const approve = event.target.closest("[data-approve-perm]")
  const deny = event.target.closest("[data-deny-perm]")
  const id = approve?.getAttribute("data-approve-perm") || deny?.getAttribute("data-deny-perm")
  if (!id) return
  const url = approve
    ? `/api/room/permissions/${id}/approve`
    : `/api/room/permissions/${id}/deny`
  const response = await fetch(url, { method: "POST" })
  const payload = await response.json()
  if (!response.ok) {
    window.alert(payload.error || "Permission action failed")
    if (payload.room) render(payload.room)
    return
  }
  render(payload)
})
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
figmaForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  figmaPreview.classList.remove("error")
  figmaPreview.textContent = "Saving…"
  const response = await fetch("/api/room/figma-source", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ figmaFileUrl: figmaUrl.value }),
  })
  const payload = await response.json()
  if (!response.ok) {
    figmaPreview.classList.add("error")
    figmaPreview.textContent = payload.error || "Could not save the Figma link"
    return
  }
  render(payload)
  if (payload.figmaPreview) {
    figmaPreview.textContent = `Saved file key: ${payload.figmaPreview.fileKey}`
  } else {
    figmaPreview.textContent = "Figma link cleared"
  }
})
jiraForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  jiraPreview.classList.remove("error")
  jiraPreview.textContent = "Saving…"
  const response = await fetch("/api/room/jira-source", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jiraBoardUrl: jiraBoardUrl.value }),
  })
  const payload = await response.json()
  if (!response.ok) {
    jiraPreview.classList.add("error")
    jiraPreview.textContent = payload.error || "Could not save the Jira board"
    return
  }
  render(payload)
  if (payload.jiraPreview) {
    jiraPreview.textContent = payload.jiraPreview.boardId
      ? `Saved project ${payload.jiraPreview.projectKey} (board ${payload.jiraPreview.boardId})`
      : `Saved project ${payload.jiraPreview.projectKey}`
  } else {
    jiraPreview.textContent = "Jira board cleared"
  }
})
gitForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  gitPreview.classList.remove("error")
  gitPreview.textContent = "Adding…"
  const response = await fetch("/api/room/git-source", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "add",
      gitRepoUrl: gitRepoUrl.value,
      gitBranch: gitBranch.value,
    }),
  })
  const payload = await response.json()
  if (!response.ok) {
    gitPreview.classList.add("error")
    gitPreview.textContent = payload.error || "Could not add the GitHub repo"
    return
  }
  gitRepoUrl.value = ""
  gitBranch.value = ""
  render(payload)
  if (payload.gitPreview) {
    gitPreview.textContent = `Added ${payload.gitPreview.owner}/${payload.gitPreview.repo} @ ${payload.gitPreview.branch}`
  } else {
    gitPreview.textContent = ""
  }
})
gitRepoList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remove-repo]")
  if (!button) return
  const id = button.getAttribute("data-remove-repo")
  const response = await fetch("/api/room/git-source", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "remove", id }),
  })
  const payload = await response.json()
  if (!response.ok) {
    gitPreview.classList.add("error")
    gitPreview.textContent = payload.error || "Could not remove the repo"
    return
  }
  render(payload)
  gitPreview.textContent = "Repo removed"
})
deployForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  deployPreview.classList.remove("error")
  deployPreview.textContent = "Saving…"
  const response = await fetch("/api/room/deploy-source", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deployEnv: deployEnv.value,
      deployUrl: deployUrl.value,
      jenkinsJob: jenkinsJob.value,
    }),
  })
  const payload = await response.json()
  if (!response.ok) {
    deployPreview.classList.add("error")
    deployPreview.textContent = payload.error || "Could not save deploy settings"
    return
  }
  render(payload)
  const preview = payload.deployPreview || {}
  const parts = []
  if (preview.deployEnv) parts.push(preview.deployEnv)
  if (preview.jenkinsJob) parts.push(preview.jenkinsJob)
  if (preview.deployUrl) parts.push(preview.deployUrl)
  deployPreview.textContent = parts.length ? `Saved: ${parts.join(" · ")}` : "Deploy settings cleared"
})
sourceForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  sourcePreview.classList.remove("error")
  sourcePreview.textContent = "Checking Confluence…"
  const response = await fetch("/api/room/source", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      confluencePageUrl: confluenceUrl.value,
      pastedBrd: pastedBrd.value,
    }),
  })
  const payload = await response.json()
  if (!response.ok) {
    sourcePreview.classList.add("error")
    sourcePreview.textContent = payload.error || "Could not save the BRS source"
    return
  }
  render(payload)
  if (payload.preview) {
    sourcePreview.classList.toggle("error", Boolean(payload.warning))
    sourcePreview.textContent = payload.warning
      ? `${payload.warning}`
      : `Ready: ${payload.preview.title} (${payload.preview.chars} characters)`
  } else {
    sourcePreview.textContent = ""
  }
})

function drawers() {
  return [setupDrawer, agentsDrawer, memoryDrawer, accountDrawer, catalogDrawer, teamsDrawer]
}

function hideOtherDrawers(keep) {
  for (const drawer of drawers()) {
    if (drawer !== keep) drawer.hidden = true
  }
}

function backdropVisible() {
  return drawers().some((drawer) => !drawer.hidden)
}

function setSetupOpen(open) {
  if (open) hideOtherDrawers(setupDrawer)
  setupDrawer.hidden = !open
  setupBackdrop.hidden = !backdropVisible()
}

function setAgentsOpen(open) {
  if (open) {
    hideOtherDrawers(agentsDrawer)
    loadAgentCatalog()
  }
  agentsDrawer.hidden = !open
  setupBackdrop.hidden = !backdropVisible()
}

function setMemoryOpen(open) {
  if (open) {
    hideOtherDrawers(memoryDrawer)
    loadMemory()
  }
  memoryDrawer.hidden = !open
  setupBackdrop.hidden = !backdropVisible()
}

function setAccountOpen(open) {
  if (open) hideOtherDrawers(accountDrawer)
  accountDrawer.hidden = !open
  setupBackdrop.hidden = !backdropVisible()
}

function setCatalogOpen(open) {
  if (open) {
    hideOtherDrawers(catalogDrawer)
    loadCatalog()
  }
  catalogDrawer.hidden = !open
  setupBackdrop.hidden = !backdropVisible()
}

function setTeamsOpen(open) {
  if (open) {
    hideOtherDrawers(teamsDrawer)
    loadTeams()
  }
  teamsDrawer.hidden = !open
  setupBackdrop.hidden = !backdropVisible()
}

function closeAllDrawers() {
  for (const drawer of drawers()) drawer.hidden = true
  setupBackdrop.hidden = true
}

async function loadCatalog() {
  const payload = await fetch("/api/catalog").then((response) => response.json())
  const signedIn = Boolean(session?.user)
  catalogList.innerHTML = (payload.agents || [])
    .map((agent) => {
      const actions = [
        signedIn
          ? `<button type="button" data-duplicate="${escape(agent.name)}">Duplicate</button>`
          : "",
        agent.origin === "custom"
          ? `<button type="button" data-edit-catalog="${escape(agent.name)}">Edit</button>`
          : "",
      ]
        .filter(Boolean)
        .join(" ")
      return `<li>
        <div class="mem-kind">${escape(agent.origin)} · approval ${agent.needsApproval ? "yes" : "no"}</div>
        <strong>${escape(agent.title)}</strong>
        <div>${escape(agent.name)}${agent.tools?.length ? ` · tools ${escape(agent.tools.join(", "))}` : ""}</div>
        <div class="perm-actions">${actions || "<span class=\"drawer-lead\">Sign in to clone</span>"}</div>
      </li>`
    })
    .join("")
}

async function loadTeams() {
  const payload = await fetch("/api/teams").then((response) => response.json())
  const activeId = (await fetch("/api/room").then((r) => r.json())).teamId
  teamsList.innerHTML = (payload.teams || [])
    .map(
      (team) => `<li>
        <div class="mem-kind">${team.isDefault ? "default" : "workspace"}${
          team.id === activeId ? " · active" : ""
        }</div>
        <strong>${escape(team.name)}</strong>
        <div>${escape((team.agentNames || []).join(" → "))}</div>
        <div class="perm-actions"><button type="button" data-use-team="${escape(team.id)}">Use for room</button></div>
      </li>`,
    )
    .join("")
}

async function loadAgentCatalog() {
  const payload = await fetch("/api/dm").then((response) => response.json())
  agentList.innerHTML = (payload.agents || [])
    .map(
      (agent) =>
        `<li><button type="button" data-agent="${escape(agent.name)}" class="${
          agent.name === activeDmAgent ? "active" : ""
        }">${escape(agent.title)}</button></li>`,
    )
    .join("")
  if (activeDmAgent) await loadDm(activeDmAgent)
}

async function loadDm(agentName) {
  const payload = await fetch(`/api/dm/${encodeURIComponent(agentName)}`).then((response) =>
    response.json(),
  )
  if (payload.error) {
    dmTitle.textContent = payload.error
    dmForm.hidden = true
    return
  }
  dmTitle.textContent = payload.agent.title
  dmForm.hidden = false
  renderDmThread(payload.thread)
  for (const button of agentList.querySelectorAll("[data-agent]")) {
    button.classList.toggle("active", button.getAttribute("data-agent") === agentName)
  }
}

function renderDmThread(thread) {
  const messages = thread?.messages || []
  dmThread.innerHTML = messages.length
    ? messages
        .map(
          (msg) =>
            `<div class="dm-bubble ${msg.kind}"><p class="who">${escape(msg.title)}</p>${escape(
              msg.body,
            )}</div>`,
        )
        .join("")
    : `<p class="drawer-lead">No messages yet. Ask this agent about gaps, designs, or a Write plan.</p>`
  dmThread.scrollTop = dmThread.scrollHeight
}

async function loadMemory() {
  const payload = await fetch("/api/memory").then((response) => response.json())
  renderMemory(payload)
}

function renderMemory(store) {
  const entries = [...(store?.entries || [])].reverse().slice(0, 60)
  memoryList.innerHTML = entries.length
    ? entries
        .map(
          (item) => `<li>
            <div class="mem-kind">${escape(item.kind)} · ${escape(item.agent)} · ${escape(item.source)}</div>
            <strong>${escape(item.title)}</strong>
            <div>${escape(item.body)}</div>
          </li>`,
        )
        .join("")
    : `<li class="drawer-lead">No memory yet. Run the room or add a note.</li>`
}

async function post(url, body) {
  if (url !== "/api/room/reset") streaming = true
  reset.disabled = streaming
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  })
  const type = response.headers.get("content-type") || ""
  if (type.includes("application/json")) {
    const payload = await response.json()
    streaming = false
    reset.disabled = false
    if (!response.ok) {
      window.alert(payload.error || "Request failed")
      return
    }
    render(payload)
    return
  }

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
      if (event.type === "delta") appendDelta(event)
      if (event.type === "room") render(event.room)
      if (event.type === "error") window.alert(event.message)
    }
  }
  streaming = false
  reset.disabled = false
  const latest = await fetch("/api/room").then((response) => response.json())
  render(latest)
}

function appendDelta(event) {
  empty.hidden = true
  transcript.hidden = false
  let bubble = transcript.querySelector(`[data-live="${cssEscape(event.name)}"]`)
  if (!bubble) {
    const article = document.createElement("article")
    article.className = "message agent"
    article.innerHTML = `<p class="who"></p><div class="bubble" data-live=""></div>`
    article.querySelector(".who").textContent = event.title
    bubble = article.querySelector(".bubble")
    bubble.dataset.live = event.name
    transcript.appendChild(article)
  }
  bubble.textContent += event.text
  transcript.scrollTop = transcript.scrollHeight
}

function render(room) {
  engine.textContent = engineLabel[room.engine] || "Local drafts"
  confluenceUrl.value = room.confluencePageUrl || ""
  pastedBrd.value = room.pastedBrd || ""
  figmaUrl.value = room.figmaFileUrl || ""
  jiraBoardUrl.value = room.jiraBoardUrl || room.jiraProjectKey || ""
  deployEnv.value = room.deployEnv || ""
  deployUrl.value = room.deployUrl || ""
  jenkinsJob.value = room.jenkinsJob || ""
  requirementText.value = room.requirement || ""
  const started = room.stages.some((stage) => stage.status !== "pending")
  // BRS is fixed once the room starts. Figma/Jira/Git/Deploy can still be set for later roles.
  confluenceUrl.disabled = started || streaming
  pastedBrd.disabled = started || streaming
  sourceForm.querySelector("button").disabled = started || streaming
  requirementText.disabled = started || streaming
  requirementForm.querySelector("button").disabled = started || streaming
  figmaUrl.disabled = streaming
  gitRepoUrl.disabled = streaming
  gitBranch.disabled = streaming
  jiraBoardUrl.disabled = streaming
  deployEnv.disabled = streaming
  deployUrl.disabled = streaming
  jenkinsJob.disabled = streaming
  figmaForm.querySelector("button").disabled = streaming
  gitForm.querySelector("button").disabled = streaming
  jiraForm.querySelector("button").disabled = streaming
  deployForm.querySelector("button").disabled = streaming
  renderGitRepos(room.gitRepos || [], streaming)
  renderPermissions(room.permissions || [])
  const envBits = Object.entries(room.deploymentsByEnv || {}).map(
    ([envName, rec]) => `${envName}:${rec.smokeResult || "?"} `,
  )
  if (room.lastSmokeReport?.summary) {
    const smokeLine = `Last smoke: ${room.lastSmokeReport.result} — ${room.lastSmokeReport.summary}${
      envBits.length ? ` | ladder ${envBits.join("").trim()}` : ""
    }`
    if (!deployPreview.textContent || deployPreview.textContent.startsWith("Last smoke:") || deployPreview.textContent.startsWith("Saved:")) {
      deployPreview.textContent = smokeLine
    }
  } else if (envBits.length && !deployPreview.textContent) {
    deployPreview.textContent = `Env ladder: ${envBits.join("").trim()}`
  }

  chips.innerHTML = room.stages
    .map(
      (stage) =>
        `<div class="chip ${stage.status}"><span class="title">${escape(stage.title)}</span><span class="state">${label(stage.status)}</span></div>`,
    )
    .join("")

  const showEmpty = !started
  empty.hidden = !showEmpty
  transcript.hidden = showEmpty
  transcript.innerHTML = showEmpty ? "" : room.messages.map(renderMessage).join("")
  if (!showEmpty) transcript.scrollTop = transcript.scrollHeight
  renderComposer(room)
  watch(room)
}

function renderPermissions(items) {
  const pendingOrRecent = (items || []).filter((item) =>
    ["pending", "failed", "executed", "denied"].includes(item.status),
  )
  const visible = pendingOrRecent.slice(-12)
  permissionsPanel.hidden = visible.length === 0
  permissionList.innerHTML = visible
    .map((item) => {
      const actions =
        item.status === "pending"
          ? `<div class="perm-actions">
              <button type="button" class="approve" data-approve-perm="${escape(item.id)}">Approve write</button>
              <button type="button" class="deny" data-deny-perm="${escape(item.id)}">Deny</button>
            </div>`
          : `<div class="perm-meta">${escape(item.status)}${item.error ? ` — ${escape(item.error)}` : ""}</div>`
      return `<li>
        <div class="perm-meta">${escape(item.roleTitle)} · ${escape(item.system)}</div>
        <div class="perm-title">${escape(item.action)} → ${escape(item.target)}</div>
        <div class="perm-payload">${escape(item.payloadSummary)}</div>
        ${actions}
      </li>`
    })
    .join("")
}

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

function renderMessage(message) {
  const idLine = message.agentId
    ? `<p class="given">Cursor agent ${escape(message.agentId)}</p>`
    : ""
  const given = message.packet
    ? `<p class="given">Given: ${escape(givenLabel(message.packet))}</p>${renderPacket(message.packet)}`
    : ""
  return `<article class="message ${message.kind}"><p class="who">${escape(message.title)}</p><div class="bubble">${escape(message.body)}</div>${idLine}${given}</article>`
}

function givenLabel(packet) {
  const parts = []
  if (packet.sources?.length) {
    parts.push(packet.sources.map((source) => source.title).join(", "))
  }
  if (packet.givenStages.length) {
    parts.push(packet.givenStages.map((stage) => stage.title).join(", "))
  }
  if (!parts.length) return "the requirement and the project file"
  return parts.join(" + ")
}

function renderPacket(packet) {
  const stages = packet.givenStages
    .map((stage) => `${stage.title}\n${stage.output}`)
    .join("\n\n")
  const notes = packet.notes.length ? packet.notes.join("\n") : "None"
  const sources = (packet.sources || [])
    .map((source) => `${source.title}\n${source.url}\n\n${source.body}`)
    .join("\n\n")
  return `<details><summary>Context packet</summary><div class="packet-block">Role file: ${escape(packet.roleFile)}
Project file: ${escape(packet.projectFile)}

${escape(packet.projectMarkdown)}

Shared memory:
${escape(packet.memory || "None yet.")}

Sources for this role:
${escape(sources || "None")}

Notes from approvals:
${escape(notes)}

Earlier outputs:
${escape(stages || "None. This is the first role.")}</div></details>`
}

function renderComposer(room) {
  const waiting = room.stages.find((stage) => stage.status === "waiting_approval")
  const failed = room.stages.find((stage) => stage.status === "error")
  const writing = room.stages.find((stage) => stage.status === "running")
  const started = room.stages.some((stage) => stage.status !== "pending")
  const finished = room.stages.every((stage) => stage.status === "done")
  const count = room.stages.length

  if (streaming || writing) {
    composer.innerHTML = `<p>${escape((writing || waiting || {}).title || "A role")} is writing…</p>`
    composer.onsubmit = (event) => event.preventDefault()
    return
  }

  if (failed) {
    composer.innerHTML = `<p>Something failed.</p><button id="retry" type="submit">Retry ${escape(failed.title)}</button>`
    composer.onsubmit = (event) => {
      event.preventDefault()
      post("/api/room/retry")
    }
    return
  }

  if (!started) {
    const teamLabel = room.team?.name || "SDLC Sprint Team"
    const first = room.stages[0]?.title || "first role"
    composer.innerHTML = `<p>Team: ${escape(teamLabel)}</p><button id="start" type="submit">Start with ${escape(first)}</button>`
    composer.onsubmit = (event) => {
      event.preventDefault()
      post("/api/room/start")
    }
    return
  }

  if (waiting) {
    composer.innerHTML = `<input id="note" name="note" placeholder="Optional note for the next role" /><button type="submit">Approve ${escape(waiting.title)}</button>`
    composer.onsubmit = (event) => {
      event.preventDefault()
      post("/api/room/approve", { note: document.querySelector("#note").value })
    }
    return
  }

  composer.onsubmit = (event) => event.preventDefault()
  composer.innerHTML = finished
    ? `<p>All ${count} roles have saved an output. Reset to run the room again.</p>`
    : `<p>Working…</p>`
}

function watch(room) {
  if (polling || streaming) return
  if (!room.stages.some((stage) => stage.status === "running")) return
  polling = true
  setTimeout(async () => {
    polling = false
    if (streaming) return
    const next = await fetch("/api/room").then((response) => response.json())
    render(next)
  }, 1500)
}

function renderSession(next) {
  session = next
  if (next.atlassian.connected) {
    atlassianStatus.textContent = `Atlassian: ${next.atlassian.siteName}`
    atlassianStatus.classList.add("connected")
    connectAtlassian.hidden = true
    disconnectAtlassian.hidden = false
  } else {
    atlassianStatus.textContent = next.atlassianConfigured
      ? "Atlassian not connected"
      : "Set Atlassian client env vars to enable Connect"
    atlassianStatus.classList.remove("connected")
    connectAtlassian.hidden = !next.atlassianConfigured
    disconnectAtlassian.hidden = true
  }

  if (next.figma?.connected) {
    figmaStatus.textContent = `Figma: ${next.figma.userName}`
    figmaStatus.classList.add("connected")
    connectFigma.hidden = true
    disconnectFigma.hidden = false
  } else {
    figmaStatus.textContent = next.figmaConfigured
      ? "Figma not connected"
      : "Set Figma client env vars to enable Connect"
    figmaStatus.classList.remove("connected")
    connectFigma.hidden = !next.figmaConfigured
    disconnectFigma.hidden = true
  }

  if (next.github?.connected) {
    githubStatus.textContent = `GitHub: ${next.github.userLogin}`
    githubStatus.classList.add("connected")
    connectGitHub.hidden = true
    disconnectGitHub.hidden = false
  } else {
    githubStatus.textContent = next.githubConfigured
      ? "GitHub not connected"
      : "Set GitHub client env vars to enable Connect"
    githubStatus.classList.remove("connected")
    connectGitHub.hidden = !next.githubConfigured
    disconnectGitHub.hidden = true
  }
}

async function loadSession() {
  const next = await fetch("/api/session").then((response) => response.json())
  session = next
  renderSession(next)
  if (next.user) {
    accountStatus.textContent = next.user.name || next.user.email
    accountStatus.classList.add("connected")
    accountSignedIn.hidden = false
    accountUser.textContent = `${next.user.email} · ${next.workspace?.name || "workspace"} · ${next.user.role}`
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

function label(status) {
  if (status === "waiting_approval") return "Waiting"
  if (status === "running") return "Writing"
  if (status === "error") return "Needs retry"
  if (status === "done") return "Saved"
  return "Queued"
}

function escape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function cssEscape(value) {
  if (window.CSS && CSS.escape) return CSS.escape(value)
  return String(value).replaceAll('"', "")
}

Promise.all([fetch("/api/room").then((response) => response.json()), loadSession()]).then(([room]) => {
  render(room)
})
