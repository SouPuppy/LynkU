import * as session from './session'

export interface ChatDraft {
  load(): string
  save(text: unknown): void
  remove(): void
}

interface DraftEntry { conversation: string; text: string }
const MAX_DRAFTS = 50
const MAX_LENGTH = 5000
const keyFor = (owner: string) => `message_composer_v1:${encodeURIComponent(owner)}`

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value
}

function read(key: string): DraftEntry[] {
  let saved: unknown
  try { saved = wx.getStorageSync(key) } catch { throw Error('未发送内容暂时无法读取') }
  if (saved === undefined || saved === null || saved === '') return []
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw Error('未发送内容暂时无法读取')
  const bucket = saved as Record<string, unknown>
  if (bucket.version !== 1 || !Array.isArray(bucket.drafts) || bucket.drafts.length > MAX_DRAFTS) {
    throw Error('未发送内容暂时无法读取')
  }
  const seen = new Set<string>()
  return bucket.drafts.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('未发送内容暂时无法读取')
    const entry = value as Record<string, unknown>
    if (!identifier(entry.conversation) || seen.has(entry.conversation) || typeof entry.text !== 'string'
      || entry.text.length === 0 || entry.text.length > MAX_LENGTH) throw Error('未发送内容暂时无法读取')
    seen.add(entry.conversation)
    return { conversation: entry.conversation, text: entry.text }
  })
}

function write(key: string, drafts: DraftEntry[]): void {
  try {
    // One write owns both identity and text; no separate index can orphan a draft.
    if (drafts.length) wx.setStorageSync(key, { version: 1, drafts })
    else wx.removeStorageSync(key)
  } catch { throw Error('未发送内容暂未保存，请保留当前页面后重试') }
}

/** Only established server conversation IDs belong here, never a new anonymous initiation. */
export function createChatDraft(conversation: unknown): ChatDraft {
  if (!identifier(conversation)) throw Error('会话暂不可用')
  const owner = session.getOpenid(), revision = session.getRevision()
  if (!owner || session.getState() !== 'verified') throw Error('会话已变更，请重新进入聊天')
  const key = keyFor(owner)
  const current = () => {
    if (session.getRevision() !== revision || session.getOpenid() !== owner || session.getState() !== 'verified') {
      throw Error('会话已变更，请重新进入聊天')
    }
  }
  const remove = () => {
    current()
    const drafts = read(key)
    const remaining = drafts.filter(entry => entry.conversation !== conversation)
    if (remaining.length !== drafts.length) write(key, remaining)
  }
  return {
    load: () => {
      current()
      return read(key).find(entry => entry.conversation === conversation)?.text || ''
    },
    save: (text: unknown) => {
      current()
      if (typeof text !== 'string' || text.length > MAX_LENGTH) throw Error('消息最多输入 5000 字')
      if (!text) { remove(); return }
      const drafts = read(key)
      const previous = drafts.find(entry => entry.conversation === conversation)
      if (previous?.text === text) return
      if (!previous && drafts.length >= MAX_DRAFTS) throw Error('未发送内容较多，请先处理其他聊天中的内容')
      write(key, [...drafts.filter(entry => entry.conversation !== conversation), { conversation, text }])
    },
    remove,
  }
}
