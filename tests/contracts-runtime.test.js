const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')

test('shared directory request contract rejects invalid limits and cursor shapes', () => {
  const { parseConversationDirectoryRequest: parse } = require('@lucky/contracts')
  assert.deepEqual(parse({}), { limit: 20 })
  for (const limit of [null, '20', 0, -1, 51, 1.5, NaN, Infinity]) {
    assert.throws(() => parse({ limit }))
  }
  for (const cursor of [null, [], {}, { version: 1, scope: 'a'.repeat(64), id: 'b'.repeat(64), updatedAt: '2026-02-30T00:00:00.000Z' }]) {
    assert.throws(() => parse({ cursor }))
  }
})

test('every cloud bundle executes independently outside the workspace', () => {
  const result = spawnSync(process.execPath, ['tooling/check-cloud-artifacts.mjs'], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})

test('WeChat contract sources match the canonical package', () => {
  const canonical = path.join(root, 'packages/contracts/src')
  const generated = path.join(root, 'apps/miniprogram/generated/contracts')
  assert.deepEqual(fs.readdirSync(generated).sort(), fs.readdirSync(canonical).sort())
  for (const file of fs.readdirSync(canonical)) {
    assert.equal(fs.readFileSync(path.join(generated, file), 'utf8'), fs.readFileSync(path.join(canonical, file), 'utf8'))
  }
})
