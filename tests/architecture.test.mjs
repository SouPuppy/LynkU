import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { checkArchitecture } from '../tooling/architecture/check.mjs'
import { validArchitecture, violations } from '../tooling/architecture/fixtures.mjs'

async function inspectFixture(files, legacy = false) {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'lucky-architecture-'))
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const relative = legacy ? relativePath.replace(/^apps\//, '') : relativePath
      const filename = path.join(temporaryRoot, relative)
      mkdirSync(path.dirname(filename), { recursive: true })
      writeFileSync(filename, content)
    }
    return await checkArchitecture(temporaryRoot)
  } finally {
    // The target is the exact directory returned by mkdtemp, never a source path.
    assert.equal(path.dirname(temporaryRoot), path.resolve(tmpdir()))
    assert.ok(path.basename(temporaryRoot).startsWith('lucky-architecture-'))
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

test('architecture accepts public entry points and injected platform composition', async () => {
  const result = await inspectFixture(validArchitecture)
  assert.deepEqual(result.violations, [])
  assert.ok(result.moduleCount >= Object.keys(validArchitecture).length)
})

test('architecture parses code rather than treating comments, text and DTO keys as platform access', async () => {
  const result = await inspectFixture({
    ...validArchitecture,
    'packages/contracts/src/labels.ts': '// wx process require getApp\nexport const labels = { wx: "wx process require" }; export interface Labels { process: string }',
  })
  assert.deepEqual(result.violations, [])
})

for (const fixture of violations) {
  test(`architecture rejects ${fixture.name}`, async () => {
    const result = await inspectFixture({ ...validArchitecture, ...fixture.files })
    assert.ok(result.violations.some(violation => violation.rule.name === fixture.rule),
      `Expected ${fixture.rule}, got ${JSON.stringify(result.violations)}`)
  })
}

test('architecture rules also protect the original source roots during directory migration', async () => {
  const result = await inspectFixture({
    ...validArchitecture,
    'apps/miniprogram/pages/invalid.ts': "export { label } from '../subpkg-chat/features/thread'",
  }, true)
  assert.ok(result.violations.some(violation => violation.rule.name === 'main-package-does-not-import-chat'))
})
