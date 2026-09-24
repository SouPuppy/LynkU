import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import ts from 'typescript'

type Row = Record<string, unknown>
const hash = (...parts: string[]) => createHash('sha256').update(parts.join('\0')).digest('hex')
const requireDependency = createRequire(path.join(process.cwd(), 'package.json'))
const source = ts.transpileModule(readFileSync('tooling/migrate-notification-identifiers.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText

function migrationFixture(t: { after(work: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'lynku-migration-test-'))
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep))
    rmSync(root, { recursive: true })
  })
  mkdirSync(path.join(root, 'config'))
  writeFileSync(path.join(root, 'config/project.json'), JSON.stringify({ appId: 'fixture-app', cloudEnvironment: 'fixture-env' }))
  const tables = new Map<string, Map<string, Row>>()
  let writes = 0
  function records(name: string) { let table = tables.get(name); if (!table) { table = new Map(); tables.set(name, table) }; return table }
  function matches(item: Row, filter: Row): boolean {
    return Object.entries(filter).every(([key, value]) => {
      if (value && typeof value === 'object' && '$gt' in value) return String(item[key]) > String(value.$gt)
      return JSON.stringify(item[key]) === JSON.stringify(value)
    })
  }
  function run(args: string[]): Row {
    let output = ''
    const module = { exports: {} }
    vm.runInNewContext(source, { module, exports: module.exports,
      process: { cwd: () => root, execPath: process.execPath, argv: ['node', 'tool', '--environment', 'fixture-env', ...args],
        stdout: { write: (text: string) => { output += text } } },
      require: (name: string) => name !== 'node:child_process' ? requireDependency(name) : {
        spawnSync: (_command: string, argv: string[]) => {
          const request = JSON.parse(argv[argv.indexOf('--command') + 1]!) as { TableName: string; Command: string }[]
          const entry = request[0]!, command = JSON.parse(entry.Command) as Row, table = records(entry.TableName)
          let result: unknown = {}
          if (command.find) result = [...table.values()].filter(item => matches(item, command.filter as Row))
            .sort((a, b) => String(a._id).localeCompare(String(b._id))).slice(0, Number(command.limit))
          else if (command.update) {
            for (const operation of command.updates as { q: Row; u: Row; upsert?: boolean }[]) {
              writes++
              const found = [...table.values()].find(item => matches(item, operation.q))
              if (found) Object.assign(found, operation.u.$set || {})
              else if (operation.upsert) table.set(String(operation.q._id), { _id: operation.q._id, ...operation.u.$setOnInsert as Row })
            }
          } else if (command.delete) {
            writes++
            for (const operation of command.deletes as { q: Row }[]) for (const [id, item] of table) if (matches(item, operation.q)) table.delete(id)
          } else throw Error('Unexpected command')
          return { status: 0, stdout: JSON.stringify({ data: { results: [result] } }) }
        },
      },
    })
    return JSON.parse(output) as Row
  }
  return { run, records, writes: () => writes }
}

test('notification migration dry-run is read-only and apply/replay preserve read state and event time', t => {
  const f = migrationFixture(t), table = f.records('notifications')
  const oldId = hash('notification', 'comment', 'recipient', 'secret', 'comment')
  const saved = { _id: oldId, to: 'recipient', type: 'comment', anonymous: true, actor: { _openid: 'secret' },
    target: { comment_id: 'comment', post_id: 'post' }, read: true, created_at: { $date: '2026-01-01T00:00:00Z' } }
  table.set(oldId, saved)
  const preview = f.run([])
  assert.equal(f.writes(), 0)
  const args = ['--apply', '--maintenance', '--backup', String(preview.backupPath), '--sha256', String(preview.sha256)]
  f.run(args); f.run(args)
  const canonical = hash('notification', 'v2', 'comment', 'recipient', 'comment')
  assert.equal(table.size, 1)
  assert.equal(table.get(canonical)?.read, true)
  assert.deepEqual(table.get(canonical)?.created_at, saved.created_at)
  assert.throws(() => f.run([...args.slice(0, -1), 'wrong-hash']), /hash mismatch/)
})

test('legacy block migration creates opaque owner-only undo records without reconstructing anonymous peers', t => {
  const f = migrationFixture(t), table = f.records('messaging_blocks')
  const blockId = hash('messaging:block', 'alice', 'hidden-peer')
  table.set(blockId, { _id: blockId, blockedBy: ['alice'], version: { $numberInt: '1' }, updatedAt: { $date: '2026-01-01T00:00:00Z' } })
  const preview = f.run(['--blocks'])
  assert.equal(f.writes(), 0)
  const args = ['--blocks', '--apply', '--maintenance', '--backup', String(preview.backupPath), '--sha256', String(preview.sha256)]
  f.run(args); f.run(args)
  const operations = [...f.records('messaging_block_operations').values()]
  assert.equal(operations.length, 1)
  const operation = operations[0]!
  assert.equal(operation.owner, 'alice')
  assert.equal(operation.label, '历史屏蔽记录')
  assert.equal(operation.peer, undefined)
  assert.notEqual(operation._id, blockId)
  assert.deepEqual(table.get(blockId)?.blockedBy, ['alice'])
  assert.equal(table.get(blockId)?.version, 2)
})
