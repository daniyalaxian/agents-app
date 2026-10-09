export type JenkinsConfig = {
  baseUrl: string
  user: string
  token: string
}

export function jenkinsConfig(): JenkinsConfig | null {
  const baseUrl = process.env.JENKINS_BASE_URL?.trim().replace(/\/$/, "")
  const user = process.env.JENKINS_USER?.trim()
  const token = process.env.JENKINS_API_TOKEN?.trim()
  if (!baseUrl || !user || !token) return null
  return { baseUrl, user, token }
}

export function smokeToken(): string | null {
  return process.env.JENKINS_SMOKE_TOKEN?.trim() || null
}

function basicAuth(config: JenkinsConfig): string {
  return `Basic ${Buffer.from(`${config.user}:${config.token}`).toString("base64")}`
}

async function crumbHeader(config: JenkinsConfig): Promise<Record<string, string>> {
  const response = await fetch(`${config.baseUrl}/crumbIssuer/api/json`, {
    headers: { Authorization: basicAuth(config) },
  })
  if (!response.ok) return {}
  const body = (await response.json()) as { crumb?: string; crumbRequestField?: string }
  if (!body.crumb || !body.crumbRequestField) return {}
  return { [body.crumbRequestField]: body.crumb }
}

/** Trigger a parameterized Jenkins job. Returns the queue location when available. */
export async function triggerJenkinsJob(input: {
  jobName: string
  parameters: Record<string, string>
}): Promise<{ queueUrl: string | null; jobUrl: string }> {
  const config = jenkinsConfig()
  if (!config) {
    throw new Error("Set JENKINS_BASE_URL, JENKINS_USER, and JENKINS_API_TOKEN to trigger jobs")
  }

  const jobPath = input.jobName
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/job/")
  const jobUrl = `${config.baseUrl}/job/${jobPath}`
  const params = new URLSearchParams(input.parameters)
  const crumb = await crumbHeader(config)
  const response = await fetch(`${jobUrl}/buildWithParameters?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(config),
      ...crumb,
    },
  })

  if (!response.ok && response.status !== 201) {
    const text = await response.text().catch(() => "")
    throw new Error(`Jenkins job trigger failed (${response.status}). ${text.slice(0, 200)}`)
  }

  return {
    queueUrl: response.headers.get("location"),
    jobUrl,
  }
}
