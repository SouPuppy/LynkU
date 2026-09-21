import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { configureProject } from './configure-project.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function runWechat(args, timeout = 180000) {
  const executable = process.env.WECHAT_DEVTOOLS_CLI || (process.platform === 'win32'
    ? 'C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat'
    : '/Applications/wechatwebdevtools.app/Contents/MacOS/cli')
  if (!fs.existsSync(executable)) throw new Error('WeChat CLI not found. Set WECHAT_DEVTOOLS_CLI to the installed cli/cli.bat path.')
  const port = process.env.WECHAT_DEVTOOLS_PORT
  if (port && !/^\d{1,5}$/.test(port)) throw new Error('Invalid WECHAT_DEVTOOLS_PORT')
  const fullArgs = port ? [...args, '--port', port] : args
  return runInstalledCommand(executable, fullArgs, timeout)
}

export function runInstalledCommand(executable, fullArgs, timeout = 180000) {
  // PowerShell single-quoted literals safely preserve spaces and do not expand $ or backticks.
  const quote = value => `'${String(value).replaceAll("'", "''")}'`
  const result = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `& ${quote(executable)} ${fullArgs.map(quote).join(' ')}; exit $LASTEXITCODE`], { cwd: root, encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
    : spawnSync(executable, fullArgs, { cwd: root, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 })
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  if (result.error || result.status !== 0 || /\[error\]|fail to deploy|│.*\bfalse\b/.test(output)) {
    throw new Error(`WeChat command failed${result.error ? `: ${result.error.message}` : ''}\n${output}`)
  }
  return output
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = configureProject(root, true)
  const command = process.argv[2]
  if (command === 'open') console.log(runWechat(['open', '--project', root]))
  else if (command === 'deploy') {
    const environmentList = runWechat(['cloud', 'env', 'list', '--project', root])
    if (!environmentList.includes(config.cloudEnvironment)) throw new Error('Configured environment is not accessible to this AppID; deployment stopped.')
    const cloud = JSON.parse(fs.readFileSync(path.join(root, 'cloudbaserc.json'), 'utf8'))
    const names = cloud.functions.map(item => item.name)
    console.log(runWechat(['cloud', 'functions', 'deploy', '--project', root, '--env', config.cloudEnvironment, '--names', ...names, '--remote-npm-install'], 600000))
    console.warn('Code deployment is complete. Independently verify database permissions and live function settings; the WeChat CLI does not reliably apply manifest timeout settings.')
  } else if (command === 'preview') {
    fs.mkdirSync(path.join(root, 'dist/demo'), { recursive: true })
    console.log(runWechat(['preview', '--project', root, '--qr-format', 'image', '--qr-output', path.join(root, 'dist/demo/preview.png'), '--info-output', path.join(root, 'dist/demo/preview-info.json')], 300000))
  } else throw new Error('Usage: node tooling/wechat-cli.mjs open|deploy|preview')
}
