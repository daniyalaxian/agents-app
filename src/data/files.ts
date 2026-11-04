import fs from "node:fs"
import path from "node:path"

/**
 * The only place the app reads and writes JSON files (PLATFORM-RESTRUCTURE §7.2).
 * Every path honors DATA_DIR. Writes are atomic (temp file, then rename), writers to the same file take turns,
 * and the audit log is append-only. Repositories sit on top of this, so a database could replace them later.
 */

export function dataDir(root: string): string {
  return process.env.DATA_DIR ?? path.join(root, "data")
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T
  } catch {
    return fallback
  }
}

let counter = 0

/** Writes the whole file or nothing: readers never see a half-written file, and a crash cannot corrupt it. */
export function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${++counter}.tmp`
  const fd = fs.openSync(temp, "w")
  try {
    fs.writeSync(fd, JSON.stringify(value, null, 2))
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  // Windows can refuse a rename while another process has the target open for a moment; retry briefly.
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(temp, file)
      return
    } catch (error) {
      if (attempt >= 5 || (error as NodeJS.ErrnoException).code !== "EPERM") {
        fs.rmSync(temp, { force: true })
        throw error
      }
    }
  }
}

const tails = new Map<string, Promise<unknown>>()

/** Runs `fn` after every earlier call for the same file has finished. */
export function withFileLock<T>(file: string, fn: () => Promise<T> | T): Promise<T> {
  const key = path.resolve(file)
  const run = (tails.get(key) ?? Promise.resolve()).then(fn, fn)
  const tail = run.catch(() => undefined)
  tails.set(key, tail)
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key)
  })
  return run
}

/** Read, change and write one file as a single step, so two updates cannot overwrite each other. */
export function updateJson<T>(file: string, fallback: T, change: (current: T) => T | void): Promise<T> {
  return withFileLock(file, () => {
    const current = readJson<T>(file, fallback)
    const next = change(current) ?? current
    writeJsonAtomic(file, next)
    return next
  })
}

/** Adds one line to a JSONL file. Existing lines are never touched. */
export function appendJsonl(file: string, entry: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, JSON.stringify(entry) + "\n")
}

export function readJsonl<T>(file: string): T[] {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as T]
        } catch {
          return [] // a torn last line from a crash must not hide the rest
        }
      })
  } catch {
    return []
  }
}
