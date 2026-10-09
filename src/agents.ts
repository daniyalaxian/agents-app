import fs from "node:fs"
import path from "node:path"
import type { AgentFile } from "./types.js"

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/

export function loadAgents(dir: string): AgentFile[] {
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()

  return files.map((name) => parseAgent(path.join(dir, name), name))
}

export function parseAgent(filePath: string, fileName: string): AgentFile {
  const raw = fs.readFileSync(filePath, "utf8")
  const matched = raw.match(FRONT_MATTER)
  if (!matched) {
    throw new Error(`${fileName} is missing front matter`)
  }

  const fields = parseFields(matched[1])
  const body = matched[2]
  const name = fields.name
  const title = fields.title
  if (!name || !title) {
    throw new Error(`${fileName} needs name and title`)
  }

  const draftStart = body.search(/^## Draft\s*$/m)
  const instructions = (draftStart === -1 ? body : body.slice(0, draftStart)).trim()
  const draft = draftStart === -1 ? "" : body.slice(draftStart).replace(/^## Draft\s*/, "").trim()
  if (!draft) {
    throw new Error(`${fileName} needs a Draft section for local runs`)
  }

  return {
    name,
    title,
    needsApproval: fields.needs_approval === "true",
    file: fileName,
    instructions,
    draft,
  }
}

function parseFields(block: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const line of block.split(/\r?\n/)) {
    const splitAt = line.indexOf(":")
    if (splitAt === -1) continue
    fields[line.slice(0, splitAt).trim()] = line.slice(splitAt + 1).trim()
  }
  return fields
}
