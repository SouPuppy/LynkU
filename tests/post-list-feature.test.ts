import test from 'node:test'
import assert from 'node:assert/strict'
import { PostListController, initialPostList } from '../apps/miniprogram/features/content/index'
import type { PublicPostPage, PostCursor } from '@lynku/contracts'

const empty = (): PublicPostPage => ({ items: [], total: 0, hasMore: false, nextCursor: null })
function fixture() {
  let revision = 0, state = initialPostList()
  const listeners = new Set<() => void>()
  const calls: Array<{ filter: string; cursor: PostCursor | null; resolve(page: PublicPostPage): void; reject(error: Error): void }> = []
  const controller = new PostListController({ revision: () => revision, subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn) } } },
    (filter, cursor) => new Promise<PublicPostPage>((resolve, reject) => calls.push({ filter, cursor, resolve, reject })), next => { state = next })
  return { controller, calls, state: () => state, listeners, change: () => { revision++; for (const fn of listeners) fn() } }
}
test('post list isolates filters, retries the submitted query and ignores a hidden response', async () => {
  const f = fixture()
  const a = f.controller.select('A'), b = f.controller.select('B')
  f.calls[1]!.resolve(empty()); await b
  f.calls[0]!.reject(Error('late A failure')); await a
  assert.equal(f.state().state, 'empty')
  const reload = f.controller.refresh()
  assert.equal(f.calls[2]!.filter, 'B')
  f.controller.hide(); f.calls[2]!.resolve(empty()); await reload
  f.controller.show()
  assert.equal(f.calls.length, 4)
  f.calls[3]!.resolve(empty()); await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.state().state, 'empty')
})
test('account change clears list state, rejects old-account replies, and disposal releases subscription', async () => {
  const f = fixture(), pending = f.controller.select('campus')
  f.change()
  assert.equal(f.state().items.length, 0); assert.equal(f.calls.length, 2)
  f.calls[0]!.reject(Error('old account')); await pending
  assert.equal(f.state().state, 'loading')
  f.controller.dispose()
  f.calls[1]!.resolve(empty()); await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.state().state, 'loading'); assert.equal(f.listeners.size, 0)
  f.change(); assert.equal(f.calls.length, 2)
})
