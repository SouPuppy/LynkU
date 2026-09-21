// WeChat provides identity; email verification only changes account permissions.
import type { ISelfProfile } from '../typings/cloudbase'
import { callCloud, CloudCallError } from './cloud'
import * as session from './session'
import { parseSelfProfileResponse } from '../generated/contracts/index'

let pending: { revision: number; promise: Promise<ISelfProfile> } | null = null
export function ensureLogin(): Promise<ISelfProfile> {
  const revision = session.getRevision()
  if (pending?.revision === revision) return pending.promise
  const promise = (async () => {
    const result = await callCloud<unknown>('users', { action: 'ensure' })
    if (revision !== session.getRevision()) throw new Error('会话已变更，请重新操作')
    let profile: ISelfProfile
    try {
      profile = parseSelfProfileResponse(result)
    } catch (_) { throw new CloudCallError('微信身份返回了无效数据，请重试', 'INVALID_RESPONSE', 'users', 'ensure') }
    session.setIfCurrent(profile, revision)
    return profile
  })()
  const current = { revision, promise }
  pending = current
  void promise.finally(() => { if (pending === current) pending = null }).catch(() => {})
  return promise
}
