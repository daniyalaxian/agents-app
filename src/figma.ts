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

/** How a Figma API call authenticates: the person's OAuth login or a personal access token. */
export type FigmaAuth = {
  headers: Record<string, string>
  /** Who the call runs as, for error messages. */
  who: string
}

export function oauthAuth(credential: FigmaCredential): FigmaAuth {
  return {
    headers: { Authorization: `Bearer ${credential.accessToken}` },
    who: credential.userEmail || credential.userName,
  }
}

/** FIGMA_ACCESS_TOKEN (personal access token) is used instead of OAuth when it is set. */
export function tokenAuth(): FigmaAuth | null {
  const token = process.env.FIGMA_ACCESS_TOKEN?.trim()
  return token ? { headers: { "X-Figma-Token": token }, who: "the personal access token in FIGMA_ACCESS_TOKEN" } : null
}

// Read + comment write (comments only executed after human Approve).
export const SCOPES = [
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

/** GET a Figma REST path and return JSON, with a readable error for denied access. */
async function figmaGet<T>(auth: FigmaAuth, path: string): Promise<T> {
  const response = await fetch(`https://api.figma.com${path}`, { headers: auth.headers })
  const body = (await response.json().catch(() => ({}))) as T & { message?: string; err?: string }
  if (!response.ok) {
    const detail = body.message || body.err || `Figma request failed (${response.status})`
    if (response.status === 403) {
      throw new Error(
        `${detail}: ${auth.who} cannot open this file through the Figma API. ` +
          "Check that this account can open the file in Figma and that your Figma organization allows API access.",
      )
    }
    throw new Error(detail)
  }
  return body
}

function requireFileKey(fileUrl: string): string {
  const fileKey = fileKeyFromUrl(fileUrl)
  if (!fileKey) throw new Error("Invalid Figma file URL")
  return fileKey
}

/** Accepts "13397:1590" or the URL form "13397-1590". */
export function normalizeNodeId(nodeId: string): string {
  return nodeId.trim().replace(/-/g, ":")
}

/** Load a compact text summary of pages/frames for agent packets (not the full file JSON). */
export async function fetchFigmaFileSummary(
  auth: FigmaAuth,
  fileUrl: string,
): Promise<{ title: string; url: string; body: string }> {
  const fileKey = requireFileKey(fileUrl)
  const nodeId = nodeIdFromUrl(fileUrl)
  const query = new URLSearchParams({ depth: "2" })
  if (nodeId) query.set("ids", nodeId)
  const body = await figmaGet<FigmaFileResponse>(auth, `/v1/files/${fileKey}?${query}`)

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

/** Agent read tool: pages and their top-level frames, with ids to pass to the other tools. */
export async function listFigmaFrames(auth: FigmaAuth, fileUrl: string, page?: string): Promise<string> {
  const fileKey = requireFileKey(fileUrl)
  const body = await figmaGet<FigmaFileResponse>(auth, `/v1/files/${fileKey}?depth=2`)
  const wanted = page?.trim().toLowerCase()
  const pages = (body.document?.children ?? []).filter(
    (item) => !wanted || item.name?.toLowerCase().includes(wanted) || item.id === page,
  )
  if (!pages.length) return wanted ? `No page matching "${page}".` : "The file has no pages."
  const lines = [`Figma file: ${body.name ?? fileKey}`]
  for (const item of pages) {
    lines.push(`\n## Page: ${item.name} (${item.id})`)
    const frames = item.children ?? []
    if (!frames.length) lines.push("- (empty page)")
    for (const frame of frames.slice(0, 150)) lines.push(`- [${frame.type}] ${frame.name} (${frame.id})`)
    if (frames.length > 150) lines.push(`- … ${frames.length - 150} more`)
  }
  return lines.join("\n")
}

type FigmaDetailNode = FigmaNode & {
  characters?: string
  absoluteBoundingBox?: { width: number; height: number }
}

/** Agent read tool: one frame's layer outline and all of its visible text. */
export async function readFigmaFrame(auth: FigmaAuth, fileUrl: string, nodeId: string): Promise<string> {
  const fileKey = requireFileKey(fileUrl)
  const id = normalizeNodeId(nodeId)
  const body = await figmaGet<{ nodes?: Record<string, { document?: FigmaDetailNode } | null> }>(
    auth,
    `/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(id)}`,
  )
  const root = body.nodes?.[id]?.document
  if (!root) return `No node ${id} in this file. Use figma_list_frames to find frame ids.`

  const outline: string[] = []
  const texts: string[] = []
  const walk = (node: FigmaDetailNode, depth: number) => {
    if (depth <= 3 && outline.length < 120) {
      const size = node.absoluteBoundingBox
        ? ` ${Math.round(node.absoluteBoundingBox.width)}×${Math.round(node.absoluteBoundingBox.height)}`
        : ""
      outline.push(`${"  ".repeat(depth)}- [${node.type}] ${node.name}${size}`)
    }
    if (node.type === "TEXT" && node.characters?.trim() && texts.length < 400) {
      texts.push(`- ${node.characters.trim().replace(/\s+/g, " ")}`)
    }
    for (const child of (node.children ?? []) as FigmaDetailNode[]) walk(child, depth + 1)
  }
  walk(root, 0)
  return [
    `Frame: ${root.name} (${id})`,
    "",
    "## Layers",
    ...outline,
    "",
    "## Text on this frame",
    ...(texts.length ? texts : ["(no text layers)"]),
  ]
    .join("\n")
    .slice(0, 20000)
}

/** Agent read tool: a PNG render of one frame, so the agent can see the screen. */
export async function renderFigmaFrame(
  auth: FigmaAuth,
  fileUrl: string,
  nodeId: string,
): Promise<{ data: string; mimeType: string; scale: number }> {
  const fileKey = requireFileKey(fileUrl)
  const id = normalizeNodeId(nodeId)
  const maxBytes = 3_500_000
  for (const scale of [1, 0.5, 0.25]) {
    const body = await figmaGet<{ images?: Record<string, string | null>; err?: string | null }>(
      auth,
      `/v1/images/${fileKey}?ids=${encodeURIComponent(id)}&format=png&scale=${scale}`,
    )
    const imageUrl = body.images?.[id]
    if (!imageUrl) throw new Error(`Figma could not render node ${id}. Use figma_list_frames to find frame ids.`)
    const image = await fetch(imageUrl)
    if (!image.ok) throw new Error(`Downloading the render failed (${image.status})`)
    const bytes = Buffer.from(await image.arrayBuffer())
    if (bytes.length <= maxBytes) return { data: bytes.toString("base64"), mimeType: "image/png", scale }
  }
  throw new Error(`Frame ${id} is too large to render. Read it with figma_read_frame, or pick a smaller frame.`)
}

export async function addFigmaComment(
  auth: FigmaAuth,
  fileUrl: string,
  message: string,
): Promise<{ id: string }> {
  const fileKey = requireFileKey(fileUrl)
  const nodeId = nodeIdFromUrl(fileUrl)
  const payload: Record<string, unknown> = { message }
  if (nodeId) {
    payload.client_meta = { node_id: nodeId, node_offset: { x: 0, y: 0 } }
  }
  const response = await fetch(`https://api.figma.com/v1/files/${fileKey}/comments`, {
    method: "POST",
    headers: {
      ...auth.headers,
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
