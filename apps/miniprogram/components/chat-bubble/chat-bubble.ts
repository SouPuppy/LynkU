Component({
  properties: {
    message: { type: Object, value: null },
  },
  methods: {
    onRetry() { this.triggerEvent('retry') },
    onEdit() { this.triggerEvent('edit') },
    onDiscard() { this.triggerEvent('discard') },
  },
})
