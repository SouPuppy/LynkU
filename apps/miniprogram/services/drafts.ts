// Draft API: deployment failures stay failures; editor emergency storage owns offline recovery.
import type { IDraft } from '../typings/cloudbase'
import { callCloud, CloudCallError } from './cloud'
import { getRevision } from './session'
import { parseDraft, parseDraftList, parseDraftSave, parseDraftId } from '../generated/contracts/index'
import type { SaveDraftRequest } from '../generated/contracts/index'

function invalidResponse(action: string): CloudCallError {
  return new CloudCallError('草稿服务返回了无效数据', 'INVALID_RESPONSE', 'drafts', action)
}
export async function saveDraft(data: SaveDraftRequest): Promise<IDraft> {
  const request = parseDraftSave(data)
  const revision = getRevision()
  const result = await callCloud<unknown>('drafts', { action: 'save', ...request })
  if (revision !== getRevision()) throw new Error('会话已变更')
  try {
    if (!result || typeof result !== 'object' || !('draft' in result)) throw new Error('Invalid draft response')
    return parseDraft(result.draft)
  } catch (_) { throw invalidResponse('save') }
}
export async function listDrafts(): Promise<IDraft[]> {
  const revision = getRevision()
  const result = await callCloud<unknown>('drafts', { action: 'list' })
  if (revision !== getRevision()) throw new Error('会话已变更')
  try { return parseDraftList(result) } catch (_) { throw invalidResponse('list') }
}
export async function deleteDraft(draftId: string, expectedRevision?: number): Promise<void> {
  const revision = getRevision()
  const result = await callCloud<unknown>('drafts', { action: 'delete', draft_id: parseDraftId(draftId), expected_revision: expectedRevision })
  if (revision !== getRevision()) throw new Error('会话已变更')
  if (!result || typeof result !== 'object' || !('deleted' in result) || result.deleted !== true) throw invalidResponse('delete')
}
