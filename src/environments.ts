import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { DEFAULT_ENV_ID } from "./store.js"
import type { GitRepoRef } from "./types.js"

/**
 * An Environment is one client or program: its sprint rooms and default repos live here, apart from other clients.
 * Environments belong to a workspace (personal in v1). The built-in "Default" environment has no workspace and holds
 * everything that existed before environments, so it is visible to everyone.
 */
export type Environment = {
  id: string
  workspaceId: string | null
  name: string
  description: string
  /** Repos copied into each new sprint room of this environment. */
  gitRepos: GitRepoRef[]
  createdAt: string
}

type EnvStore = { environments: Environment[] }

function envFile(root: string): string {
  return path.join(process.env.DATA_DIR ?? path.join(root, "data"), "environments.json")
}

function read(root: string): EnvStore {
  try {
    const raw = JSON.parse(fs.readFileSync(envFile(root), "utf8")) as EnvStore
    return { environments: Array.isArray(raw.environments) ? raw.environments : [] }
  } catch {
    return { environments: [] }
  }
}

function write(root: string, store: EnvStore): void {
  fs.mkdirSync(path.dirname(envFile(root)), { recursive: true })
  fs.writeFileSync(envFile(root), JSON.stringify(store, null, 2))
}

export function ensureDefaultEnvironment(root: string): Environment {
  const store = read(root)
  let env = store.environments.find((item) => item.id === DEFAULT_ENV_ID)
  if (!env) {
    env = {
      id: DEFAULT_ENV_ID,
      workspaceId: null,
      name: "Default",
      description: "Sprint rooms from before environments existed.",
      gitRepos: [],
      createdAt: new Date().toISOString(),
    }
    store.environments.unshift(env)
    write(root, store)
  }
  return env
}

export function listEnvironments(root: string, workspaceId: string | null): Environment[] {
  ensureDefaultEnvironment(root)
  return read(root).environments.filter(
    (env) => env.workspaceId === null || (workspaceId !== null && env.workspaceId === workspaceId),
  )
}

export function getEnvironment(root: string, id: string): Environment | null {
  ensureDefaultEnvironment(root)
  return read(root).environments.find((env) => env.id === id) ?? null
}

/** True when this person may open the environment (their own, or the shared Default). */
export function canUseEnvironment(env: Environment, workspaceId: string | null): boolean {
  return env.workspaceId === null || (workspaceId !== null && env.workspaceId === workspaceId)
}

export function createEnvironment(
  root: string,
  workspaceId: string,
  input: { name: string; description?: string },
): Environment {
  const name = input.name.trim().slice(0, 80)
  if (!name) throw new Error("Environment name required")
  ensureDefaultEnvironment(root)
  const taken = listEnvironments(root, workspaceId).some((env) => env.name.toLowerCase() === name.toLowerCase())
  if (taken) throw new Error(`You already have an environment called ${name}`)
  const env: Environment = {
    id: `env-${crypto.randomUUID().slice(0, 8)}`,
    workspaceId,
    name,
    description: (input.description || "").trim().slice(0, 240),
    gitRepos: [],
    createdAt: new Date().toISOString(),
  }
  const fresh = read(root)
  fresh.environments.push(env)
  write(root, fresh)
  return env
}

export function setEnvironmentRepos(root: string, id: string, gitRepos: GitRepoRef[]): Environment {
  const store = read(root)
  const env = store.environments.find((item) => item.id === id)
  if (!env) throw new Error("Environment not found")
  env.gitRepos = gitRepos.map((repo) => ({ ...repo }))
  write(root, store)
  return env
}
