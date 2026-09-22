import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { isBuiltin } from 'node:module'
import { createHash } from 'node:crypto'
import { releaseInputs } from './release-inputs.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const artifactRoot = path.join(root, 'dist/cloudfunctions')
const manifest = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'manifest.json'), 'utf8'))
assert.equal(manifest.release.sourceDigest, releaseInputs(root).sourceDigest, 'Source changed since the release bundle was built')
const readJson = filename => JSON.parse(fs.readFileSync(filename, 'utf8'))
const configured = readJson(path.join(root, 'cloudbaserc.json')).functions
assert.deepEqual(manifest.functions, configured.map(entry => entry.name), 'Artifact manifest differs from deployment manifest')
assert.deepEqual(manifest.artifacts.map(entry => entry.name), manifest.functions, 'Missing or duplicated artifact metadata')
const installedSdk = readJson(path.join(root, 'node_modules/wx-server-sdk/package.json')).version
const installedNodeSdk = readJson(path.join(root, 'node_modules/@cloudbase/node-sdk/package.json')).version
const runtimePackage = readJson(path.join(root, 'config/cloud-runtime/package.json'))
const runtimeLock = readJson(path.join(root, 'config/cloud-runtime/package-lock.json'))
assert.equal(runtimeLock.lockfileVersion, 3, 'Runtime lock format must be reproducible')
assert.deepEqual(runtimeLock.packages[''].dependencies, runtimePackage.dependencies, 'Runtime lock differs from its package')
assert.equal(runtimeLock.packages['node_modules/wx-server-sdk'].version, installedSdk, 'Runtime lock SDK differs from the locally checked SDK')
assert.equal(runtimeLock.packages['node_modules/@cloudbase/node-sdk'].version, installedNodeSdk, 'Runtime lock CloudBase Node SDK differs from the locally checked SDK')

function validateArtifact(name, artifact) {
  assert.match(name, /^[a-z][a-z0-9-]*$/, 'Unsafe artifact name')
  assert.deepEqual(fs.readdirSync(artifact).sort(), ['config.json', 'index.js', 'package-lock.json', 'package.json'], `${name}: unexpected bundle contents`)
  const source = path.join(root, 'apps/cloudfunctions', name)
  const sourcePackage = readJson(path.join(source, 'package.json'))
  const builtPackage = readJson(path.join(artifact, 'package.json'))
  assert.deepEqual(builtPackage, {
    name: sourcePackage.name, version: sourcePackage.version, private: true, main: 'index.js',
    dependencies: sourcePackage.dependencies,
    overrides: runtimePackage.overrides,
  }, `${name}: artifact package does not match source runtime dependencies`)
  assert.deepEqual(Object.keys(builtPackage.dependencies).sort(), ['@cloudbase/node-sdk', 'wx-server-sdk'], `${name}: artifact dependency set differs`)
  assert.equal(builtPackage.dependencies['wx-server-sdk'], installedSdk, `${name}: artifact SDK differs from the locally checked SDK`)
  assert.equal(builtPackage.dependencies['@cloudbase/node-sdk'], installedNodeSdk, `${name}: artifact CloudBase Node SDK differs from the locally checked SDK`)
  assert.deepEqual(sourcePackage.dependencies, runtimePackage.dependencies, `${name}: source SDK differs from the shared runtime lock`)
  const expectedLock = structuredClone(runtimeLock)
  expectedLock.name = builtPackage.name
  expectedLock.version = builtPackage.version
  expectedLock.packages[''].name = builtPackage.name
  expectedLock.packages[''].version = builtPackage.version
  assert.deepEqual(readJson(path.join(artifact, 'package-lock.json')), expectedLock,
    `${name}: runtime lock must preserve every resolved transitive version and integrity`)
  assert.deepEqual(readJson(path.join(artifact, 'config.json')), readJson(path.join(source, 'config.json')), `${name}: function configuration differs from source`)

  const metadata = manifest.artifacts.find(entry => entry.name === name)
  const deployment = configured.find(entry => entry.name === name)
  assert.equal(deployment.handler, 'index.main', `${name}: handler must match the bundle entry`)
  assert.match(deployment.runtime, /^Nodejs\d+(?:\.\d+){0,2}$/, `${name}: unsupported cloud runtime`)
  assert.equal(metadata.runtime, deployment.runtime, `${name}: stale runtime metadata`)
  assert.equal(metadata.target, deployment.runtime.replace(/^Nodejs/, 'node'), `${name}: build target differs from deployment runtime`)
  const code = fs.readFileSync(path.join(artifact, 'index.js'))
  assert.equal(code.length, metadata.bytes, `${name}: stale bundle size`)
  assert.equal(createHash('sha256').update(code).digest('hex'), metadata.sha256, `${name}: bundle digest does not match manifest`)
  assert.ok(metadata.external.includes('wx-server-sdk'), `${name}: wx-server-sdk external declaration is missing`)
  for (const dependency of metadata.external) {
    assert.ok(isBuiltin(dependency) || Object.hasOwn(runtimePackage.dependencies, dependency), `${name}: undeclared external dependency ${dependency}`)
  }
}

// Run outside the repository and prohibit resolving dependencies from its node_modules.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lynku-cloud-artifacts-'))
try {
  for (const name of manifest.functions) {
    const artifact = path.join(artifactRoot, name)
    validateArtifact(name, artifact)
    const isolated = path.join(directory, name)
    fs.cpSync(artifact, isolated, { recursive: true })
    for (const file of ['index.js', 'config.json', 'package.json', 'package-lock.json']) {
      if (!fs.existsSync(path.join(isolated, file))) throw new Error(`${name}: missing ${file}`)
    }
    const result = spawnSync(process.execPath, [path.join(root, 'tooling/verify-cloud-bundle.cjs'), path.join(isolated, 'index.js'), name], {
      cwd: isolated, encoding: 'utf8', timeout: 10000, env: { ...process.env, NODE_PATH: '' },
    })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`${name}: isolated execution failed\n${result.stdout}${result.stderr}`)
  }
} finally {
  if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('lynku-cloud-artifacts-')) throw new Error('Unexpected temporary directory')
  fs.rmSync(directory, { recursive: true, force: true })
}
process.stdout.write(`Validated ${manifest.functions.length} independent bundles, deployment metadata, and the messages directory flow with an SDK fixture.\n`)
