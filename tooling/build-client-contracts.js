const fs = require('node:fs')
const path = require('node:path')

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
process.stdout.write('Materialized shared TypeScript contracts for WeChat.\n')
