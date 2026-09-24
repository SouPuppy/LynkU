import type { PublicMessage } from '../../generated/contracts/index'

export type SendRecoveryAction = 'retry' | 'edit' | 'none'
export interface SendOperation {
  id: string
  text: string
  state: 'sending' | 'checking' | 'uncertain' | 'failed'
  error: string
  errorCode: string
  action: SendRecoveryAction
  submittedAt: number
  order: number
}
type RestoredOperation = Pick<SendOperation, 'id' | 'text' | 'state' | 'error'>
  & Partial<Pick<SendOperation, 'errorCode' | 'submittedAt' | 'order'>>
export interface SendOperationPorts<T extends { msg_id: string }> {
  send(id: string, text: string): Promise<T>
  lookup(id: string, text: string): Promise<T | null>
  save(operations: SendOperation[]): void
  valid(): boolean
  now(): number
  confirmed(message: T): void
  changed(operations: SendOperation[]): void
  storageFailed?(): void
}

const rejected: Record<string, { error: string; action: SendRecoveryAction }> = {
  CONTENT_REJECTED: { error: '内容未通过审核，请修改后发送', action: 'edit' },
  INVALID_INPUT: { error: '消息内容或会话无效，请修改或重新进入聊天', action: 'edit' },
  LEGACY_REJECTED: { error: '消息未发送，请修改后发送', action: 'edit' },
  RATE_LIMITED: { error: '发送太频繁，请稍后重试', action: 'retry' },
  RATE_LIMIT_UNAVAILABLE: { error: '服务暂时繁忙，请稍后重试', action: 'retry' },
  MODERATION_UNAVAILABLE: { error: '审核服务暂不可用，请稍后重试', action: 'retry' },
  FORBIDDEN: { error: '当前无法发送给对方', action: 'none' },
  EMAIL_NOT_VERIFIED: { error: '完成学校认证后才能发送', action: 'none' },
  NOT_FOUND: { error: '会话或对方已不可用', action: 'none' },
  CONFLICT: { error: '这条消息的发送记录冲突，请重新进入聊天', action: 'none' },
}
const uncertain: Record<string, string> = {
  UNCONFIRMED: '发送结果未确认',
  NOT_CONFIRMED: '暂未找到发送记录',
  LOOKUP_UNAVAILABLE: '暂时无法确认发送结果',
  NETWORK_ERROR: '网络中断，发送结果未确认',
  INVALID_RESPONSE: '发送结果未确认',
}
function rejection(code: string): { error: string; action: SendRecoveryAction } | undefined {
  return Object.prototype.hasOwnProperty.call(rejected, code) ? rejected[code] : undefined
}
function failureCode(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  return typeof code === 'string' && (rejection(code) || Object.prototype.hasOwnProperty.call(uncertain, code)) ? code : 'UNCONFIRMED'
}
function markUncertain(item: SendOperation, code = 'UNCONFIRMED'): void {
  item.state = 'uncertain'; item.errorCode = code; item.error = uncertain[code] || uncertain.UNCONFIRMED!; item.action = 'retry'
}
function markFailure(item: SendOperation, error: unknown): void {
  const code = failureCode(error), known = rejection(code)
  if (!known) { markUncertain(item, code); return }
  item.state = 'failed'; item.errorCode = code; item.error = known.error; item.action = known.action
}
function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000
}
function restore(item: RestoredOperation, now: number, order: number): SendOperation {
  const result: SendOperation = { id: item.id, text: item.text, state: 'uncertain', error: '', errorCode: '', action: 'retry',
    submittedAt: validTimestamp(item.submittedAt) ? item.submittedAt : validTimestamp(now) ? now : 0,
    order: typeof item.order === 'number' && Number.isSafeInteger(item.order) && item.order >= 0 ? item.order : order }
  if (item.state === 'failed') markFailure(result, { code: rejection(item.errorCode || '') ? item.errorCode : 'LEGACY_REJECTED' })
  else markUncertain(result, typeof item.errorCode === 'string' && Object.prototype.hasOwnProperty.call(uncertain, item.errorCode) ? item.errorCode : 'UNCONFIRMED')
  return result
}

/** Validate disk data separately from the in-memory state; never trust persisted error text or actions. */
export function parseStoredSendOperations(value: unknown, now: number): SendOperation[] {
  if (value === undefined || value === null || value === '') return []
  if (!Array.isArray(value) || value.length > 20) throw Error('待发送记录无法读取')
  const ids = new Set<string>()
  return value.map((entry: unknown, index) => {
    if (!entry || typeof entry !== 'object') throw Error('待发送记录无法读取')
    const item = entry as Record<string, unknown>
    if (typeof item.id !== 'string' || !item.id || item.id.length > 128 || ids.has(item.id)
      || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 5000
      || !['sending', 'checking', 'uncertain', 'failed'].includes(String(item.state))) throw Error('待发送记录无法读取')
    ids.add(item.id)
    return restore({ id: item.id, text: item.text, state: item.state as SendOperation['state'], error: '',
      errorCode: typeof item.errorCode === 'string' ? item.errorCode : undefined,
      submittedAt: typeof item.submittedAt === 'number' ? item.submittedAt : undefined,
      order: typeof item.order === 'number' ? item.order : undefined }, now, index)
  })
}

/** A durable, immutable submission. Recovery only reads; only explicit retry can transmit again. */
export class SendOperations<T extends { msg_id: string } = PublicMessage> {
  private operations: SendOperation[]
  private busy = new Set<string>()
  private accepted = new Set<string>()
  private confirmations = new Map<string, { attempts: number; nextAt: number }>()
  private nextOrder: number
  constructor(private readonly ports: SendOperationPorts<T>, restored: RestoredOperation[]) {
    const now = ports.now()
    this.operations = restored.map((item, index) => restore(item, now, index))
    this.nextOrder = Math.max(-1, ...this.operations.map(item => item.order)) + 1
  }
  snapshot(): SendOperation[] { return this.operations.map(item => ({ ...item })) }
  private submissionOrder(): number {
    if (!Number.isSafeInteger(this.nextOrder)) {
      // Disk ordering is only relative. Compact extreme values before the next increment can lose precision.
      const ordered = [...this.operations].sort((a, b) => a.order - b.order)
      ordered.forEach((item, index) => { item.order = index })
      this.nextOrder = ordered.length
    }
    return this.nextOrder++
  }
  private current(item: SendOperation): boolean { return this.ports.valid() && this.operations.includes(item) }
  private changed(): void { if (this.ports.valid()) this.ports.changed(this.snapshot()) }
  private saveProgress(): void {
    // A storage error after dispatch is not a failed send. The last durable record can be looked up on restart.
    try { this.ports.save(this.snapshot()) } catch (_) { this.ports.storageFailed?.() }
  }
  private publish(): void { this.saveProgress(); this.changed() }
  async submit(id: string, text: string, replacesId?: string): Promise<void> {
    if (!this.ports.valid()) throw Error('会话已变更，请重新进入聊天')
    if (this.operations.some(item => item.id === id) || this.accepted.has(id)) return
    const replaced = replacesId === undefined ? undefined : this.operations.find(item => item.id === replacesId
      && item.state === 'failed' && item.action === 'edit' && !this.busy.has(item.id))
    if (replacesId !== undefined && !replaced) throw Error('这条消息状态已变化，请重新操作')
    if (!replaced && this.operations.length >= 20) throw Error('请先处理待确认的消息')
    if (!id || id.length > 128 || !text.trim() || text.length > 5000) throw Error('请输入有效的消息内容')
    const now = this.ports.now()
    const item: SendOperation = { id, text, state: 'sending', error: '', errorCode: '', action: 'none',
      submittedAt: validTimestamp(now) ? now : 0, order: this.submissionOrder() }
    const previous = this.operations
    this.operations = [...previous.filter(operation => operation !== replaced), item]
    try { this.ports.save(this.snapshot()) } catch (error) {
      this.operations = previous
      throw error
    }
    if (replaced) this.confirmations.delete(replaced.id)
    this.changed()
    this.busy.add(id)
    try { await this.transmit(item) } finally { this.busy.delete(id) }
  }
  private async transmit(item: SendOperation): Promise<void> {
    if (!this.current(item)) return
    let message: T
    try { message = await this.ports.send(item.id, item.text) } catch (error) {
      if (this.current(item)) { markFailure(item, error); this.publish() }
      return
    }
    if (!this.current(item)) return
    if (message.msg_id !== item.id) { markUncertain(item, 'INVALID_RESPONSE'); this.publish(); return }
    this.accept(message)
  }
  accept(message: T): void {
    if (!this.ports.valid() || this.accepted.has(message.msg_id)) return
    const item = this.operations.find(operation => operation.id === message.msg_id)
    if (!item) return
    this.accepted.add(item.id)
    this.confirmations.delete(item.id)
    this.operations = this.operations.filter(operation => operation !== item)
    this.saveProgress()
    this.ports.confirmed(message)
    this.changed()
  }
  async recover(): Promise<void> {
    for (const item of [...this.operations]) {
      if (!this.ports.valid()) return
      if (item.state === 'uncertain') await this.check(item, false)
    }
  }
  private removeFailed(id: string, action?: SendRecoveryAction): SendOperation | null {
    const item = this.operations.find(operation => operation.id === id && operation.state === 'failed' && (!action || operation.action === action))
    if (!item || !this.ports.valid() || this.busy.has(id)) return null
    const remaining = this.operations.filter(operation => operation !== item)
    // Editing/removing must durably retire the old id before handing its text back to the composer.
    this.ports.save(remaining.map(operation => ({ ...operation })))
    this.operations = remaining
    this.confirmations.delete(id)
    this.changed()
    return item
  }
  editFailed(id: string): string | null { return this.removeFailed(id, 'edit')?.text ?? null }
  discard(id: string): boolean { return this.removeFailed(id, 'none') !== null }
  async retry(id: string): Promise<void> {
    const item = this.operations.find(operation => operation.id === id && operation.action === 'retry')
    if (item) await this.check(item, true)
  }
  private async check(item: SendOperation, userRetry: boolean): Promise<void> {
    if (!this.current(item) || this.busy.has(item.id)) return
    if (!userRetry && (this.confirmations.get(item.id)?.nextAt || 0) > this.ports.now()) return
    const previous = { state: item.state, errorCode: item.errorCode }
    this.busy.add(item.id)
    item.state = 'checking'; item.error = ''; item.errorCode = ''; item.action = 'none'; this.publish()
    try {
      let found: T | null
      try { found = await this.ports.lookup(item.id, item.text) } catch (_) {
        if (this.current(item)) {
          if (previous.state === 'failed') markFailure(item, { code: previous.errorCode })
          else markUncertain(item, 'LOOKUP_UNAVAILABLE')
          this.publish()
        }
        return
      }
      if (!this.current(item)) return
      if (found) {
        if (found.msg_id === item.id) this.accept(found)
        else { markUncertain(item, 'INVALID_RESPONSE'); this.publish() }
        return
      }
      if (!userRetry) { markUncertain(item, 'NOT_CONFIRMED'); this.publish(); return }
      item.state = 'sending'; item.error = ''; item.errorCode = ''; item.action = 'none'; this.publish()
      // Keep the same lock across lookup and transmission; accept() may retire the operation during either await.
      if (this.current(item)) await this.transmit(item)
    } finally {
      this.busy.delete(item.id)
      if (this.current(item)) {
        const attempts = Math.min(6, (this.confirmations.get(item.id)?.attempts || 0) + 1)
        this.confirmations.set(item.id, { attempts, nextAt: this.ports.now() + Math.min(60000, 1000 * 2 ** attempts) })
      }
    }
  }
}
