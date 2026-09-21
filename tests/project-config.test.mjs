import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { configureProject, validateProjectConfig } from '../tooling/configure-project.mjs'

const config = { name: 'LynkU', appId: 'wxba2bcb0c71a5f33d', cloudEnvironment: 'cloud1-demo', baseLibrary: '3.17.3', emailVerificationEnabled: false, debug: false }

test('public configuration rejects secrets, malformed IDs and ambiguous feature flags', () => {
  for (const invalid of [null, [], { ...config, MAILGUN_API_KEY: 'not-a-real-key' }, { ...config, appId: 'old-app' }, { ...config, cloudEnvironment: '../other' }, { ...config, emailVerificationEnabled: 'false' }]) {
    assert.throws(() => validateProjectConfig(invalid))
  }
  assert.deepEqual(validateProjectConfig(config), config)
})

test('configuration switches every public target together, preserves compiler/functions and detects drift without repair', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lynku-config-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'config'), { recursive: true })
  fs.mkdirSync(path.join(root, 'apps/miniprogram'), { recursive: true })
  fs.writeFileSync(path.join(root, 'config/project.json'), JSON.stringify(config))
  fs.writeFileSync(path.join(root, 'project.config.json'), JSON.stringify({ setting: { useCompilerPlugins: ['typescript'] } }))
  fs.writeFileSync(path.join(root, 'cloudbaserc.json'), JSON.stringify({ functions: [{ name: 'users', runtime: 'Nodejs16.13' }] }))
  fs.writeFileSync(path.join(root, 'apps/miniprogram/config.ts'), 'old client')
  assert.throws(() => configureProject(root, true), /Configuration drift/)
  assert.equal(fs.readFileSync(path.join(root, 'apps/miniprogram/config.ts'), 'utf8'), 'old client')
  configureProject(root)
  assert.doesNotThrow(() => configureProject(root, true))
  const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
  const cloud = JSON.parse(fs.readFileSync(path.join(root, 'cloudbaserc.json'), 'utf8'))
  assert.equal(project.appid, config.appId)
  assert.deepEqual(project.setting.useCompilerPlugins, ['typescript'])
  assert.equal(cloud.envId, config.cloudEnvironment)
  assert.deepEqual(cloud.functions, [{ name: 'users', runtime: 'Nodejs16.13' }])
  fs.writeFileSync(path.join(root, 'config/project.json'), JSON.stringify({ ...config, cloudEnvironment: 'cloud1-next', appId: 'wx1111111111111111' }))
  configureProject(root)
  const client = fs.readFileSync(path.join(root, 'apps/miniprogram/config.ts'), 'utf8')
  assert.match(client, /cloud1-next/)
  assert.match(client, /wx1111111111111111/)
  assert.doesNotMatch(client, /cloud1-demo|wxba2bcb0c71a5f33d/)
})
