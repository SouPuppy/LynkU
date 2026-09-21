import type { SelfProfile } from '@lucky/contracts'
import { projectSelfProfile } from './self-profile'
export interface NewAccount {
  _id: string
  _openid: string
  nickname: string
  avatar_url: string
  role: 'user'
  email: string
  verified: false
  profile_version: 0
  created_at: string
  updated_at: string
}
export interface AccountStore {
  find(owner: string): Promise<unknown | null>
  createIfAbsent(account: NewAccount): Promise<unknown>
  identifier(owner: string): string
  now(): string
}
/** Startup identifies accounts only. Profile editing and schema migration are separate operations. */
export async function ensureAccount(store: AccountStore, owner: string): Promise<SelfProfile> {
  if (!owner || owner.length > 128) throw new Error('Invalid account identity')
  const existing = await store.find(owner)
  if (existing !== null) return projectSelfProfile(existing, owner)
  const now = store.now()
  if (new Date(now).toISOString() !== now) throw new Error('Invalid account clock')
  const account: NewAccount = { _id: store.identifier(owner), _openid: owner, nickname: '微信用户', avatar_url: '',
    email: '', role: 'user', verified: false, profile_version: 0, created_at: now, updated_at: now }
  return projectSelfProfile(await store.createIfAbsent(account), owner)
}
