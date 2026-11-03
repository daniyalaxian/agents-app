/**
 * The setup checklist shown in Help (HG-2): what is configured, what the person still has to do, and the exact
 * redirect URL and scopes to enter in each provider's developer console. Pure, so the walkthrough can check it.
 */

export type CheckItem = {
  id: string
  label: string
  /** ok = done, todo = needed for the main flow, optional = only for some features. */
  status: "ok" | "todo" | "optional"
  detail: string
  /** The exact values to copy into the provider's console, when there are any. */
  copy?: { label: string; value: string }[]
}

export type SetupInput = {
  baseUrl: string
  engine: string
  signedIn: boolean
  atlassian: { configured: boolean; connected: boolean; scopes: string[]; extraScopes: string[] }
  figma: { configured: boolean; connected: boolean; scopes: string[]; hasToken: boolean }
  github: { configured: boolean; connected: boolean; scopes: string[] }
  jenkinsConfigured: boolean
  codeWorkspaceSet: boolean
  designsDirSet: boolean
}

function oauth(
  id: string,
  name: string,
  input: { configured: boolean; connected: boolean },
  baseUrl: string,
  scopes: string[],
  keyNames: string,
): CheckItem {
  const callback = `${baseUrl}/auth/${id}/callback`
  const copy = [
    { label: "Redirect (callback) URL", value: callback },
    { label: "Scopes", value: scopes.join(" ") },
  ]
  if (!input.configured) {
    return {
      id,
      label: `${name}: add the app keys`,
      status: "todo",
      detail: `Create an app in the ${name} developer console, enter the redirect URL and scopes below, then put ${keyNames} in .env and restart the server.`,
      copy,
    }
  }
  if (!input.connected) {
    return {
      id,
      label: `${name}: connect your account`,
      status: "todo",
      detail: `The app keys are set. Use Connect ${name} in Sprint sources. If consent fails, the app in the console is missing one of the scopes below.`,
      copy,
    }
  }
  return { id, label: `${name}: connected`, status: "ok", detail: "Reads work. Writes still wait for your Approve.", copy }
}

export function setupChecklist(input: SetupInput): CheckItem[] {
  const base = input.baseUrl.replace(/\/$/, "")
  const items: CheckItem[] = []

  items.push(
    input.engine === "draft"
      ? {
          id: "model",
          label: "Model: add a Cursor API key",
          status: "todo",
          detail: "Without CURSOR_API_KEY in .env the agents answer with offline sample text (Draft mode). Add the key and restart for real discussions.",
        }
      : { id: "model", label: "Model: live", status: "ok", detail: `Agents run on ${input.engine}.` },
  )

  items.push(
    input.signedIn
      ? { id: "account", label: "Account: signed in", status: "ok", detail: "Your agents, teams and environments are saved to your workspace." }
      : { id: "account", label: "Account: sign in", status: "todo", detail: "Guests can only use the default team. Sign in under Settings → Account to import agents and save automations." },
  )

  items.push(
    oauth("atlassian", "Atlassian (Confluence and Jira)", input.atlassian, base, [...input.atlassian.scopes, ...input.atlassian.extraScopes], "ATLASSIAN_CLIENT_ID and ATLASSIAN_CLIENT_SECRET"),
  )

  if (input.figma.hasToken) {
    items.push({ id: "figma", label: "Figma: personal access token set", status: "ok", detail: "FIGMA_ACCESS_TOKEN is used instead of signing in with Figma." })
  } else {
    items.push(oauth("figma", "Figma", input.figma, base, input.figma.scopes, "FIGMA_CLIENT_ID and FIGMA_CLIENT_SECRET (or a FIGMA_ACCESS_TOKEN)"))
  }

  items.push(oauth("github", "GitHub", input.github, base, input.github.scopes, "GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET"))

  items.push({
    id: "code",
    label: input.codeWorkspaceSet ? "Local code: set" : "Local code: optional",
    status: input.codeWorkspaceSet ? "ok" : "optional",
    detail: input.codeWorkspaceSet
      ? "Agents can read your local clones of the Setup repos."
      : "Set CODE_WORKSPACE in .env to a .code-workspace file or a folder of clones so agents can read the code.",
  })
  items.push({
    id: "designs",
    label: input.designsDirSet ? "Design exports: set" : "Design exports: optional",
    status: input.designsDirSet ? "ok" : "optional",
    detail: input.designsDirSet
      ? "Agents can look at the screens exported from Figma."
      : "Set DESIGNS_DIR in .env to a folder of exported Figma screens so agents can see them.",
  })
  items.push({
    id: "jenkins",
    label: input.jenkinsConfigured ? "Jenkins: set" : "Jenkins: optional",
    status: input.jenkinsConfigured ? "ok" : "optional",
    detail: input.jenkinsConfigured
      ? "Deploy steps can start Jenkins jobs after you approve."
      : "Only needed for the Deploy and DevOps steps. See .env.example for the JENKINS_* settings.",
  })

  return items
}
