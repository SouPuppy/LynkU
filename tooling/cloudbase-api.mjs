import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const project = JSON.parse(readFileSync(path.join(root, 'config/project.json'), 'utf8'))
/** Arguments are passed directly to the pinned CLI, never assembled into shell text. */
export function cloudApi(action, fields = {}) {
  const response = spawnSync(process.execPath, [path.join(root, 'node_modules/@cloudbase/cli/bin/tcb'), 'api', 'tcb', action,
    '--api-version', '2018-06-08', '--region', 'ap-shanghai', '--body', JSON.stringify({ ...fields, EnvId: project.cloudEnvironment }), '--json'], { cwd: root, encoding: 'utf8' })
  if (response.error || response.status !== 0) throw Error(`Cloud API ${action} failed: ${response.stderr || response.stdout}`)
  const start = response.stdout.indexOf('{')
  if (start < 0) throw Error(`Cloud API ${action} returned no JSON`)
  const parsed = JSON.parse(response.stdout.slice(start)), data = parsed.data ?? parsed.Response ?? parsed
  if (!data || typeof data !== 'object' || data.Error || parsed.error) throw Error(`Cloud API ${action} returned an error`)
  return data
}
