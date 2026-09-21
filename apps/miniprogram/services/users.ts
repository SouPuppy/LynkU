// services/users.ts — User profile data access
// All user and post-count reads go through privacy-safe cloud functions.
// Cache: delegated to session.ts
// Per design: docs/design/user-system-consolidation/

import type { ISelfProfile, IUserPublic } from '../typings/cloudbase'
import { callCloud, CloudCallError } from './cloud'
import { parseSelfProfileResponse } from '../generated/contracts/index'
import { parseProfileId, parsePublicProfileResponse } from '../generated/contracts/index'
import * as session from './session'

/** Get user's public profile (via cloud function — bypasses collection ACL) */
export async function getProfile(openid: string): Promise<IUserPublic | null> {
  parseProfileId(openid)
  const revision = session.getRevision()
  const res = await callCloud<unknown>('users', { action: 'getProfile', openid })
  if (revision !== session.getRevision()) throw new Error('会话已变更，请重新操作')
  try { return parsePublicProfileResponse(res, openid) } catch (_) {
    throw new CloudCallError('公开资料返回了无效数据', 'INVALID_RESPONSE', 'users', 'getProfile')
  }
}

/** Update own profile (nickname, avatar). Syncs denormalized author data. */
export async function updateProfile(data: {
  nickname?: string
  avatar_url?: string
}): Promise<ISelfProfile> {
  const revision = session.getRevision()
  const res = await callCloud<unknown>('users', {
    action: 'updateProfile',
    nickname: data.nickname,
    avatar_url: data.avatar_url,
  })
  return saveProfileResponse(res, revision, 'updateProfile')
}

export async function sendEmailCode(email: string): Promise<{ email: string; expiresIn: number }> {
  return callCloud<{ email: string; expiresIn: number }>('users', {
    action: 'sendEmailCode',
    email,
  })
}

export async function verifyEmailCode(email: string, code: string): Promise<ISelfProfile> {
  const revision = session.getRevision()
  const res = await callCloud<unknown>('users', {
    action: 'verifyEmailCode',
    email,
    code,
  })
  return saveProfileResponse(res, revision, 'verifyEmailCode')
}

function saveProfileResponse(value: unknown, revision: number, action: string): ISelfProfile {
  if (revision !== session.getRevision()) throw new Error('会话已变更，请重新操作')
  let profile: ISelfProfile
  try { profile = parseSelfProfileResponse(value) } catch (_) {
    throw new CloudCallError('账号返回了无效数据', 'INVALID_RESPONSE', 'users', action)
  }
  if (profile._openid !== session.getOpenid()) throw new CloudCallError('账号返回了其他用户的数据', 'INVALID_RESPONSE', 'users', action)
  session.setIfCurrent(profile, revision)
  return profile
}
