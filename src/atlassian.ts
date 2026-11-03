import type { AtlassianCredential } from "./credentials.js"
import type { SourceDoc } from "./types.js"

// Confluence page read + Jira read for board/project context.
// Ticket create/update scopes are added later and only used after human approval.
const SCOPES = [
  "read:page:confluence",
  "write:comment:confluence",
  "read:jira-work",
  "read:jira-user",
  "write:jira-work",
  "offline_access",
].join(" ")

export type AtlassianConfig = {
  clientId: string
  clientSecret: string
  redirectUri: string
}

type AtlassianSite = {
  id: string
  url: string
  name: string
}

export function atlassianConfig(baseUrl: string): AtlassianConfig | null {
  const clientId = process.env.ATLASSIAN_CLIENT_ID?.trim()
  const clientSecret = process.env.ATLASSIAN_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  return {
    clientId,
    clientSecret,
    redirectUri: `${baseUrl.replace(/\/$/, "")}/auth/atlassian/callback`,
  }
}

export function authorizeUrl(config: AtlassianConfig, state: string): string {
  const url = new URL("https://auth.atlassian.com/authorize")
  url.searchParams.set("audience", "api.atlassian.com")
  url.searchParams.set("client_id", config.clientId)
  // Atlassian refuses consent when a requested scope is not enabled on the app, so optional scopes
  // (comment reading, Jira Software sprints) come from .env once they are added in the console.
  const extra = (process.env.ATLASSIAN_EXTRA_SCOPES ?? "").split(/[\s,]+/).filter(Boolean)
  url.searchParams.set("scope", [...new Set([...SCOPES.split(" "), ...extra])].join(" "))
  url.searchParams.set("redirect_uri", config.redirectUri)
  url.searchParams.set("state", state)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("prompt", "consent")
  return url.toString()
}

export async function exchangeCode(config: AtlassianConfig, code: string): Promise<AtlassianCredential> {
  const tokens = await tokenRequest(config, {
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  })
  if (!tokens.refresh_token) {
    throw new Error("Atlassian did not return a refresh token. Ensure offline_access is granted.")
  }
  const site = await pickSite(tokens.access_token)
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    cloudId: site.id,
    siteUrl: site.url,
    siteName: site.name,
  }
}

export async function refreshed(
  config: AtlassianConfig,
  credential: AtlassianCredential,
): Promise<AtlassianCredential> {
  if (credential.expiresAt > Date.now() + 60_000) return credential
  const tokens = await tokenRequest(config, {
    grant_type: "refresh_token",
    refresh_token: credential.refreshToken,
  })
  return {
    ...credential,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || credential.refreshToken,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  }
}

export function pageIdFromUrl(pageUrl: string): string | null {
  const pages = pageUrl.match(/\/pages\/(?:edit-v2\/)?(\d+)/)
  if (pages) return pages[1]
  const query = pageUrl.match(/[?&]pageId=(\d+)/)
  if (query) return query[1]
  return null
}

export async function addConfluenceFooterComment(
  credential: AtlassianCredential,
  pageUrl: string,
  text: string,
): Promise<{ id: string }> {
  const pageId = pageIdFromUrl(pageUrl)
  if (!pageId) throw new Error("Confluence page URL is missing a page id")

  const sites = await listSites(credential.accessToken)
  const cloudId = cloudIdForPageUrl(pageUrl, sites) ?? credential.cloudId
  const response = await fetch(`https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/footer-comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credential.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pageId,
      body: {
        representation: "storage",
        value: `<p>${escapeXml(text)}</p>`,
      },
    }),
  })
  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string }
  if (!response.ok || !body.id) {
    throw new Error(body.message || `Confluence comment failed (${response.status})`)
  }
  return { id: String(body.id) }
}

/** Footer comments on a Confluence page, newest last, as plain text. Needs the read:comment:confluence scope. */
export async function listConfluenceFooterComments(credential: AtlassianCredential, pageUrl: string): Promise<string> {
  const pageId = pageIdFromUrl(pageUrl)
  if (!pageId) throw new Error("Confluence page URL is missing a page id")
  const sites = await listSites(credential.accessToken)
  const cloudId = cloudIdForPageUrl(pageUrl, sites) ?? credential.cloudId
  const response = await fetch(
    `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages/${pageId}/footer-comments?body-format=storage&limit=100`,
    { headers: { Authorization: `Bearer ${credential.accessToken}`, Accept: "application/json" } },
  )
  const body = (await response.json().catch(() => ({}))) as {
    results?: { id: string; version?: { createdAt?: string }; body?: { storage?: { value?: string } } }[]
    message?: string
  }
  if (!response.ok) {
    const detail = body.message || `Reading Confluence comments failed (${response.status})`
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `${detail}. The Atlassian app needs the granular scope read:comment:confluence: add it in the developer console, then Disconnect and Connect Atlassian.`,
      )
    }
    throw new Error(detail)
  }
  const comments = body.results ?? []
  if (!comments.length) return "No footer comments on this page."
  return comments
    .map((comment) => {
      const text = (comment.body?.storage?.value ?? "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .trim()
      return `- Comment ${comment.id}${comment.version?.createdAt ? ` (${comment.version.createdAt})` : ""}:\n  ${text.replace(/\n/g, "\n  ")}`
    })
    .join("\n")
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("\n", "<br />")
}

export async function fetchConfluencePage(credential: AtlassianCredential, pageUrl: string): Promise<SourceDoc> {
  const pageId = pageIdFromUrl(pageUrl)
  if (!pageId) {
    throw new Error(
      "Use a normal Confluence page link that contains /pages/<number>/, for example …/wiki/spaces/ORD/pages/123456/Title",
    )
  }

  const sites = await listSites(credential.accessToken)
  const matchedCloudId = cloudIdForPageUrl(pageUrl, sites)
  if (!matchedCloudId && safeHost(pageUrl)) {
    const hosts = sites.map((item) => safeHost(item.url)).filter(Boolean).join(", ")
    throw new Error(
      `That page is on ${safeHost(pageUrl)}, but this login only covers: ${hosts || "no sites"}. Disconnect Atlassian and connect again, choosing the site that owns the page.`,
    )
  }
  const cloudId = matchedCloudId ?? credential.cloudId
  const site = sites.find((item) => item.id === cloudId)

  const response = await fetch(
    `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages/${pageId}?body-format=view`,
    {
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        Accept: "application/json",
      },
    },
  )

  if (response.ok) {
    const page = (await response.json()) as {
      id: string
      title: string
      body?: { view?: { value?: string } }
    }
    return {
      kind: "confluence",
      title: page.title,
      url: pageUrl,
      body: htmlToText(page.body?.view?.value ?? ""),
    }
  }

  const detail = await readError(response)
  if (response.status === 401 && detail.includes("scope does not match")) {
    throw new Error(
      "Confluence page API needs the Granular scope View pages (read:page:confluence). In the developer console open Permissions → Confluence API → Granular scopes (not Classic), add View pages, Save, then Disconnect and Connect again. Or paste the BRS text into the room instead.",
    )
  }
  if (response.status === 404) {
    throw new Error(
      `Confluence could not find page ${pageId} on ${site?.name || credential.siteName}. ${detail}`,
    )
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(`Confluence denied access to that page. ${detail}`)
  }
  throw new Error(`Confluence returned ${response.status}. ${detail}`)
}

function cloudIdForPageUrl(pageUrl: string, sites: AtlassianSite[]): string | null {
  const host = safeHost(pageUrl)
  if (!host) return null
  const match = sites.find((site) => safeHost(site.url) === host)
  return match?.id ?? null
}

function safeHost(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return null
  }
}

async function listSites(accessToken: string): Promise<AtlassianSite[]> {
  const response = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  })
  if (!response.ok) throw new Error(`Atlassian site lookup failed (${response.status})`)
  return (await response.json()) as AtlassianSite[]
}

async function pickSite(accessToken: string): Promise<AtlassianSite> {
  const sites = await listSites(accessToken)
  if (!sites.length) throw new Error("No Atlassian site was granted to this login")
  return sites[0]
}

async function readError(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim()
    return text ? text.slice(0, 240) : ""
  } catch {
    return ""
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

async function tokenRequest(
  config: AtlassianConfig,
  body: Record<string, string>,
): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const response = await fetch("https://auth.atlassian.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...body,
    }),
  })
  if (!response.ok) {
    throw new Error(`Atlassian token exchange failed (${response.status})`)
  }
  return (await response.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }
}
