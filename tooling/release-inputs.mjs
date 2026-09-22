import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const hash = value => createHash('sha256').update(value).digest('hex')
export function releaseInputs(root) {
  const paths = []
  const walk = relative => {
    const absolute = path.join(root, relative)
    if (fs.statSync(absolute).isFile()) { paths.push(relative.replaceAll('\\', '/')); return }
    for (const item of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (item.isSymbolicLink() || ['node_modules', 'dist', 'generated'].includes(item.name)) continue
      walk(path.join(relative, item.name))
    }
  }
  for (const relative of ['apps', 'packages', 'config', 'tooling', 'package.json', 'package-lock.json', 'cloudbaserc.json', 'project.config.json', 'tsconfig.base.json']) walk(relative)
  const inputs = paths.sort().map(file => ({ file, sha256: hash(fs.readFileSync(path.join(root, file))) }))
  const git = args => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
    if (result.status !== 0) throw Error('Release inputs require a Git checkout')
    return result.stdout.trim()
  }
  return { version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
    commit: git(['rev-parse', 'HEAD']), dirty: !!git(['status', '--porcelain']), sourceDigest: hash(JSON.stringify(inputs)), inputs }
}
