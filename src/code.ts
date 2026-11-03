import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)

/** A git clone on this machine that agents can read through a snapshot. */
export type LocalRepo = {
  owner: string
  repo: string
  path: string
}

export type CodeSnapshot = {
  dir: string
  ref: string
  commit: string
  committedAt: string
  fetchError: string | null
}

const FETCH_EVERY_MS = 5 * 60 * 1000
const lastFetch = new Map<string, number>()

/**
 * Local clones listed by CODE_WORKSPACE: either a VS Code/Cursor `.code-workspace` file
 * or a folder whose subfolders are clones. Repos are identified by their `origin` URL.
 */
export async function localRepos(workspace: string | undefined): Promise<LocalRepo[]> {
  const target = workspace?.trim()
  if (!target || !fs.existsSync(target)) return []
  const folders = target.endsWith(".code-workspace")
    ? workspaceFolders(target)
    : fs
        .readdirSync(target, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(target, entry.name))
  const found = await Promise.all(
    folders.map(async (folder): Promise<LocalRepo[]> => {
      const origin = await tryGit(folder, ["remote", "get-url", "origin"])
      const match = origin?.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i)
      return match ? [{ owner: match[1], repo: match[2], path: folder }] : []
    }),
  )
  return found.flat()
}

function workspaceFolders(file: string): string[] {
  // Workspace files allow comments and trailing commas.
  const text = fs
    .readFileSync(file, "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1")
  const parsed = JSON.parse(text) as { folders?: { path?: string }[] }
  const base = path.dirname(file)
  return (parsed.folders ?? []).flatMap((item) => (item.path ? [path.resolve(base, item.path)] : []))
}

export function findLocalRepo(repos: LocalRepo[], owner: string, repo: string): LocalRepo | null {
  return (
    repos.find(
      (item) => item.owner.toLowerCase() === owner.toLowerCase() && item.repo.toLowerCase() === repo.toLowerCase(),
    ) ?? null
  )
}

/**
 * Export `branch` from a local clone into `<root>/data/workdir/code/<owner>__<repo>` with `git archive`.
 * The person's working copy is never touched. Fetches origin at most every 5 minutes; if the fetch
 * fails, the last fetched state is used. Re-extracts only when the commit changes.
 */
export async function snapshotRepo(root: string, repo: LocalRepo, branch: string): Promise<CodeSnapshot> {
  let fetchError: string | null = null
  if (Date.now() - (lastFetch.get(repo.path) ?? 0) > FETCH_EVERY_MS) {
    try {
      await git(repo.path, ["fetch", "origin", "--quiet", "--prune"], 90_000)
      lastFetch.set(repo.path, Date.now())
    } catch (error) {
      fetchError = error instanceof Error ? error.message.split("\n")[0] : "git fetch failed"
    }
  }

  const ref = await resolveBranch(repo.path, branch)
  if (!ref) throw new Error(`Branch "${branch}" was not found in ${repo.owner}/${repo.repo}`)
  const commit = await git(repo.path, ["rev-parse", ref])
  const committedAt = await git(repo.path, ["log", "-1", "--format=%cI", ref])

  const dir = path.join(root, "data", "workdir", "code", `${repo.owner}__${repo.repo}`)
  const marker = path.join(dir, ".agent-room-snapshot.json")
  const current = fs.existsSync(marker) ? (JSON.parse(fs.readFileSync(marker, "utf8")) as { commit?: string }) : null
  if (current?.commit !== commit) {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    const tarFile = `${dir}.tar`
    await git(repo.path, ["archive", "--format=tar", "-o", tarFile, ref], 120_000)
    // Relative path: GNU tar (Git for Windows) would read "D:\…" as a remote host.
    await run("tar", ["-xf", `../${path.basename(tarFile)}`], { cwd: dir, timeout: 120_000 })
    fs.rmSync(tarFile, { force: true })
    fs.writeFileSync(marker, JSON.stringify({ ref, commit, committedAt }, null, 2))
  }
  return { dir, ref, commit, committedAt, fetchError }
}

/** Branch names are often typed loosely (UI-Sprint_06 vs UI-Sprint-06); prefer the remote branch. */
async function resolveBranch(repoPath: string, branch: string): Promise<string | null> {
  const wanted = normalize(branch)
  const refs = (await git(repoPath, ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin", "refs/heads"]))
    .split(/\r?\n/)
    .filter(Boolean)
  const remote = refs.find((ref) => ref.startsWith("origin/") && normalize(ref.slice(7)) === wanted)
  return remote ?? refs.find((ref) => normalize(ref) === wanted) ?? null
}

function normalize(branch: string): string {
  return branch.toLowerCase().replace(/[-_\s]/g, "")
}

async function git(cwd: string, args: string[], timeout = 30_000): Promise<string> {
  const { stdout } = await run("git", ["-c", "safe.directory=*", "-C", cwd, ...args], {
    encoding: "utf8",
    timeout,
    maxBuffer: 16 * 1024 * 1024,
    // Never wait on a credential prompt inside the server.
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
  })
  return stdout.trim()
}

async function tryGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await git(cwd, args)
  } catch {
    return null
  }
}
