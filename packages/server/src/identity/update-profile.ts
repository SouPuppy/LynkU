import type { SelfProfile } from '@lynku/contracts'
import { projectSelfProfile } from './self-profile'
import { ModerationFailure } from '../shared'
export class ProfileUpdateFailure extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'FORBIDDEN' | 'CONTENT_REJECTED') { super(code) }
}
interface ProfilePatch { nickname?: string; avatar_url?: string }
export interface ProfileTransaction {
  read(id: string): Promise<unknown | null>
  update(id: string, fields: ProfilePatch & { profile_version: number; updated_at: string }): Promise<void>
  enqueue(id: string, event: { openid: string; profile_version: number; status: 'pending'; attempt_count: 0; next_attempt_at: number; created_at: string }): Promise<void>
}
export interface ProfileUpdateStore {
  moderate(text: string): Promise<{ clean: boolean }>
  find(owner: string): Promise<unknown | null>
  run<T>(work: (transaction: ProfileTransaction) => Promise<T>): Promise<T>
  identifier(owner: string, version: number): string
  now(): string
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stored account')
  return value as Record<string, unknown>
}
function patch(value: unknown): ProfilePatch {
  const row = record(value)
  const result: ProfilePatch = {}
  if (row.nickname !== undefined) {
    if (typeof row.nickname !== 'string' || !row.nickname.trim() || row.nickname.trim().length > 30) throw Error('Invalid nickname')
    result.nickname = row.nickname.trim()
  }
  if (row.avatar_url !== undefined) {
    if (typeof row.avatar_url !== 'string' || row.avatar_url.trim().length > 2048) throw Error('Invalid avatar')
    result.avatar_url = row.avatar_url.trim()
  }
  if (Object.keys(result).length === 0) throw Error('Empty profile update')
  return result
}
export async function updateAccountProfile(store: ProfileUpdateStore, owner: string, input: unknown): Promise<{ user: SelfProfile; outboxId: string | null }> {
  let fields: ProfilePatch
  try { fields = patch(input) } catch (_) { throw new ProfileUpdateFailure('INVALID_INPUT') }
  const found = await store.find(owner)
  if (found === null) throw new ProfileUpdateFailure('NOT_FOUND')
  const initial = record(found)
  if (initial._openid !== owner) throw new ProfileUpdateFailure('FORBIDDEN')
  if (typeof initial._id !== 'string' || !initial._id) throw Error('Invalid account ID')
  const id = initial._id
  if (fields.nickname !== undefined && fields.nickname !== initial.nickname) {
    const verdict = await store.moderate(fields.nickname)
    if (verdict?.clean !== true) throw new ModerationFailure(verdict?.clean === false ? 'CONTENT_REJECTED' : 'MODERATION_UNAVAILABLE')
  }
  return store.run(async transaction => {
    const value = await transaction.read(id)
    if (value === null) throw new ProfileUpdateFailure('NOT_FOUND')
    const current = record(value)
    if (current._openid !== owner) throw new ProfileUpdateFailure('FORBIDDEN')
    const profile = projectSelfProfile(current, owner)
    if ((fields.nickname === undefined || fields.nickname === profile.nickname)
      && (fields.avatar_url === undefined || fields.avatar_url === profile.avatar_url)) return { user: profile, outboxId: null }
    const version = current.profile_version
    if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0 || version >= Number.MAX_SAFE_INTEGER) throw Error('Invalid profile version')
    const now = store.now()
    if (new Date(now).toISOString() !== now) throw Error('Invalid profile clock')
    const nextVersion = version + 1
    const outboxId = store.identifier(owner, nextVersion)
    const user = projectSelfProfile({ ...current, ...fields }, owner)
    await transaction.update(id, { ...fields, profile_version: nextVersion, updated_at: now })
    await transaction.enqueue(outboxId, { openid: owner, profile_version: nextVersion, status: 'pending', attempt_count: 0,
      next_attempt_at: Date.parse(now), created_at: now })
    return { user, outboxId }
  })
}
