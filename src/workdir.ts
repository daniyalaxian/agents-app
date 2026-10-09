import fs from "node:fs"
import path from "node:path"
import type { GitRepoRef, Room } from "./types.js"

export type ProposedFile = {
  path: string
  content: string
  note: string
}

/** Local mirror root for a microservice repo. */
export function repoWorkdir(root: string, repo: GitRepoRef): string {
  const dir = path.join(root, "data", "workdir", `${repo.owner}__${repo.repo}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Pull file paths mentioned in Coding / Architecture outputs. */
export function extractProposedPaths(room: Room): string[] {
  const found = new Set<string>()
  for (const message of room.messages) {
    if (message.kind !== "agent" || !message.body) continue
    if (!/coding|architecture/i.test(message.title) && message.title !== "Coding" && message.title !== "Architecture") {
      // still scan all agent bodies for path-like lines
    }
    for (const match of message.body.matchAll(
      /(?:^|\n)\s*(?:[-*]\s*)?(?:Touch|File|Path|Update|Create)?\s*[`']?([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)[`']?/gi,
    )) {
      const p = match[1].replace(/^\.\//, "")
      if (p.includes("http") || p.startsWith("ORD-")) continue
      if (p.split("/").length >= 1 && p.includes(".")) found.add(p)
    }
    for (const match of message.body.matchAll(/`([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)`/g)) {
      const p = match[1]
      if (p.includes(".")) found.add(p)
    }
  }
  return [...found].slice(0, 20)
}

/**
 * Build commit files for a PR from the Write plan + prior Coding proposal.
 * Always includes an agent-room marker; adds stub implementation files when paths are known.
 */
export function buildPrFiles(input: {
  room: Room
  repo: GitRepoRef
  headBranch: string
  payloadSummary: string
  title: string
}): ProposedFile[] {
  const files: ProposedFile[] = []
  const marker = `.agent-room/${input.headBranch.replace(/\//g, "-")}.md`
  files.push({
    path: marker,
    content: [
      `# ${input.title}`,
      "",
      input.payloadSummary,
      "",
      `Room: ${input.room.id}`,
      `Repo: ${input.repo.owner}/${input.repo.repo}@${input.repo.branch}`,
      `Opened after human Approve write.`,
    ].join("\n"),
    note: "approval marker",
  })

  const paths = extractProposedPaths(input.room)
  const preferred = paths.filter(
    (p) =>
      /order|payment|status/i.test(p) ||
      /\.(tsx?|jsx?|vue|java|kt|cs|py|go)$/i.test(p),
  )
  const toWrite = (preferred.length ? preferred : paths).slice(0, 6)

  if (toWrite.length === 0) {
    files.push({
      path: "docs/agent-room/payment-status-change.md",
      content: defaultChangeDoc(input.room, input.payloadSummary),
      note: "change proposal doc (no concrete file paths in Coding output)",
    })
  } else {
    for (const filePath of toWrite) {
      files.push({
        path: filePath,
        content: stubForPath(filePath, input.payloadSummary, input.room.requirement),
        note: "implementation stub from Coding proposal",
      })
    }
  }

  return files
}

export function writeLocalMirror(root: string, repo: GitRepoRef, files: ProposedFile[]): string {
  const base = repoWorkdir(root, repo)
  for (const file of files) {
    const full = path.join(base, ...file.path.split("/"))
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, file.content, "utf8")
  }
  const summaryPath = path.join(base, ".agent-room", "last-diff-summary.md")
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true })
  fs.writeFileSync(
    summaryPath,
    files.map((file) => `- ${file.path} (${file.note})`).join("\n") + "\n",
    "utf8",
  )
  return base
}

function defaultChangeDoc(room: Room, payload: string): string {
  return [
    "# Payment status change proposal",
    "",
    room.requirement,
    "",
    "## From Write plan",
    payload,
    "",
    "## Intended behavior",
    "- Show Paid / Pending / Failed from payments client",
    "- Show Status unavailable when read fails",
    "- No new dependencies; no checkout/refund/ledger edits",
    "",
    "Replace this doc with real file edits in a follow-up Commit when Cursor workdir coding is enabled.",
  ].join("\n")
}

function stubForPath(filePath: string, payload: string, requirement: string): string {
  const lower = filePath.toLowerCase()
  if (/\.(tsx|jsx)$/.test(lower)) {
    return `/** Agent Room stub — ${requirement.slice(0, 80)} */\n` +
      `export function PaymentStatusLine({ status }: { status: "Paid" | "Pending" | "Failed" | "unavailable" }) {\n` +
      `  if (status === "unavailable") return <span>Status unavailable</span>\n` +
      `  return <span>{status}</span>\n` +
      `}\n\n` +
      `// Write plan: ${payload.slice(0, 200)}\n`
  }
  if (/\.(ts|js)$/.test(lower)) {
    return `/** Agent Room stub — payment status binding */\n` +
      `export type PaymentStatus = "Paid" | "Pending" | "Failed"\n\n` +
      `export function formatPaymentStatus(status: PaymentStatus | null | undefined): string {\n` +
      `  if (!status) return "Status unavailable"\n` +
      `  return status\n` +
      `}\n\n` +
      `// ${payload.slice(0, 200)}\n`
  }
  if (/\.(java|kt|cs)$/.test(lower)) {
    return `// Agent Room stub: map payments client → Paid|Pending|Failed|Status unavailable\n// ${payload.slice(0, 160)}\n`
  }
  if (/\.md$/.test(lower)) {
    return `# Change\n\n${requirement}\n\n${payload}\n`
  }
  return `// Agent Room change for: ${requirement.slice(0, 100)}\n// ${payload.slice(0, 200)}\n`
}

export function extractJiraKeys(text: string): string[] {
  const keys = new Set<string>()
  for (const match of text.matchAll(/\b([A-Z][A-Z0-9]+-\d+)\b/g)) {
    keys.add(match[1])
  }
  return [...keys]
}
