import fs from "node:fs"
import type { AtlassianCredential } from "./credentials.js"

export type ParsedJiraBoard = {
  projectKey: string
  boardUrl: string
  boardId: string | null
}

/** Parse a Jira software board or project URL, or a bare project key like ORD. */
export function parseJiraBoardUrl(input: string): ParsedJiraBoard | null {
  const raw = input.trim()
  if (!raw) return null

  if (/^[A-Z][A-Z0-9]+$/i.test(raw) && !raw.includes("/") && !raw.includes(".")) {
    const projectKey = raw.toUpperCase()
    return { projectKey, boardUrl: projectKey, boardId: null }
  }

  try {
    const parsed = new URL(raw)
    if (!parsed.hostname.includes("atlassian.net") && !parsed.hostname.includes("jira")) {
      if (
        !parsed.pathname.includes("/jira/") &&
        !parsed.pathname.includes("/browse/") &&
        !parsed.pathname.includes("/projects/")
      ) {
        return null
      }
    }

    const boardMatch = parsed.pathname.match(/\/projects\/([A-Za-z][A-Za-z0-9]+)\/boards\/(\d+)/i)
    if (boardMatch) {
      return {
        projectKey: boardMatch[1].toUpperCase(),
        boardUrl: raw,
        boardId: boardMatch[2],
      }
    }

    const softMatch = parsed.pathname.match(/\/jira\/software\/(?:c\/)?projects\/([A-Za-z][A-Za-z0-9]+)/i)
    if (softMatch) {
      const boardId = parsed.pathname.match(/\/boards\/(\d+)/i)?.[1] ?? null
      return {
        projectKey: softMatch[1].toUpperCase(),
        boardUrl: raw,
        boardId,
      }
    }

    const projectMatch = parsed.pathname.match(/\/projects\/([A-Za-z][A-Za-z0-9]+)/i)
    if (projectMatch) {
      return {
        projectKey: projectMatch[1].toUpperCase(),
        boardUrl: raw,
        boardId: null,
      }
    }

    const browseMatch = parsed.pathname.match(/\/browse\/([A-Za-z][A-Za-z0-9]+)/i)
    if (browseMatch) {
      return {
        projectKey: browseMatch[1].toUpperCase(),
        boardUrl: raw,
        boardId: null,
      }
    }
  } catch {
    return null
  }

  return null
}

export type CreatedIssue = {
  key: string
  id: string
  self: string
}

export async function createJiraIssue(
  credential: AtlassianCredential,
  input: {
    projectKey: string
    summary: string
    issueType: "Epic" | "Story" | "Subtask" | "Task" | "Bug"
    description?: string
    parentKey?: string
  },
): Promise<CreatedIssue> {
  const fields: Record<string, unknown> = {
    project: { key: input.projectKey },
    summary: input.summary.slice(0, 255),
    issuetype: { name: input.issueType },
    description: {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: input.description || input.summary }],
        },
      ],
    },
  }
  if (input.parentKey) {
    fields.parent = { key: input.parentKey }
  }

  const response = await fetch(`https://api.atlassian.com/ex/jira/${credential.cloudId}/rest/api/3/issue`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credential.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  })
  const body = (await response.json().catch(() => ({}))) as CreatedIssue & {
    errorMessages?: string[]
    errors?: Record<string, string>
    message?: string
  }
  if (!response.ok || !body.key) {
    const details =
      body.errorMessages?.join("; ") ||
      (body.errors ? Object.values(body.errors).join("; ") : "") ||
      body.message ||
      `Jira create issue failed (${response.status})`
    throw new Error(details)
  }
  return { key: body.key, id: body.id, self: body.self }
}

export function inferJiraIssueType(action: string, payloadSummary: string): "Epic" | "Story" | "Subtask" | "Task" {
  const text = `${action} ${payloadSummary}`.toLowerCase()
  if (text.includes("epic")) return "Epic"
  if (text.includes("subtask") || text.includes("sub-task")) return "Subtask"
  if (text.includes("story") || text.includes("stories")) return "Story"
  return "Task"
}

export function summaryFromPayload(payloadSummary: string, action: string): string {
  const cleaned = payloadSummary.replace(/\s+/g, " ").trim()
  if (cleaned && cleaned.toLowerCase() !== "n/a") return cleaned.slice(0, 255)
  return action.slice(0, 255)
}

/** Upload a file as an attachment on an issue (multipart; Jira requires the no-check header). */
export async function attachJiraFile(credential: AtlassianCredential, issueKey: string, filePath: string): Promise<string> {
  const form = new FormData()
  const name = filePath.split(/[\\/]/).pop() || "attachment.png"
  form.append("file", new Blob([fs.readFileSync(filePath)], { type: "image/png" }), name)
  const response = await fetch(
    `https://api.atlassian.com/ex/jira/${credential.cloudId}/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${credential.accessToken}`, Accept: "application/json", "X-Atlassian-Token": "no-check" },
      body: form,
    },
  )
  const body = (await response.json().catch(() => [])) as { id?: string }[] & { errorMessages?: string[] }
  if (!response.ok || !Array.isArray(body) || !body[0]?.id) {
    throw new Error((body as { errorMessages?: string[] }).errorMessages?.join("; ") || `Jira attachment failed (${response.status})`)
  }
  return String(body[0].id)
}

export type JiraSprint = { id: number; name: string; state: string; startDate?: string; endDate?: string }

/** Active and future sprints on a Jira Software board (Agile API). */
export async function listSprints(credential: AtlassianCredential, boardId: string): Promise<JiraSprint[]> {
  const sprints: JiraSprint[] = []
  for (let startAt = 0; startAt < 500; startAt += 50) {
    const response = await fetch(
      `https://api.atlassian.com/ex/jira/${credential.cloudId}/rest/agile/1.0/board/${encodeURIComponent(boardId)}/sprint?state=active,future&startAt=${startAt}&maxResults=50`,
      { headers: { Authorization: `Bearer ${credential.accessToken}`, Accept: "application/json" } },
    )
    const body = (await response.json().catch(() => ({}))) as {
      values?: JiraSprint[]
      isLast?: boolean
      errorMessages?: string[]
      message?: string
    }
    if (!response.ok) throw new Error(agileError(response.status, body.errorMessages?.join("; ") || body.message))
    sprints.push(...(body.values ?? []))
    if (body.isLast !== false) break
  }
  return sprints
}

/** Find a sprint by id or by (part of) its name, e.g. "Sprint 6". */
export function findSprint(sprints: JiraSprint[], wanted: string): JiraSprint | null {
  const text = wanted.trim().toLowerCase()
  const byId = sprints.find((sprint) => String(sprint.id) === text)
  if (byId) return byId
  const exact = sprints.find((sprint) => sprint.name.toLowerCase() === text)
  if (exact) return exact
  const partial = sprints.filter((sprint) => sprint.name.toLowerCase().includes(text))
  return partial.length === 1 ? partial[0] : null
}

/** Move issues into a sprint (they leave their current sprint or the backlog). */
export async function moveIssuesToSprint(
  credential: AtlassianCredential,
  sprintId: number,
  issueKeys: string[],
): Promise<void> {
  const response = await fetch(
    `https://api.atlassian.com/ex/jira/${credential.cloudId}/rest/agile/1.0/sprint/${sprintId}/issue`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ issues: issueKeys }),
    },
  )
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { errorMessages?: string[]; message?: string }
    throw new Error(agileError(response.status, body.errorMessages?.join("; ") || body.message))
  }
}

function agileError(status: number, detail?: string): string {
  if (status === 401 || status === 403) {
    return (
      `${detail || `Jira Software request failed (${status})`}. The Atlassian app needs the Jira Software scopes ` +
      "read:board-scope:jira-software, read:sprint:jira-software and write:sprint:jira-software: add them in the developer console, then Disconnect and Connect Atlassian."
    )
  }
  return detail || `Jira Software request failed (${status})`
}

/** Replace an issue's summary and/or description. Other fields (sprint, status) are not touched. */
export async function updateJiraIssue(
  credential: AtlassianCredential,
  issueKey: string,
  changes: { summary?: string; description?: string },
): Promise<void> {
  const fields: Record<string, unknown> = {}
  if (changes.summary?.trim()) fields.summary = changes.summary.trim().slice(0, 255)
  if (changes.description?.trim()) {
    fields.description = {
      type: "doc",
      version: 1,
      content: changes.description
        .trim()
        .split(/\n{2,}/)
        .map((paragraph) => ({ type: "paragraph", content: [{ type: "text", text: paragraph }] })),
    }
  }
  if (!Object.keys(fields).length) throw new Error("Nothing to update: give a summary or a description")
  const response = await fetch(
    `https://api.atlassian.com/ex/jira/${credential.cloudId}/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields }),
    },
  )
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { errorMessages?: string[]; errors?: Record<string, string> }
    throw new Error(
      body.errorMessages?.join("; ") ||
        (body.errors ? Object.values(body.errors).join("; ") : "") ||
        `Jira update failed (${response.status})`,
    )
  }
}

export async function addJiraComment(
  credential: AtlassianCredential,
  issueKey: string,
  text: string,
): Promise<{ id: string }> {
  const response = await fetch(
    `https://api.atlassian.com/ex/jira/${credential.cloudId}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        body: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text }],
            },
          ],
        },
      }),
    },
  )
  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string; errorMessages?: string[] }
  if (!response.ok || !body.id) {
    throw new Error(
      body.errorMessages?.join("; ") || body.message || `Jira comment failed (${response.status})`,
    )
  }
  return { id: String(body.id) }
}

export function issueKeyFromTarget(target: string): string | null {
  const match = target.toUpperCase().match(/\b([A-Z][A-Z0-9]+-\d+)\b/)
  return match?.[1] ?? null
}
