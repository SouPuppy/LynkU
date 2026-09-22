export type AdminCapability = 'audit:read' | 'categories:write' | 'content:read' | 'governance:write' | 'operations:read' | 'settings:write' | 'users:read'
export type AdminRole = 'owner' | 'community' | 'viewer'

export interface AdminMember {
  accountId: string
  kind: 'business' | 'platform-owner'
  role: AdminRole
  status: 'active' | 'revoked'
  version: number
  webUid: string
}

export interface AdminAccount {
  id: string
  lifecycle: 'active' | 'closing' | 'closed'
  role: string
  verified: boolean
}

export interface AdminAuthorizationStore {
  account(accountId: string): Promise<AdminAccount | null>
  member(webUid: string): Promise<AdminMember | null>
}

export class AdminAuthorizationFailure extends Error {
  constructor(readonly code: 'AUTH_FAILED' | 'FORBIDDEN' | 'AUTH_UNAVAILABLE') { super(code) }
}

const CAPABILITIES: Readonly<Record<AdminRole, readonly AdminCapability[]>> = {
  owner: ['audit:read', 'categories:write', 'content:read', 'governance:write', 'operations:read', 'settings:write', 'users:read'],
  community: ['audit:read', 'categories:write', 'content:read', 'governance:write', 'operations:read', 'users:read'],
  viewer: ['audit:read', 'content:read', 'operations:read', 'users:read'],
}

export interface AdminPrincipal {
  accountId: string
  capabilities: readonly AdminCapability[]
  memberVersion: number
  role: AdminRole
  webUid: string
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value
}

function validMember(value: AdminMember): boolean {
  return validIdentifier(value.webUid) && validIdentifier(value.accountId)
    && (value.kind === 'business' || value.kind === 'platform-owner')
    && (value.role === 'owner' || value.role === 'community' || value.role === 'viewer')
    && (value.status === 'active' || value.status === 'revoked')
    && Number.isSafeInteger(value.version) && value.version >= 0
}

export async function authorizeAdmin(store: AdminAuthorizationStore, webUid: unknown): Promise<AdminPrincipal> {
  if (!validIdentifier(webUid)) throw new AdminAuthorizationFailure('AUTH_FAILED')
  let member: AdminMember | null
  try { member = await store.member(webUid) } catch (_) { throw new AdminAuthorizationFailure('AUTH_UNAVAILABLE') }
  if (member === null) throw new AdminAuthorizationFailure('FORBIDDEN')
  if (!validMember(member) || member.webUid !== webUid || member.status !== 'active') throw new AdminAuthorizationFailure('FORBIDDEN')
  if (member.kind === 'platform-owner') {
    if (member.role !== 'owner' || member.accountId !== `platform-owner:${webUid}`) throw new AdminAuthorizationFailure('FORBIDDEN')
    return Object.freeze({ accountId: member.accountId, capabilities: CAPABILITIES.owner, memberVersion: member.version, role: member.role, webUid })
  }
  let account: AdminAccount | null
  try { account = await store.account(member.accountId) } catch (_) { throw new AdminAuthorizationFailure('AUTH_UNAVAILABLE') }
  if (account === null || account.id !== member.accountId) throw new AdminAuthorizationFailure('FORBIDDEN')
  if (account.lifecycle !== 'active' || account.verified !== true || account.role !== 'admin') throw new AdminAuthorizationFailure('FORBIDDEN')
  return Object.freeze({ accountId: account.id, capabilities: CAPABILITIES[member.role], memberVersion: member.version, role: member.role, webUid })
}

export function hasAdminCapability(principal: AdminPrincipal, capability: AdminCapability): boolean {
  return principal.capabilities.includes(capability)
}
