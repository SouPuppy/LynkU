const fs = require('node:fs')
const path = require('node:path')
const { generateLegalBundle } = require('./build-legal-policies.mjs')

// WeChat compiles TypeScript inside miniprogramRoot. Materialize the canonical
// package there so device builds do not depend on workspace module resolution.
const root = path.resolve(__dirname, '..')
const source = path.join(root, 'packages', 'contracts', 'src')
const destination = path.join(root, 'apps', 'miniprogram', 'generated', 'contracts')
if (!path.resolve(destination).startsWith(`${path.join(root, 'apps', 'miniprogram', 'generated')}${path.sep}`)) {
  throw new Error('Refusing to clear an unexpected generated directory')
}
fs.rmSync(destination, { recursive: true, force: true })
fs.mkdirSync(destination, { recursive: true })
fs.cpSync(source, destination, { recursive: true })
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
fs.writeFileSync(path.join(root, 'apps/miniprogram/generated/version.ts'), `// Generated from the root package version.\nexport const APP_VERSION = ${JSON.stringify(version)}\n`)
process.stdout.write('Materialized shared TypeScript contracts for WeChat.\n')
generateLegalBundle(root)
const { buildAvatarAssets } = require('./build-avatar-assets.cjs')
process.stdout.write(`Built avatar runtime assets: ${buildAvatarAssets(root)} bytes.\n`)
