import fs from "node:fs"
import path from "node:path"

export function loadEnv(root: string): void {
  const file = path.join(root, ".env")
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const splitAt = trimmed.indexOf("=")
    if (splitAt === -1) continue
    const key = trimmed.slice(0, splitAt).trim()
    let value = trimmed.slice(splitAt + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env) || process.env[key] === "") {
      process.env[key] = value
    }
  }
}
