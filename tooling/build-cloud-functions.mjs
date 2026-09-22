import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isBuiltin } from 'node:module'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { releaseInputs } from './release-inputs.mjs'
import { generateLegalBundle } from './build-legal-policies.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
generateLegalBundle(root)
const sourceRoot = path.join(root, 'apps/cloudfunctions')
const outputRoot = path.join(root, 'dist/cloudfunctions')
const config = JSON.parse(fs.readFileSync(path.join(root, 'cloudbaserc.json'), 'utf8'))
const names = config.functions.map(entry => entry.name)
if (!names.length || new Set(names).size !== names.length || names.some(name => !/^[a-z][a-z0-9-]*$/.test(name))) {
  throw new Error('Cloud function manifest must contain unique, safe function names')
}
const runtimePackage = JSON.parse(fs.readFileSync(path.join(root, 'config/cloud-runtime/package.json'), 'utf8'))
const runtimeLock = JSON.parse(fs.readFileSync(path.join(root, 'config/cloud-runtime/package-lock.json'), 'utf8'))
assert.deepEqual(Object.keys(runtimePackage.dependencies).sort(), ['@cloudbase/node-sdk', 'wx-server-sdk'], 'Cloud function runtime dependencies must be the exact CloudBase SDK pair')
for (const [name, version] of Object.entries(runtimePackage.dependencies)) assert.match(version, /^\d+\.\d+\.\d+$/, `${name} version must be exact`)
assert.equal(runtimeLock.lockfileVersion, 3, 'Runtime dependency lock must use lockfileVersion 3')
assert.equal(runtimeLock.name, runtimePackage.name, 'Runtime lock package name differs')
assert.equal(runtimeLock.version, runtimePackage.version, 'Runtime lock package version differs')
assert.equal(runtimeLock.packages[''].name, runtimePackage.name, 'Runtime root package name differs')
assert.equal(runtimeLock.packages[''].version, runtimePackage.version, 'Runtime root package version differs')
assert.deepEqual(runtimeLock.packages[''].dependencies, runtimePackage.dependencies, 'Runtime lock dependencies differ')
assert.equal(runtimeLock.packages['node_modules/wx-server-sdk'].version, runtimePackage.dependencies['wx-server-sdk'], 'Locked SDK version differs')
assert.equal(runtimeLock.packages['node_modules/@cloudbase/node-sdk'].version, runtimePackage.dependencies['@cloudbase/node-sdk'], 'Locked CloudBase Node SDK version differs')
function hasLockedDependency(location, dependency) {
  let directory = location
  while (true) {
    if (runtimeLock.packages[path.posix.join(directory, 'node_modules', dependency)]) return true
    if (!directory) return false
    directory = path.posix.dirname(directory)
    if (directory === '.') directory = ''
  }
}
for (const [location, entry] of Object.entries(runtimeLock.packages)) {
  if (location) {
    assert.ok(location.startsWith('node_modules/') && !entry.link && !entry.dev, `Runtime lock contains a workspace or development dependency: ${location}`)
    assert.ok(typeof entry.version === 'string' && entry.version.length > 0, `Missing locked version: ${location}`)
    assert.match(entry.resolved, /^https:\/\//, `Runtime package must resolve independently: ${location}`)
    assert.match(entry.integrity, /^sha(?:1|256|384|512)-\S+$/, `Missing package integrity: ${location}`)
  }
  for (const dependency of Object.keys(entry.dependencies || {})) {
    assert.ok(hasLockedDependency(location, dependency), `Runtime lock is incomplete: ${location || '(root)'} -> ${dependency}`)
  }
}

fs.mkdirSync(path.join(root, 'dist'), { recursive: true })
const staging = fs.mkdtempSync(path.join(root, 'dist/cloud-build-'))
function removeOutput(directory) {
  if (!path.resolve(directory).startsWith(`${path.join(root, 'dist')}${path.sep}`)) {
    throw new Error('Refusing to remove a directory outside dist')
  }
  fs.rmSync(directory, { recursive: true, force: true })
}

try {
  const artifacts = []
  for (const functionConfig of config.functions) {
    const { name, runtime, handler } = functionConfig
    const runtimeMatch = /^Nodejs(\d+(?:\.\d+){0,2})$/.exec(runtime || '')
    if (!runtimeMatch) throw new Error(`${name}: unsupported cloud runtime ${runtime}`)
    if (handler !== 'index.main') throw new Error(`${name}: bundled functions require handler index.main`)
    const target = `node${runtimeMatch[1]}`
    const source = path.join(sourceRoot, name)
    const output = path.join(staging, name)
    const packageJson = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'))
    const sourceConfig = JSON.parse(fs.readFileSync(path.join(source, 'config.json'), 'utf8'))
    assert.equal(sourceConfig.timeout ?? 3, functionConfig.timeout, `${name}: source timeout differs from deployment manifest`)
    assert.deepEqual(sourceConfig.triggers || [], functionConfig.triggers || [], `${name}: source triggers differ from deployment manifest`)
    assert.deepEqual(packageJson.dependencies, runtimePackage.dependencies, `${name}: source dependencies differ from the shared runtime lock`)
    const result = await build({
      absWorkingDir: root,
      entryPoints: [path.join(source, 'index.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: [target],
      external: Object.keys(runtimePackage.dependencies),
      alias: {
        '@lynku/contracts': path.join(root, 'packages/contracts/src/index.ts'),
        '@lynku/server': path.join(root, 'packages/server/src/index.ts'),
        '@lynku/adapters': path.join(root, 'packages/adapters/src/index.ts'),
      },
      outfile: 'index.js',
      write: false,
      metafile: true,
      legalComments: 'none',
    })
    const code = result.outputFiles[0]
    if (!code) throw new Error(`Missing build output: ${name}`)
    const imports = Object.values(result.metafile.outputs).flatMap(entry => entry.imports)
    for (const imported of imports) {
      if (!imported.external) throw new Error(`${name}: unbundled local dependency ${imported.path}`)
      if (!isBuiltin(imported.path) && !Object.hasOwn(runtimePackage.dependencies, imported.path)) {
        throw new Error(`${name}: unexpected runtime dependency ${imported.path}`)
      }
    }
    fs.mkdirSync(output, { recursive: true })
    fs.writeFileSync(path.join(output, 'index.js'), code.contents)
    fs.copyFileSync(path.join(source, 'config.json'), path.join(output, 'config.json'))
    fs.writeFileSync(path.join(output, 'package.json'), `${JSON.stringify({
      name: packageJson.name, version: packageJson.version, private: true, main: 'index.js',
      dependencies: packageJson.dependencies,
      overrides: runtimePackage.overrides,
    }, null, 2)}\n`)
    const lock = structuredClone(runtimeLock)
    lock.name = packageJson.name
    lock.version = packageJson.version
    lock.packages[''].name = packageJson.name
    lock.packages[''].version = packageJson.version
    fs.writeFileSync(path.join(output, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`)
    artifacts.push({ name, runtime, target, bytes: code.contents.length,
      sha256: createHash('sha256').update(code.contents).digest('hex'),
      inputs: Object.keys(result.metafile.inputs).sort(),
      external: [...new Set(imports.map(entry => entry.path))].sort() })
  }
  fs.writeFileSync(path.join(staging, 'manifest.json'), `${JSON.stringify({ release: releaseInputs(root), functions: names, source: 'cloudbaserc.json', bundler: 'esbuild', artifacts }, null, 2)}\n`)
  removeOutput(outputRoot)
  fs.renameSync(staging, outputRoot)
  process.stdout.write(`Built ${names.length} independent cloud function bundles.\n`)
} finally {
  if (fs.existsSync(staging)) removeOutput(staging)
}
