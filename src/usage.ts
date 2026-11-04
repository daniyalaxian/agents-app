/** Token / prompt accounting for a single agent turn (TOK-1). */

export type StageUsage = {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  reasoningTokens?: number
  /** Characters in the prompt we sent (always known). */
  promptChars: number
  /** sdk = Cursor reported counts; estimate = chars/4 fallback (draft or missing usage). */
  source: "sdk" | "estimate"
}

export type RunUsageSummary = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  promptChars: number
  stagesWithUsage: number
}

/** Rough token estimate when the runtime does not report usage (~4 chars / token). */
export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4)
}

export function estimateUsage(prompt: string, output: string, model: string): StageUsage {
  const inputTokens = estimateTokens(prompt)
  const outputTokens = estimateTokens(output)
  return {
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: inputTokens + outputTokens,
    promptChars: prompt.length,
    source: "estimate",
  }
}

export function fromSdkUsage(
  prompt: string,
  model: string,
  reported: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    totalTokens: number
    reasoningTokens?: number
  },
): StageUsage {
  return {
    model,
    inputTokens: reported.inputTokens,
    outputTokens: reported.outputTokens,
    cacheReadTokens: reported.cacheReadTokens,
    cacheWriteTokens: reported.cacheWriteTokens,
    totalTokens: reported.totalTokens,
    ...(reported.reasoningTokens != null ? { reasoningTokens: reported.reasoningTokens } : {}),
    promptChars: prompt.length,
    source: "sdk",
  }
}

export function sumUsage(usages: Array<StageUsage | null | undefined>): RunUsageSummary {
  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  let promptChars = 0
  let stagesWithUsage = 0
  for (const usage of usages) {
    if (!usage) continue
    stagesWithUsage += 1
    inputTokens += usage.inputTokens
    outputTokens += usage.outputTokens
    totalTokens += usage.totalTokens
    promptChars += usage.promptChars
  }
  return { inputTokens, outputTokens, totalTokens, promptChars, stagesWithUsage }
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  return `${Math.round(n / 1000)}k`
}

export function formatUsageShort(usage: StageUsage | null | undefined): string {
  if (!usage) return ""
  const mark = usage.source === "estimate" ? "~" : ""
  return `${mark}${formatTokens(usage.inputTokens)} in · ${mark}${formatTokens(usage.outputTokens)} out`
}

/**
 * Hard ceiling on prompt characters per role (TOK-10).
 * Keeps regressions visible in the walkthrough. Raise deliberately when a slice needs more context.
 */
export const PROMPT_CHAR_CEILING = 80_000

/** Tighter ceiling for the first role (no prior outputs yet). */
export const FIRST_ROLE_PROMPT_CHAR_CEILING = 40_000
