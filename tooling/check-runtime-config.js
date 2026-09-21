const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const cloudbase = JSON.parse(fs.readFileSync(path.join(root, 'cloudbaserc.json'), 'utf8'))
const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
const clientConfig = fs.readFileSync(path.join(root, 'apps', 'miniprogram', 'config.ts'), 'utf8')

function literal(name) {
  const match = clientConfig.match(new RegExp(`\\b${name}:\\s*['\"]([^'\"]+)['\"]`))
  if (!match) throw new Error(`apps/miniprogram/config.ts is missing a literal ${name} value`)
  return match[1]
}

const clientEnvId = literal('CLOUDBASE_ENV')
const clientAppId = literal('APPID')
const errors = []
if (project.miniprogramRoot !== 'apps/miniprogram/' || project.srcMiniprogramRoot !== 'apps/miniprogram/') {
  errors.push('WeChat must compile the apps/miniprogram source directory')
}
if (cloudbase.functionRoot !== 'dist/cloudfunctions' || project.cloudfunctionRoot !== 'dist/cloudfunctions/') {
  errors.push('CloudBase CLI and WeChat must upload built dist/cloudfunctions artifacts')
}

if (!cloudbase.envId || typeof cloudbase.envId !== 'string') errors.push('cloudbaserc.json must define envId')
if (!project.appid || typeof project.appid !== 'string') errors.push('project.config.json must define appid')
if (cloudbase.envId !== clientEnvId) {
  errors.push('CloudBase environment differs between cloudbaserc.json and apps/miniprogram/config.ts')
}
if (project.appid !== clientAppId) {
  errors.push('Mini Program AppID differs between project.config.json and apps/miniprogram/config.ts')
}

if (errors.length > 0) {
  process.stderr.write(`${errors.join('\n')}\n`)
  process.exit(1)
}

process.stdout.write('Runtime configuration identifiers are consistent.\n')
