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
    issueType: "Epic" | "Story" | "Subtask" | "Task"
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
