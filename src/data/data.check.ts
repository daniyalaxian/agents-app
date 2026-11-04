import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { appendJsonl, dataDir, readJson, readJsonl, updateJson, withFileLock, writeJsonAtomic } from "./files.js"

/** Checks for the data layer. Always works in a temp folder, never in the real data/. */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`data check failed: ${message}`)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "datalayer-"))
const saved = process.env.DATA_DIR

try {
  process.env.DATA_DIR = tmp
  assert(dataDir("/ignored") === tmp, "DATA_DIR is honored")
  delete process.env.DATA_DIR
  assert(dataDir("/repo") === path.join("/repo", "data"), "default is <root>/data")

  const file = path.join(tmp, "nested", "x.json")
  assert(readJson(file, { n: 0 }).n === 0, "a missing file gives the fallback")
  writeJsonAtomic(file, { n: 1 })
  assert(readJson(file, { n: 0 }).n === 1, "a write can be read back")
  assert(fs.readdirSync(path.dirname(file)).every((name) => !name.endsWith(".tmp")), "no temp file is left behind")
  fs.writeFileSync(file, "{ not json")
  assert(readJson(file, { n: 7 }).n === 7, "a damaged file gives the fallback instead of crashing")

  // Fifty updates started at once must all count: nothing lost to overwriting.
  const counter = path.join(tmp, "counter.json")
  await Promise.all(Array.from({ length: 50 }, () => updateJson(counter, { n: 0 }, (value) => ({ n: value.n + 1 }))))
  assert(readJson(counter, { n: 0 }).n === 50, "concurrent updates are serialized")

  // A failing update must not block the ones after it, and must not write.
  await updateJson(counter, { n: 0 }, () => {
    throw new Error("boom")
  }).catch(() => undefined)
  await updateJson(counter, { n: 0 }, (value) => ({ n: value.n + 1 }))
  assert(readJson(counter, { n: 0 }).n === 51, "a failed update does not stop later ones or change the file")

  // Locks are per file: a slow writer on one file does not hold up another file.
  const order: string[] = []
  const slow = withFileLock(path.join(tmp, "a"), () => new Promise<void>((resolve) => setTimeout(() => (order.push("a"), resolve()), 40)))
  const quick = withFileLock(path.join(tmp, "b"), () => void order.push("b"))
  await Promise.all([slow, quick])
  assert(order.join() === "b,a", "different files do not wait for each other")

  const log = path.join(tmp, "audit", "2026-11.jsonl")
  appendJsonl(log, { n: 1 })
  appendJsonl(log, { n: 2 })
  fs.appendFileSync(log, '{"n": 3') // simulate a crash mid-line
  assert(readJsonl<{ n: number }>(log).map((entry) => entry.n).join() === "1,2", "a torn last line is skipped and earlier lines survive")
  assert(readJsonl(path.join(tmp, "none.jsonl")).length === 0, "a missing log reads as empty")

  console.log("data layer ok: atomic writes, per-file locks, append-only log, DATA_DIR honored")
} finally {
  if (saved === undefined) delete process.env.DATA_DIR
  else process.env.DATA_DIR = saved
  fs.rmSync(tmp, { recursive: true, force: true })
}
