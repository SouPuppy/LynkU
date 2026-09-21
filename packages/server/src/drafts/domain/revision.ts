export function assertDraftRevision(storedRevision: number, expectedRevision: number | undefined): number {
  if (!Number.isSafeInteger(storedRevision) || storedRevision < 1) {
    throw new Error('stored draft revision must be a positive integer')
  }
  if (expectedRevision !== undefined) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new Error('expected draft revision must be a positive integer')
    }
    if (expectedRevision !== storedRevision) throw new Error('draft revision conflict')
  }
  return storedRevision + 1
}
