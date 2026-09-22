export interface ViewSessionPort { revision(): number; subscribe(listener: () => void): () => void }
export interface ViewToken { generation: number; revision: number }

/** A view owns its requests; account changes, hiding and disposal invalidate their results. */
export class ViewScope {
  private generation = 0
  private visible = true
  private disposed = false
  private readonly unsubscribe: () => void
  constructor(private readonly session: ViewSessionPort, changed: (visible: boolean) => void) {
    this.unsubscribe = session.subscribe(() => {
      this.generation++
      if (!this.disposed) changed(this.visible)
    })
  }
  capture(): ViewToken { return { generation: this.generation, revision: this.session.revision() } }
  current(token: ViewToken): boolean {
    return !this.disposed && this.visible && token.generation === this.generation && token.revision === this.session.revision()
  }
  show(): void { if (!this.disposed) this.visible = true }
  hide(): void { this.visible = false; this.generation++ }
  dispose(): void { this.hide(); this.disposed = true; this.unsubscribe() }
}
