import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

type Secrets = {
  sessionSecret: string
  credentialsKey: string
}

export function loadSecrets(root: string): Secrets {
  const fromEnv = {
    sessionSecret: process.env.SESSION_SECRET?.trim(),
    credentialsKey: process.env.CREDENTIALS_KEY?.trim(),
  }
  if (fromEnv.sessionSecret && fromEnv.credentialsKey) {
    return { sessionSecret: fromEnv.sessionSecret, credentialsKey: fromEnv.credentialsKey }
  }

  const file = path.join(root, "data", "secrets.json")
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as Secrets
    return {
      sessionSecret: fromEnv.sessionSecret || saved.sessionSecret,
      credentialsKey: fromEnv.credentialsKey || saved.credentialsKey,
    }
  }

  const generated: Secrets = {
    sessionSecret: fromEnv.sessionSecret || crypto.randomBytes(32).toString("hex"),
    credentialsKey: fromEnv.credentialsKey || crypto.randomBytes(32).toString("hex"),
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(generated, null, 2))
  return generated
}

export function encryptJson(keyHex: string, value: unknown): string {
  const key = Buffer.from(keyHex, "hex")
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const plaintext = Buffer.from(JSON.stringify(value), "utf8")
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString("base64url")
}

export function decryptJson<T>(keyHex: string, payload: string): T {
  const raw = Buffer.from(payload, "base64url")
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const encrypted = raw.subarray(28)
  const key = Buffer.from(keyHex, "hex")
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return JSON.parse(plaintext.toString("utf8")) as T
}

export function sign(secret: string, value: string): string {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url")
}

export function sealed(secret: string, value: string): string {
  return `${value}.${sign(secret, value)}`
}

export function unseal(secret: string, token: string | undefined): string | null {
  if (!token) return null
  const splitAt = token.lastIndexOf(".")
  if (splitAt === -1) return null
  const value = token.slice(0, splitAt)
  const signature = token.slice(splitAt + 1)
  const expected = sign(secret, value)
  const left = Buffer.from(signature)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null
  return value
}
