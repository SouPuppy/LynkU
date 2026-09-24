import type { PublicMessage } from '../../generated/contracts/index'

export interface SendOperation {
  id: string
  text: string
  state: 'sending' | 'uncertain' | 'failed'
  error: string
}
export interface SendOperationPorts<T extends { msg_id: string }> {
  send(id: string, text: string): Promise<T>
  lookup(id: string, text: string): Promise<T | null>
  save(operations: SendOperation[]): void
  valid(): boolean
  now(): number
  confirmed(message: T): void
  changed(operations: SendOperation[]): void
}

/** Submitted text and id are independent of the editable composer. Never auto-resends. */
export class SendOperations<T extends { msg_id: string } = PublicMessage> {
  private operations: SendOperation[]
  private busy = new Set<string>()
  private confirmations = new Map<string, { attempts: number; nextAt: number }>()
  constructor(private readonly ports: SendOperationPorts<T>, restored: SendOperation[]) {
    this.operations = restored.map(item => ({ ...item, state: item.state === 'sending' ? 'uncertain' : item.state }))
  }
  snapshot(): SendOperation[] { return this.operations.map(item => ({ ...item })) }
  private publish(): void {
    this.ports.save(this.snapshot())
    if (this.ports.valid()) this.ports.changed(this.snapshot())
  }
  async submit(id: string, text: string): Promise<void> {
    if (!this.ports.valid() || this.operations.length >= 20) throw Error('请先处理待确认的消息')
    if (this.operations.some(item => item.id === id)) return
    const item: SendOperation = { id, text, state: 'sending', error: '' }
    this.operations.push(item)
    try { this.publish() } catch (error) { this.operations.pop(); throw error }
    await this.transmit(item)
  }
  private async transmit(item: SendOperation): Promise<void> {
    if (!this.ports.valid() || this.busy.has(item.id)) return
    this.busy.add(item.id)
    try {
      const message = await this.ports.send(item.id, item.text)
      if (!this.ports.valid()) return
      this.accept(message)
    } catch (error) {
      if (!this.ports.valid()) return
      const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
      item.state = ['INVALID_INPUT', 'CONTENT_REJECTED', 'FORBIDDEN', 'EMAIL_NOT_VERIFIED', 'RATE_LIMITED', 'CONFLICT', 'NOT_FOUND'].includes(String(code)) ? 'failed' : 'uncertain'
      item.error = item.state === 'failed' && error instanceof Error ? error.message : '发送结果未确认，点击检查'
      this.publish()
    } finally { this.busy.delete(item.id) }
  }
  accept(message: T): void {
    if (!this.ports.valid()) return
    const item = this.operations.find(operation => operation.id === message.msg_id)
    if (!item) return
    this.confirmations.delete(item.id)
    this.ports.confirmed(message)
    this.operations = this.operations.filter(operation => operation !== item)
    this.publish()
  }
  async recover(): Promise<void> {
    for (const item of [...this.operations]) {
      if (!this.ports.valid()) return
      if (item.state === 'failed') continue
      await this.check(item, false)
    }
  }
  editFailed(id: string): string | null {
    const item = this.operations.find(operation => operation.id === id && operation.state === 'failed')
    if (!item || !this.ports.valid()) return null
    const previous = this.operations
    this.operations = this.operations.filter(operation => operation !== item)
    try { this.publish() } catch (error) { this.operations = previous; throw error }
    return item.text
  }
  async retry(id: string): Promise<void> {
    const item = this.operations.find(operation => operation.id === id)
    if (item) await this.check(item, true)
  }
  private async check(item: SendOperation, userRetry: boolean): Promise<void> {
    if (!this.ports.valid() || this.busy.has(item.id)) return
    if (!userRetry && (this.confirmations.get(item.id)?.nextAt || 0) > this.ports.now()) return
    this.busy.add(item.id)
    let absent = false
    try {
      const found = await this.ports.lookup(item.id, item.text)
      if (!this.ports.valid()) return
      if (found) this.accept(found)
      else { absent = true; item.state = 'uncertain'; item.error = '尚未确认发送，点击重试'; this.publish() }
    } catch (_) {
      if (this.ports.valid()) { item.state = 'uncertain'; item.error = '暂时无法确认，点击检查'; this.publish() }
    } finally {
      this.busy.delete(item.id)
      if (this.operations.includes(item)) {
        const attempts = Math.min(6, (this.confirmations.get(item.id)?.attempts || 0) + 1)
        this.confirmations.set(item.id, { attempts, nextAt: this.ports.now() + Math.min(60000, 1000 * 2 ** attempts) })
      }
    }
    if (absent && userRetry && this.ports.valid()) {
      item.state = 'sending'; item.error = ''; this.publish()
      await this.transmit(item)
    }
  }
}
