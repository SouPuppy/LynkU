import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'apps', 'admin', 'dist')
const project = JSON.parse(await readFile(path.join(root, 'config', 'project.json'), 'utf8'))
if (!existsSync(path.join(output, 'index.html'))) throw Error('Admin production build is missing; run npm run build:admin first')
if (typeof project.cloudEnvironment !== 'string' || !project.cloudEnvironment) throw Error('Missing CloudBase environment')

const cli = path.join(root, 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb')
if (!existsSync(cli)) throw Error('Locked CloudBase CLI is missing; run npm ci before deployment')
const result = spawnSync(process.execPath, [cli, 'hosting', 'deploy', output, '/admin', '-e', project.cloudEnvironment, '--safe', '--entry', 'index.html'], {
  cwd: root,
  encoding: 'utf8',
  stdio: 'inherit',
})
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

const expected = ['admin/index.html', ...(await readdir(path.join(output, 'assets'))).map(file => `admin/assets/${file}`)]
const listed = spawnSync(process.execPath, [cli, 'hosting', 'list', '/admin', '-e', project.cloudEnvironment, '--json'], { cwd: root, encoding: 'utf8' })
if (listed.error) throw listed.error
if (listed.status !== 0) process.exit(listed.status ?? 1)
let remote
try { remote = JSON.parse(listed.stdout) } catch (_) { throw Error('CloudBase returned an unreadable static-hosting listing') }
if (!remote || typeof remote !== 'object' || !Array.isArray(remote.data)) throw Error('CloudBase returned an invalid static-hosting listing')
const keys = new Set(remote.data.map(item => item && typeof item === 'object' ? item.key : undefined).filter(key => typeof key === 'string'))
const missing = expected.filter(key => !keys.has(key))
if (missing.length) throw Error(`Static-hosting verification failed: missing ${missing.join(', ')}`)

// When hosting exposes a single-part ETag, verify the uploaded object bytes too.
const objects = new Map(remote.data.map(item => [item.key, item]))
for (const key of expected) {
  const item = objects.get(key)
  const local = await readFile(path.join(output, key.slice('admin/'.length)))
  const etag = typeof item?.etag === 'string' ? item.etag.replaceAll('"', '') : null
  if (etag && /^[a-f0-9]{32}$/i.test(etag)) {
    if (createHash('md5').update(local).digest('hex') !== etag.toLowerCase()) throw Error(`Static-hosting content mismatch: ${key}`)
  }
}
