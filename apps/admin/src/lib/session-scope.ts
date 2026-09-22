/** A rejected request may have committed on the server; it must never restore an old UI session. */
export class ExpiredAdminSession extends Error {
  constructor() { super('管理会话已结束，请重新登录') }
}

export class AdminSessionScope {
  private generation = 0
  private enabled = true
  private readonly listeners = new Set<() => void>()

  begin(): number { this.enabled = true; return ++this.generation }
  capture(): number {
    if (!this.enabled) throw new ExpiredAdminSession()
    return this.generation
  }
  assert(generation: number): void {
    if (!this.enabled || generation !== this.generation) throw new ExpiredAdminSession()
  }
  invalidate(): void {
    this.enabled = false
    this.generation++
    for (const listener of this.listeners) {
      try { listener() } catch { /* Every protected view must receive invalidation. */ }
    }
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}
