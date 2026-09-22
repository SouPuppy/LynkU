import { spawnSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { root, project } from './cloudbase-api.mjs'
import { parseAdminPostPage, parseAdminUserPage, parseManagedCategoryList, parseAdminMembers, parseAdminAuditPage } from '@lynku/contracts'
const checks = [
  ['session', value => { if (value.role !== 'owner' || !Array.isArray(value.capabilities)) throw Error('Unexpected operator session') }],
  ['overview', value => { for (const key of ['users', 'verifiedUsers', 'posts', 'openCases']) { const metric = value.metrics?.[key]; if (!metric || metric.state !== 'available' || !Number.isSafeInteger(metric.value)) throw Error(`Unavailable metric: ${key}`) } }],
  ['listPosts', parseAdminPostPage], ['listUsers', parseAdminUserPage], ['listCategories', parseManagedCategoryList],
  ['listCases', value => { if (!Array.isArray(value.cases)) throw Error('Invalid cases') }],
  ['listOperations', value => { if (!Number.isSafeInteger(value.pendingNotifications) || !Number.isSafeInteger(value.pendingProfiles)) throw Error('Invalid operation counts') }],
  ['listAudit', parseAdminAuditPage],
  ['listMembers', value => parseAdminMembers(value.members)],
]
const report = { environment: project.cloudEnvironment, at: new Date().toISOString(), privilegedCli: false, browserVerified: false, checks: [] }
mkdirSync(path.join(root, 'dist'), { recursive: true })
for (const [action, validate] of checks) {
  try {
    const call = spawnSync(process.execPath, [path.join(root, 'node_modules/@cloudbase/cli/bin/tcb'), 'fn', 'invoke', 'admin', '-e', project.cloudEnvironment, '-d', JSON.stringify({ action }), '--json'], { cwd: root, encoding: 'utf8' })
    if (call.error || call.status !== 0) throw Error('Cloud invocation failed')
    const invocation = JSON.parse(call.stdout).data
    if (invocation.InvokeResult !== 0) throw Error('Function execution failed')
    const response = JSON.parse(invocation.RetMsg)
    if (response.code || !response.data) throw Error(response.code || 'Missing payload')
    validate(response.data)
    if (action === 'session') report.privilegedCli = true
    report.checks.push({ action, passed: true, requestId: invocation.FunctionRequestId })
    console.log(`${action}: passed`)
  } catch (error) {
    report.checks.push({ action, passed: false, error: error.message })
    console.log(`${action}: ${error.message}`)
    if (action === 'session') break
  }
}
writeFileSync(path.join(root, 'dist/admin-read-smoke.json'), JSON.stringify(report, null, 2))
if (report.checks.some(check => !check.passed)) process.exitCode = 1
