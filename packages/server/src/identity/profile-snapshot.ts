import { projectSelfProfile } from './self-profile'
export interface ProfileSnapshot { owner: string; nickname: string; avatar_url: string; version: number }
export function profileSnapshot(value: unknown, owner: string): ProfileSnapshot {
  const profile = projectSelfProfile(value, owner)
  const version = (value as Record<string, unknown>).profile_version
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) throw Error('Invalid profile snapshot version')
  return { owner, nickname: profile.nickname, avatar_url: profile.avatar_url, version }
}
