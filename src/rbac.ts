/**
 * Workspace / environment RBAC (ENT-2, Q12).
 * Unsigned local sessions act as owner so draft demos keep working.
 */

export type AppRole = "owner" | "admin" | "lead" | "approver" | "member" | "viewer"

export type Capability =
  | "read"
  | "run"
  | "stage_approve"
  | "write_approve"
  | "edit_automation"
  | "edit_catalog"
  | "import_toolkit"
  | "manage_environment"
  | "manage_members"
  | "view_audit"

const ALL: Capability[] = [
  "read",
  "run",
  "stage_approve",
  "write_approve",
  "edit_automation",
  "edit_catalog",
  "import_toolkit",
  "manage_environment",
  "manage_members",
  "view_audit",
]

const ROLE_CAPS: Record<AppRole, Capability[]> = {
  owner: ALL,
  admin: ALL.filter((cap) => cap !== "manage_members"),
  lead: ["read", "run", "stage_approve", "write_approve", "edit_automation", "edit_catalog", "view_audit"],
  approver: ["read", "run", "stage_approve", "write_approve", "view_audit"],
  member: ["read", "run", "stage_approve"],
  viewer: ["read", "view_audit"],
}

const ROLE_RANK: Record<AppRole, number> = {
  owner: 60,
  admin: 50,
  lead: 40,
  approver: 30,
  member: 20,
  viewer: 10,
}

export function parseRole(value: string | null | undefined): AppRole | null {
  if (!value) return null
  return value in ROLE_CAPS ? (value as AppRole) : null
}

/** Signed-in role, or owner when nobody is signed in (local single-user mode). */
export function effectiveRole(user: { role: string } | null | undefined): AppRole {
  if (!user) return "owner"
  return parseRole(user.role) ?? "member"
}

export function can(role: AppRole, capability: Capability): boolean {
  return ROLE_CAPS[role].includes(capability)
}

export function assertCan(user: { role: string } | null | undefined, capability: Capability): AppRole {
  const role = effectiveRole(user)
  if (!can(role, capability)) {
    throw new Error(`Your role (${role}) cannot ${capability.replaceAll("_", " ")}`)
  }
  return role
}

export function roleAtLeast(role: AppRole, minimum: AppRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum]
}

export function capabilitiesFor(role: AppRole): Capability[] {
  return [...ROLE_CAPS[role]]
}
