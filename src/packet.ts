import type { MemoryEntry, SourceDoc } from "./types.js"

/** Max characters of one prior role's output kept in the prompt (TOK-3). */
export const HANDOFF_MAX_CHARS = 2_800

/** Max characters of a pasted source body in the prompt (TOK-4). Folders stay by reference. */
export const SOURCE_BODY_MAX_CHARS = 6_000

/** How many memory rows go into a packet (TOK-9). */
export const MEMORY_PACKET_LIMIT = 20

const KIND_PRIORITY: Record<string, number> = {
  gap: 0,
  decision: 1,
  test: 2,
  write_plan: 3,
  approval: 4,
  pr: 5,
  finding: 6,
  note: 7,
}

/**
 * Compact a finished role output for the next role's prompt.
 * Keeps gaps, tests, decisions, Write plans, and short excerpts — not the full draft.
 */
export function summarizeHandoff(output: string, maxChars = HANDOFF_MAX_CHARS): string {
  const text = (output || "").trim()
  if (!text) return "(empty)"
  if (text.length <= maxChars) return text

  const parts: string[] = []
  const gaps = text
    .split(/\r?\n/)
    .filter((line) => /\bGAP-\d+\b/i.test(line))
    .slice(0, 40)
  if (gaps.length) {
    parts.push("### Gaps / findings", ...gaps.map((line) => line.trim()))
  }

  const tests = [...text.matchAll(/\b((?:TEST|UNIT)-\d+)\b/gi)].map((m) => m[1].toUpperCase())
  const uniqueTests = [...new Set(tests)]
  if (uniqueTests.length) {
    parts.push("### Tests mentioned", uniqueTests.join(", "))
  }

  const decision = sliceSection(text, /^##\s+Decision\b/im)
  if (decision) parts.push(clip(decision, 900))

  const writePlan = sliceSection(text, /^##\s+Write plan\b/im)
  if (writePlan) parts.push(clip(writePlan, 1_200))

  const backlog = sliceSection(text, /^##\s+Proposed Jira backlog\b/im)
  if (backlog) parts.push(clip(backlog, 600))

  // Opening context if we still have room.
  const opening = text.slice(0, 500).trim()
  if (opening && !parts.join("\n").includes(opening.slice(0, 80))) {
    parts.unshift("### Opening", opening + (text.length > 500 ? "…" : ""))
  }

  let summary = parts.join("\n\n").trim()
  if (!summary) summary = clip(text, maxChars)

  if (summary.length > maxChars) summary = clip(summary, maxChars)
  if (summary.length < text.length) {
    summary += `\n\n_(Hand-off summary: ${text.length} → ${summary.length} chars. Full output stays on the stage message.)_`
  }
  return summary
}

/** Format sources for the prompt: folders by path only; large bodies clipped (TOK-4). */
export function formatSourcesForPrompt(sources: SourceDoc[]): string {
  if (!sources.length) return "None."
  return sources
    .map((source) => {
      const header = `## ${source.title}\nURL: ${source.url}`
      if (source.localPath) {
        return `${header}\nReadable folder: ${source.localPath}\nRead the files your instructions name. Nothing from this folder is pasted below.`
      }
      const body = source.body || ""
      if (body.length <= SOURCE_BODY_MAX_CHARS) {
        return `${header}\n\n${body}`
      }
      return `${header}\n\n${body.slice(0, SOURCE_BODY_MAX_CHARS)}\n\n…(source truncated at ${SOURCE_BODY_MAX_CHARS} chars for tokens; ask for the missing section if needed)`
    })
    .join("\n\n")
}

/**
 * Pick the most useful memory rows for a packet: gaps/decisions/tests first,
 * then recent others; dedupe by kind+title (TOK-9).
 */
export function selectMemoryForPacket(entries: MemoryEntry[], limit = MEMORY_PACKET_LIMIT): MemoryEntry[] {
  if (!entries.length) return []
  const seen = new Set<string>()
  const ranked = [...entries].sort((a, b) => {
    const pa = KIND_PRIORITY[a.kind] ?? 9
    const pb = KIND_PRIORITY[b.kind] ?? 9
    if (pa !== pb) return pa - pb
    return b.at.localeCompare(a.at)
  })
  const picked: MemoryEntry[] = []
  for (const entry of ranked) {
    const key = `${entry.kind}:${entry.title.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    picked.push(entry)
    if (picked.length >= limit) break
  }
  return picked
}

function sliceSection(text: string, heading: RegExp): string | null {
  const match = text.match(heading)
  if (!match || match.index === undefined) return null
  const start = match.index
  const rest = text.slice(start)
  const next = rest.slice(match[0].length).search(/\n##\s+/)
  return next === -1 ? rest.trim() : rest.slice(0, match[0].length + next).trim()
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max).trimEnd() + "…"
}
