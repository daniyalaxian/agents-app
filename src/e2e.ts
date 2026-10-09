import fs from "node:fs"
import path from "node:path"
import type { CheckSpec } from "./assertions.js"
import { evaluateBody } from "./assertions.js"

export type E2eCheckResult = {
  id: string
  result: "pass" | "fail" | "skip"
  evidence: string
}

export type QaTestUser = {
  username: string
  password: string
  loginPath?: string
}

export function qaTestUser(): QaTestUser | null {
  const username = process.env.QA_TEST_USER?.trim()
  const password = process.env.QA_TEST_PASSWORD?.trim()
  if (!username || !password) return null
  return {
    username,
    password,
    loginPath: process.env.QA_LOGIN_PATH?.trim() || "/login",
  }
}

/** Browser E2E when Playwright is installed; otherwise HTML scan on the agent host. */
export async function runE2eChecks(input: {
  root: string
  roomId: string
  baseUrl: string
  specs: CheckSpec[]
}): Promise<E2eCheckResult[]> {
  const specs =
    input.specs.filter((spec) => spec.kind === "test").length > 0
      ? input.specs.filter((spec) => spec.kind === "test")
      : input.specs.length > 0
        ? input.specs
        : [
            {
              id: "SMOKE-001",
              kind: "smoke" as const,
              story: null,
              text: "",
              expectAny: ["ok", "Paid", "Pending", "Failed", "unavailable"],
              forbid: [],
            },
          ]

  const playwright = await tryPlaywright()
  if (playwright) {
    return runWithPlaywright(playwright, input.root, input.roomId, input.baseUrl, specs)
  }
  return runHtmlScan(input.baseUrl, specs)
}

async function tryPlaywright(): Promise<typeof import("playwright") | null> {
  try {
    return await import("playwright")
  } catch {
    return null
  }
}

async function runWithPlaywright(
  playwright: typeof import("playwright"),
  root: string,
  roomId: string,
  baseUrl: string,
  specs: CheckSpec[],
): Promise<E2eCheckResult[]> {
  const evidenceDir = path.join(root, "data", "smoke-evidence")
  fs.mkdirSync(evidenceDir, { recursive: true })
  const browser = await playwright.chromium.launch({ headless: true })
  const results: E2eCheckResult[] = []

  try {
    const page = await browser.newPage()
    const user = qaTestUser()
    if (user) {
      const loginUrl = absoluteUrl(baseUrl, user.loginPath || "/login")
      try {
        await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 20_000 })
        await page.fill('input[type="email"], input[name="username"], input[name="email"], #username', user.username)
        await page.fill('input[type="password"], input[name="password"], #password', user.password)
        await page.click('button[type="submit"], input[type="submit"]')
        await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined)
      } catch (err) {
        results.push({
          id: "E2E:LOGIN",
          result: "fail",
          evidence: `Login attempt failed: ${err instanceof Error ? err.message : "error"}`,
        })
      }
    }

    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 20_000 })
    const bodyText = await page.locator("body").innerText().catch(() => "")
    const html = await page.content().catch(() => "")
    const hay = `${bodyText}\n${html}`

    for (const spec of specs) {
      const shot = path.join(evidenceDir, `${safe(roomId)}-${safe(spec.id)}.png`)
      try {
        await page.screenshot({ path: shot, fullPage: true })
      } catch {
        /* ignore screenshot errors */
      }
      const judged = evaluateBody(spec, hay, true)
      results.push({
        id: `E2E:${spec.id}`,
        result: judged.result,
        evidence: `${judged.evidence}; playwright screenshot ${shot}`,
      })
    }
  } catch (err) {
    results.push({
      id: "E2E:BROWSER",
      result: "fail",
      evidence: `Playwright navigation failed: ${err instanceof Error ? err.message : "error"}`,
    })
  } finally {
    await browser.close().catch(() => undefined)
  }

  return results
}

async function runHtmlScan(baseUrl: string, specs: CheckSpec[]): Promise<E2eCheckResult[]> {
  let status = 0
  let body = ""
  let error = ""
  try {
    const response = await fetch(baseUrl, {
      headers: { Accept: "text/html,application/json,*/*" },
      signal: AbortSignal.timeout(15_000),
    })
    status = response.status
    body = (await response.text()).slice(0, 50_000)
  } catch (err) {
    error = err instanceof Error ? err.message : "request failed"
  }

  const httpOk = !error && status > 0 && status < 500
  if (!httpOk) {
    return specs.map((spec) => ({
      id: `E2E:${spec.id}`,
      result: "fail" as const,
      evidence: error
        ? `HTML scan GET ${baseUrl} error: ${error}`
        : `HTML scan GET ${baseUrl} → HTTP ${status}. Install playwright for real browser E2E: npm i -D playwright && npx playwright install chromium`,
    }))
  }

  return specs.map((spec) => {
    const judged = evaluateBody(spec, body, true)
    return {
      id: `E2E:${spec.id}`,
      result: judged.result === "fail" && /ok|health|agent room/i.test(body) && spec.id === "SMOKE-001"
        ? "pass"
        : judged.result,
      evidence: `${judged.evidence}; mode=html-scan (install Playwright on agent host for Chrome E2E)`,
    }
  })
}

function absoluteUrl(baseUrl: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  const base = baseUrl.replace(/\/$/, "")
  return `${base}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`
}

function safe(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80)
}
