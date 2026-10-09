import type { SmokeReport } from "./smoke.js"
import type { Room } from "./types.js"

export type HealthReport = {
  env: string
  result: "healthy" | "degraded" | "unknown"
  summary: string
  signals: { name: string; result: "ok" | "warn" | "fail" | "skip"; detail: string }[]
  recommendation: "none" | "watch" | "hold_promotion" | "investigate"
  at: string
}

export async function buildHealthReport(input: {
  room: Room
  env?: string
  smoke?: SmokeReport | null
  logProbeUrl?: string | null
}): Promise<HealthReport> {
  const env = input.env || input.room.deployEnv || "Dev"
  const smoke =
    input.smoke ||
    (isSmokeReport(input.room.lastSmokeReport) ? input.room.lastSmokeReport : null)
  const signals: HealthReport["signals"] = []

  if (smoke) {
    signals.push({
      name: "smoke",
      result: smoke.result === "pass" ? "ok" : "fail",
      detail: smoke.summary,
    })
    for (const check of smoke.checks.slice(0, 12)) {
      signals.push({
        name: check.id,
        result: check.result === "pass" ? "ok" : check.result === "skip" ? "skip" : "fail",
        detail: check.evidence.slice(0, 240),
      })
    }
  } else {
    signals.push({
      name: "smoke",
      result: "skip",
      detail: "No smoke report on room yet",
    })
  }

  const logUrl =
    input.logProbeUrl?.trim() ||
    process.env.DEVOPS_LOG_PROBE_URL?.trim() ||
    null
  if (logUrl) {
    try {
      const response = await fetch(logUrl, { signal: AbortSignal.timeout(10_000) })
      const text = (await response.text()).slice(0, 400)
      const looksBad = /5\d\d|exception|fatal/i.test(text) && response.ok
      signals.push({
        name: "logs",
        result: !response.ok ? "warn" : looksBad ? "warn" : "ok",
        detail: `GET ${logUrl} → HTTP ${response.status}; ${text || "(empty)"}`,
      })
    } catch (err) {
      signals.push({
        name: "logs",
        result: "skip",
        detail: `Log probe failed: ${err instanceof Error ? err.message : "error"}`,
      })
    }
  } else {
    signals.push({
      name: "logs",
      result: "skip",
      detail: "No DEVOPS_LOG_PROBE_URL configured",
    })
  }

  const failed = signals.some((s) => s.result === "fail")
  const warned = signals.some((s) => s.result === "warn")
  const result: HealthReport["result"] = failed ? "degraded" : smoke ? "healthy" : "unknown"
  const recommendation: HealthReport["recommendation"] = failed
    ? "hold_promotion"
    : warned
      ? "watch"
      : smoke
        ? "none"
        : "investigate"

  return {
    env,
    result,
    summary: failed
      ? `Degraded on ${env}: smoke or checks failed`
      : smoke
        ? `Healthy signals for ${env} (${smoke.summary})`
        : `Unknown health for ${env}; run smoke first`,
    signals,
    recommendation,
    at: new Date().toISOString(),
  }
}

function isSmokeReport(value: unknown): value is SmokeReport {
  return Boolean(
    value &&
      typeof value === "object" &&
      "result" in value &&
      "summary" in value &&
      "checks" in value,
  )
}
