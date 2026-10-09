export type GitHubCredential = {
  accessToken: string
  userId: string
  userLogin: string
  userName: string
}

export type GitHubConfig = {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export type ParsedRepo = {
  owner: string
  repo: string
  url: string
}

// Identity + repo access for PR creation after human Approve.
const SCOPES = ["read:user", "repo"].join(" ")

export function githubConfig(baseUrl: string): GitHubConfig | null {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim()
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  return {
    clientId,
    clientSecret,
    redirectUri: `${baseUrl.replace(/\/$/, "")}/auth/github/callback`,
  }
}

export function authorizeUrl(config: GitHubConfig, state: string): string {
  const url = new URL("https://github.com/login/oauth/authorize")
  url.searchParams.set("client_id", config.clientId)
  url.searchParams.set("redirect_uri", config.redirectUri)
  url.searchParams.set("scope", SCOPES)
  url.searchParams.set("state", state)
  return url.toString()
}

export async function exchangeCode(config: GitHubConfig, code: string): Promise<GitHubCredential> {
  const tokens = await tokenRequest(config, code)
  const user = await fetchUser(tokens.access_token)
  return {
    accessToken: tokens.access_token,
    userId: String(user.id),
    userLogin: user.login,
    userName: user.name || user.login,
  }
}

/** Parse https://github.com/owner/repo or git@ / .git variants. */
export function parseRepoUrl(repoUrl: string): ParsedRepo | null {
  const raw = repoUrl.trim()
  if (!raw) return null

  let owner = ""
  let repo = ""

  try {
    if (raw.startsWith("git@github.com:")) {
      const path = raw.slice("git@github.com:".length).replace(/\.git$/i, "")
      const parts = path.split("/").filter(Boolean)
      owner = parts[0] ?? ""
      repo = parts[1] ?? ""
    } else {
      const parsed = new URL(raw)
      if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") return null
      const parts = parsed.pathname.split("/").filter(Boolean)
      owner = parts[0] ?? ""
      repo = (parts[1] ?? "").replace(/\.git$/i, "")
    }
  } catch {
    return null
  }

  if (!owner || !repo || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    return null
  }

  return {
    owner,
    repo,
    url: `https://github.com/${owner}/${repo}`,
  }
}

export function normalizeBranch(branch: string): string | null {
  const value = branch.trim()
  if (!value) return null
  if (value.length > 255) return null
  if (value.includes("..") || value.includes(" ") || value.includes("\\")) return null
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) return null
  return value
}

type TokenResponse = {
  access_token?: string
  error?: string
  error_description?: string
}

type GitHubUser = {
  id: number
  login: string
  name: string | null
}

async function tokenRequest(config: GitHubConfig, code: string): Promise<{ access_token: string }> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
  })
  const body = (await response.json().catch(() => ({}))) as TokenResponse
  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description || body.error || `GitHub token exchange failed (${response.status})`)
  }
  return { access_token: body.access_token }
}

async function fetchUser(accessToken: string): Promise<GitHubUser> {
  const response = await fetch("https://api.github.com/user", {
    headers: githubHeaders(accessToken),
  })
  const body = (await response.json().catch(() => ({}))) as Partial<GitHubUser> & { message?: string }
  if (!response.ok || !body.login) {
    throw new Error(body.message || `GitHub /user failed (${response.status})`)
  }
  return {
    id: Number(body.id),
    login: String(body.login),
    name: body.name ? String(body.name) : null,
  }
}

function githubHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "Agent-Room",
    "X-GitHub-Api-Version": "2022-11-28",
  }
}

export type PrFileInput = {
  path: string
  content: string
}

export async function openPullRequestFromBase(input: {
  accessToken: string
  owner: string
  repo: string
  baseBranch: string
  headBranch: string
  title: string
  body: string
  files?: PrFileInput[]
}): Promise<{ number: number; htmlUrl: string; head: string; filesCommitted: string[] }> {
  const baseRef = await githubJson<{ object: { sha: string } }>(
    input.accessToken,
    `https://api.github.com/repos/${input.owner}/${input.repo}/git/ref/heads/${encodeURIComponent(input.baseBranch)}`,
  )
  const baseSha = baseRef.object.sha

  // Create head branch from base when missing.
  const createRef = await fetch(
    `https://api.github.com/repos/${input.owner}/${input.repo}/git/refs`,
    {
      method: "POST",
      headers: { ...githubHeaders(input.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ ref: `refs/heads/${input.headBranch}`, sha: baseSha }),
    },
  )
  if (!createRef.ok && createRef.status !== 422) {
    const err = (await createRef.json().catch(() => ({}))) as { message?: string }
    throw new Error(err.message || `GitHub create branch failed (${createRef.status})`)
  }

  const files =
    input.files && input.files.length > 0
      ? input.files
      : [
          {
            path: `.agent-room/${input.headBranch.replace(/\//g, "-")}.md`,
            content: `${input.body}\n`,
          },
        ]

  const committed: string[] = []
  for (const file of files) {
    const cleanPath = file.path.replace(/^\/+/, "")
    const existingSha = await contentsSha(
      input.accessToken,
      input.owner,
      input.repo,
      cleanPath,
      input.headBranch,
    )
    await githubJson(
      input.accessToken,
      `https://api.github.com/repos/${input.owner}/${input.repo}/contents/${cleanPath
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
      {
        method: "PUT",
        body: JSON.stringify({
          message: `${input.title}: ${cleanPath}`,
          content: Buffer.from(file.content, "utf8").toString("base64"),
          branch: input.headBranch,
          ...(existingSha ? { sha: existingSha } : {}),
        }),
      },
    )
    committed.push(cleanPath)
  }

  const pr = await githubJson<{ number: number; html_url: string }>(
    input.accessToken,
    `https://api.github.com/repos/${input.owner}/${input.repo}/pulls`,
    {
      method: "POST",
      body: JSON.stringify({
        title: input.title,
        head: input.headBranch,
        base: input.baseBranch,
        body: input.body,
      }),
    },
  )
  return { number: pr.number, htmlUrl: pr.html_url, head: input.headBranch, filesCommitted: committed }
}

async function contentsSha(
  accessToken: string,
  owner: string,
  repo: string,
  filePath: string,
  branch: string,
): Promise<string | null> {
  const url =
    `https://api.github.com/repos/${owner}/${repo}/contents/${filePath
      .split("/")
      .map(encodeURIComponent)
      .join("/")}?ref=${encodeURIComponent(branch)}`
  const response = await fetch(url, { headers: githubHeaders(accessToken) })
  if (response.status === 404) return null
  const body = (await response.json().catch(() => ({}))) as { sha?: string; message?: string }
  if (!response.ok) return null
  return body.sha || null
}

async function githubJson<T>(
  accessToken: string,
  url: string,
  init?: { method?: string; body?: string },
): Promise<T> {
  const response = await fetch(url, {
    method: init?.method || "GET",
    headers: {
      ...githubHeaders(accessToken),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body,
  })
  const body = (await response.json().catch(() => ({}))) as T & { message?: string }
  if (!response.ok) {
    throw new Error(body.message || `GitHub API failed (${response.status}) for ${url}`)
  }
  return body
}
