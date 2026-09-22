import { test } from 'node:test'
import assert from 'node:assert/strict'

test('logout and a replacement login discard an already dispatched private response', async () => {
  const { AdminSessionScope, ExpiredAdminSession } = await import('../apps/admin/src/lib/session-scope.js')
  const scope = new AdminSessionScope()
  let deliver!: (value: string) => void
  const response = new Promise<string>(resolve => { deliver = resolve })
  const generation = scope.capture()
  const pending = response.then(value => { scope.assert(generation); return value })
  scope.invalidate()
  assert.throws(() => scope.capture(), ExpiredAdminSession)
  scope.begin()
  deliver('previous account private data')
  await assert.rejects(pending, ExpiredAdminSession)
  assert.doesNotThrow(() => scope.assert(scope.capture()))
})

test('revocation clears all subscribers even if one view cleanup fails', async () => {
  const { AdminSessionScope } = await import('../apps/admin/src/lib/session-scope.js')
  const scope = new AdminSessionScope()
  let privateState: string | null = 'protected'
  scope.subscribe(() => { throw Error('broken cleanup') })
  const unsubscribe = scope.subscribe(() => { privateState = null })
  scope.invalidate()
  assert.equal(privateState, null)
  unsubscribe()
  scope.begin()
  privateState = 'new view'
  scope.invalidate()
  assert.equal(privateState, 'new view')
})
