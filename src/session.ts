import crypto from "node:crypto"
import type { Request, Response } from "express"
import { sealed, unseal } from "./crypto.js"

const COOKIE = "agent_room_session"

export function readSessionId(req: Request, secret: string): string | null {
  return unseal(secret, cookieValue(req.headers.cookie, COOKIE))
}

export function ensureSession(req: Request, res: Response, secret: string): string {
  const existing = readSessionId(req, secret)
  if (existing) return existing
  const id = crypto.randomUUID()
  writeSession(res, secret, id)
  return id
}

export function writeSession(res: Response, secret: string, sessionId: string): void {
  const token = sealed(secret, sessionId)
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`,
  )
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === name) return rest.join("=")
  }
  return undefined
}
