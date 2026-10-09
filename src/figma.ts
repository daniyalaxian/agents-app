export type FigmaCredential = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  userId: string
  userName: string
  userEmail: string
}

export type FigmaConfig = {
  clientId: string
  clientSecret: string
  redirectUri: string
}

// Read + comment write (comments only executed after human Approve).
const SCOPES = [
  "current_user:read",
  "file_metadata:read",
  "file_content:read",
  "file_comments:write",
].join(",")

/** Extract the file key from a Figma file/design/proto/board URL. */
export function fileKeyFromUrl(fileUrl: string): string | null {
  try {
    const parsed = new URL(fileUrl.trim())
    if (!parsed.hostname.endsWith("figma.com")) return null
    const parts = parsed.pathname.split("/").filter(Boolean)
    const kind = parts.findIndex((part) => part === "file" || part === "design" || part === "proto" || part === "board")
    if (kind === -1) return null
    const key = parts[kind + 1]
    return key && /^[a-zA-Z0-9]+$/.test(key) ? key : null
  } catch {
    return null
  }
}

/** Optional node-id from the Figma URL query (?node-id=1-2). */
export function nodeIdFromUrl(fileUrl: string): string | null {
  try {
    const parsed = new URL(fileUrl.trim())
    const raw = parsed.searchParams.get("node-id")
    if (!raw) return null
    return raw.replace(/-/g, ":")
  } catch {
    return null
  }
}

export function figmaConfig(baseUrl: string): FigmaConfig | null {
  const clientId = process.env.FIGMA_CLIENT_ID?.trim()
  const clientSecret = process.env.FIGMA_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  return {
    clientId,
    clientSecret,
    redirectUri: `${baseUrl.replace(/\/$/, "")}/auth/figma/callback`,
  }
}

export function authorizeUrl(config: FigmaConfig, state: string): string {
  const url = new URL("https://www.figma.com/oauth")
  url.searchParams.set("client_id", config.clientId)
  url.searchParams.set("redirect_uri", config.redirectUri)
  url.searchParams.set("scope", SCOPES)
  url.searchParams.set("state", state)
  url.searchParams.set("response_type", "code")
  return url.toString()
}

export async function exchangeCode(config: FigmaConfig, code: string): Promise<FigmaCredential> {
  const tokens = await tokenRequest(config, {
    redirect_uri: config.redirectUri,
    code,
    grant_type: "authorization_code",
  })
  if (!tokens.refresh_token) {
    throw new Error("Figma did not return a refresh token.")
  }
  const user = await fetchMe(tokens.access_token)
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    userId: user.id,
    userName: user.handle || user.email || "Figma user",
    userEmail: user.email || "",
  }
}

export async function refreshed(config: FigmaConfig, credential: FigmaCredential): Promise<FigmaCredential> {
  if (credential.expiresAt > Date.now() + 60_000) return credential
  const tokens = await refreshRequest(config, credential.refreshToken)
  return {
    ...credential,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || credential.refreshToken,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  }
}

type FigmaNode = {
  id?: string
  name?: string
  type?: string
  children?: FigmaNode[]
}

type FigmaFileResponse = {
  name?: string
  lastModified?: string
  document?: FigmaNode
  err?: string
  message?: string
}

/** Load a compact text summary of pages/frames for agent packets (not the full file JSON). */
export async function fetchFigmaFileSummary(
  credential: FigmaCredential,
  fileUrl: string,
): Promise<{ title: string; url: string; body: string }> {
  const fileKey = fileKeyFromUrl(fileUrl)
  if (!fileKey) {
    throw new Error("Invalid Figma file URL")
  }
  const nodeId = nodeIdFromUrl(fileUrl)
  const endpoint = new URL(`https://api.figma.com/v1/files/${fileKey}`)
  endpoint.searchParams.set("depth", "2")
  if (nodeId) endpoint.searchParams.set("ids", nodeId)

  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${credential.accessToken}` },
  })
  const body = (await response.json().catch(() => ({}))) as FigmaFileResponse
  if (!response.ok) {
    const detail = body.message || body.err || `Figma file read failed (${response.status})`
    if (response.status === 403) {
      throw new Error(
        `${detail}. Enable file_metadata:read and file_content:read on the Figma OAuth app, then Disconnect and Connect Figma again.`,
      )
    }
    throw new Error(detail)
  }

  const title = body.name || `Figma ${fileKey}`
  const lines = [
    `Figma file: ${title}`,
    `URL: ${fileUrl}`,
    `File key: ${fileKey}`,
    nodeId ? `Focus node: ${nodeId}` : "Focus node: (whole file)",
    body.lastModified ? `Last modified: ${body.lastModified}` : "",
    "",
    "Structure (pages / top frames):",
    ...summarizeNodes(body.document?.children ?? [], 0).slice(0, 80),
  ].filter(Boolean)

  return {
    title,
    url: fileUrl,
    body: lines.join("\n"),
  }
}

function summarizeNodes(nodes: FigmaNode[], depth: number): string[] {
  const pad = "  ".repeat(depth)
  const lines: string[] = []
  for (const node of nodes) {
    const label = `${pad}- [${node.type || "NODE"}] ${node.name || "(unnamed)"}${node.id ? ` (${node.id})` : ""}`
    lines.push(label)
    if (node.children?.length && depth < 1) {
      lines.push(...summarizeNodes(node.children, depth + 1))
    }
  }
  return lines
}

export async function addFigmaComment(
  credential: FigmaCredential,
  fileUrl: string,
  message: string,
): Promise<{ id: string }> {
  const fileKey = fileKeyFromUrl(fileUrl)
  if (!fileKey) throw new Error("Invalid Figma file URL")
  const nodeId = nodeIdFromUrl(fileUrl)
  const payload: Record<string, unknown> = { message }
  if (nodeId) {
    payload.client_meta = { node_id: nodeId, node_offset: { x: 0, y: 0 } }
  }
  const response = await fetch(`https://api.figma.com/v1/files/${fileKey}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credential.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })
  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string; err?: string }
  if (!response.ok || !body.id) {
    throw new Error(body.message || body.err || `Figma comment failed (${response.status})`)
  }
  return { id: String(body.id) }
}

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
  user_id_string?: string
}

type FigmaUser = {
  id: string
  handle: string
  email: string
}

async function fetchMe(accessToken: string): Promise<FigmaUser> {
  const response = await fetch("https://api.figma.com/v1/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const body = (await response.json().catch(() => ({}))) as Partial<FigmaUser> & { message?: string; err?: string }
  if (!response.ok) {
    throw new Error(body.message || body.err || `Figma /me failed (${response.status})`)
  }
  return {
    id: String(body.id ?? ""),
    handle: String(body.handle ?? ""),
    email: String(body.email ?? ""),
  }
}

async function tokenRequest(
  config: FigmaConfig,
  params: Record<string, string>,
): Promise<TokenResponse> {
  const response = await fetch("https://api.figma.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Authorization: basicAuth(config),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  })
  const body = (await response.json().catch(() => ({}))) as TokenResponse & { message?: string; error?: string }
  if (!response.ok || !body.access_token) {
    throw new Error(body.message || body.error || `Figma token exchange failed (${response.status})`)
  }
  return body
}

async function refreshRequest(config: FigmaConfig, refreshToken: string): Promise<TokenResponse> {
  const response = await fetch("https://api.figma.com/v1/oauth/refresh", {
    method: "POST",
    headers: {
      Authorization: basicAuth(config),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ refresh_token: refreshToken }),
  })
  const body = (await response.json().catch(() => ({}))) as TokenResponse & { message?: string; error?: string }
  if (!response.ok || !body.access_token) {
    throw new Error(body.message || body.error || `Figma token refresh failed (${response.status})`)
  }
  return body
}

function basicAuth(config: FigmaConfig): string {
  const raw = `${config.clientId}:${config.clientSecret}`
  return `Basic ${Buffer.from(raw).toString("base64")}`
}
