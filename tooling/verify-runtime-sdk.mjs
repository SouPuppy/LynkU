import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const npm = process.env.npm_execpath
if (!npm || !fs.existsSync(npm)) throw Error('Run through npm run check:runtime-sdk so the installed npm version is explicit.')
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lynku-sdk-'))
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'dist/cloudfunctions/manifest.json'), 'utf8'))
try {
  for (const name of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(root, 'config/cloud-runtime', name), path.join(folder, name))
  const install = spawnSync(process.execPath, [npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: folder, encoding: 'utf8', timeout: 120000, windowsHide: true, env: { ...process.env, NODE_PATH: '' },
  })
  assert.equal(install.status, 0, 'Isolated production-lock installation failed')
  const results = []
  for (const name of manifest.functions) {
    const entry = path.join(folder, name + '.cjs')
    fs.copyFileSync(path.join(root, 'dist/cloudfunctions', name, 'index.js'), entry)
    const result = spawnSync(process.execPath, ['-e', `const sdk=require('wx-server-sdk'); const fn=require('./${name}.cjs'); if(typeof fn.main!=='function'||typeof sdk.openapi.security.msgSecCheck!=='function')process.exit(1)`], {
      cwd: folder, encoding: 'utf8', timeout: 10000, windowsHide: true, env: { ...process.env, NODE_PATH: '', TCB_ENV: 'artifact-validation' },
    })
    assert.equal(result.status, 0, `${name}: real SDK cannot load the standalone bundle`)
    results.push({ name, loaded: true, sha256: manifest.artifacts.find(item => item.name === name).sha256 })
  }
  fs.mkdirSync(path.join(root, 'dist/release'), { recursive: true })
  fs.writeFileSync(path.join(root, 'dist/release/runtime-sdk.json'), JSON.stringify({ at: new Date().toISOString(), node: process.version, checks: results }, null, 2) + '\n')
  console.log(`Installed the production lock outside the workspace; ${results.length} bundles load with the actual SDK. No cloud invocation was made.`)
} finally {
  if (path.dirname(folder) !== path.resolve(os.tmpdir()) || !path.basename(folder).startsWith('lynku-sdk-')) throw Error('Unexpected SDK test directory')
  fs.rmSync(folder, { recursive: true, force: true })
}
