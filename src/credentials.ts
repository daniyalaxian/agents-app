import fs from "node:fs"
import path from "node:path"
import { decryptJson, encryptJson } from "./crypto.js"
import type { FigmaCredential } from "./figma.js"
import type { GitHubCredential } from "./github.js"

export type AtlassianCredential = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  cloudId: string
  siteUrl: string
  siteName: string
}

type CredentialRecord = {
  atlassian?: AtlassianCredential
  figma?: FigmaCredential
  github?: GitHubCredential
}

export class CredentialStore {
  constructor(
    private readonly root: string,
    private readonly keyHex: string,
  ) {}

  getAtlassian(sessionId: string): AtlassianCredential | null {
    return this.read(sessionId).atlassian ?? null
  }

  setAtlassian(sessionId: string, credential: AtlassianCredential): void {
    const current = this.read(sessionId)
    current.atlassian = credential
    this.write(sessionId, current)
  }

  clearAtlassian(sessionId: string): void {
    const current = this.read(sessionId)
    delete current.atlassian
    this.write(sessionId, current)
  }

  getFigma(sessionId: string): FigmaCredential | null {
    return this.read(sessionId).figma ?? null
  }

  setFigma(sessionId: string, credential: FigmaCredential): void {
    const current = this.read(sessionId)
    current.figma = credential
    this.write(sessionId, current)
  }

  clearFigma(sessionId: string): void {
    const current = this.read(sessionId)
    delete current.figma
    this.write(sessionId, current)
  }

  getGitHub(sessionId: string): GitHubCredential | null {
    return this.read(sessionId).github ?? null
  }

  setGitHub(sessionId: string, credential: GitHubCredential): void {
    const current = this.read(sessionId)
    current.github = credential
    this.write(sessionId, current)
  }

  clearGitHub(sessionId: string): void {
    const current = this.read(sessionId)
    delete current.github
    this.write(sessionId, current)
  }

  private file(sessionId: string): string {
    return path.join(this.root, "data", "credentials", `${sessionId}.enc`)
  }

  private read(sessionId: string): CredentialRecord {
    const file = this.file(sessionId)
    if (!fs.existsSync(file)) return {}
    return decryptJson<CredentialRecord>(this.keyHex, fs.readFileSync(file, "utf8"))
  }

  private write(sessionId: string, record: CredentialRecord): void {
    const file = this.file(sessionId)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    if (!record.atlassian && !record.figma && !record.github) {
      if (fs.existsSync(file)) fs.unlinkSync(file)
      return
    }
    fs.writeFileSync(file, encryptJson(this.keyHex, record))
  }
}
