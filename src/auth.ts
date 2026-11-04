import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import type { AppRole } from "./rbac.js"
import { parseRole } from "./rbac.js"

/** Workspace membership role (ENT-2). First registered user is owner. */
export type MembershipRole = AppRole

export type UserRecord = {
  id: string
  email: string
  name: string
  passwordHash: string
  passwordSalt: string
  workspaceId: string
  role: MembershipRole
  createdAt: string
}

export type WorkspaceRecord = {
  id: string
  name: string
  createdAt: string
}

export type SessionBinding = {
  sessionId: string
  userId: string
  workspaceId: string
  at: string
}

type AuthStore = {
  workspaces: WorkspaceRecord[]
  users: UserRecord[]
  bindings: SessionBinding[]
}

function authFile(root: string): string {
  return path.join(root, "data", "auth.json")
}

function emptyStore(): AuthStore {
  return { workspaces: [], users: [], bindings: [] }
}

export function readAuth(root: string): AuthStore {
  const file = authFile(root)
  if (!fs.existsSync(file)) return emptyStore()
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as AuthStore
    return {
      workspaces: Array.isArray(raw.workspaces) ? raw.workspaces : [],
      users: Array.isArray(raw.users)
        ? raw.users.map((user) => ({
            ...user,
            // Legacy "admin" stays valid; unknown strings fall back to member.
            role: (parseRole(user.role) ?? (user.role === "admin" ? "admin" : "member")) as MembershipRole,
          }))
        : [],
      bindings: Array.isArray(raw.bindings) ? raw.bindings : [],
    }
  } catch {
    return emptyStore()
  }
}

function writeAuth(root: string, store: AuthStore): void {
  const file = authFile(root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(store, null, 2))
}

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")): {
  hash: string
  salt: string
} {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex")
  return { hash, salt }
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const { hash } = hashPassword(password, salt)
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(expectedHash, "hex"))
  } catch {
    return false
  }
}

export function publicUser(user: UserRecord): {
  id: string
  email: string
  name: string
  workspaceId: string
  role: MembershipRole
} {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    workspaceId: user.workspaceId,
    role: user.role,
  }
}

export function registerUser(
  root: string,
  input: { email: string; password: string; name: string; workspaceName?: string },
): { user: UserRecord; workspace: WorkspaceRecord } {
  const store = readAuth(root)
  const email = input.email.trim().toLowerCase()
  if (!email || !email.includes("@")) throw new Error("Valid email required")
  if (!input.password || input.password.length < 6) throw new Error("Password must be at least 6 characters")
  if (store.users.some((user) => user.email === email)) throw new Error("Email already registered")

  const workspace: WorkspaceRecord = {
    id: crypto.randomUUID(),
    name: (input.workspaceName || `${input.name.trim() || "My"} workspace`).slice(0, 80),
    createdAt: new Date().toISOString(),
  }
  const { hash, salt } = hashPassword(input.password)
  const user: UserRecord = {
    id: crypto.randomUUID(),
    email,
    name: input.name.trim() || email.split("@")[0],
    passwordHash: hash,
    passwordSalt: salt,
    workspaceId: workspace.id,
    role: "owner",
    createdAt: new Date().toISOString(),
  }
  store.workspaces.push(workspace)
  store.users.push(user)
  writeAuth(root, store)
  return { user, workspace }
}

/** Owner/admin tooling and tests: change a user's role inside the same workspace. */
export function setUserRole(root: string, userId: string, role: MembershipRole): UserRecord {
  if (!parseRole(role)) throw new Error(`Unknown role: ${role}`)
  const store = readAuth(root)
  const user = store.users.find((item) => item.id === userId)
  if (!user) throw new Error("User not found")
  user.role = role
  writeAuth(root, store)
  return user
}

export function listWorkspaceUsers(root: string, workspaceId: string): UserRecord[] {
  return readAuth(root).users.filter((user) => user.workspaceId === workspaceId)
}

export function loginUser(
  root: string,
  input: { email: string; password: string },
): UserRecord {
  const store = readAuth(root)
  const email = input.email.trim().toLowerCase()
  const user = store.users.find((item) => item.email === email)
  if (!user || !verifyPassword(input.password, user.passwordSalt, user.passwordHash)) {
    throw new Error("Invalid email or password")
  }
  return user
}

export function bindSession(root: string, sessionId: string, user: UserRecord): void {
  const store = readAuth(root)
  store.bindings = store.bindings.filter((item) => item.sessionId !== sessionId)
  store.bindings.push({
    sessionId,
    userId: user.id,
    workspaceId: user.workspaceId,
    at: new Date().toISOString(),
  })
  writeAuth(root, store)
}

export function unbindSession(root: string, sessionId: string): void {
  const store = readAuth(root)
  store.bindings = store.bindings.filter((item) => item.sessionId !== sessionId)
  writeAuth(root, store)
}

export function userForSession(root: string, sessionId: string): UserRecord | null {
  const store = readAuth(root)
  const binding = store.bindings.find((item) => item.sessionId === sessionId)
  if (!binding) return null
  return store.users.find((user) => user.id === binding.userId) || null
}

export function workspaceForSession(root: string, sessionId: string): WorkspaceRecord | null {
  const store = readAuth(root)
  const binding = store.bindings.find((item) => item.sessionId === sessionId)
  if (!binding) return null
  return store.workspaces.find((ws) => ws.id === binding.workspaceId) || null
}

export function requireUser(root: string, sessionId: string): UserRecord {
  const user = userForSession(root, sessionId)
  if (!user) throw new Error("Sign in required")
  return user
}
