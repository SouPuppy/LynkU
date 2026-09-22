import { loadOperations } from '../lib/admin-client'
import { OperationTasks } from './operation-tasks'
import { useAdminQuery } from '../hooks/use-admin-query'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Skeleton } from '../components/ui/skeleton'
export function OperationsPanel() {
  const { data, error, refresh } = useAdminQuery(loadOperations)
  return <section aria-label="消息与运行"><div className="mb-4 flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">当前待投递记录 · 主动刷新</p><Button variant="outline" size="sm" onClick={refresh}>刷新</Button></div>
    {error ? <p role="alert" className="text-sm text-destructive">运行数据暂时无法读取，请重试。</p> : <div className="grid gap-4 sm:grid-cols-2">{([{ key: 'pendingNotifications', label: '待投递通知' }, { key: 'pendingProfiles', label: '待更新资料投影' }] as const).map(item => <Card key={item.key} className="shadow-none"><CardHeader><CardTitle className="text-sm">{item.label}</CardTitle></CardHeader><CardContent>{data ? <p className="text-3xl font-semibold tabular-nums">{data[item.key].toLocaleString()}</p> : <Skeleton className="h-9 w-20" />}</CardContent></Card>)}</div>}
    <p className="mt-4 text-xs text-muted-foreground">以上仅统计 pending 状态，不代表发送成功率或全部异常数量。</p>
    <OperationTasks />
    <p className="mt-6 text-xs leading-6 text-muted-foreground">学校邮件、内容安全检查及数据清理的运行统计尚未接入，此处不报告它们的成功率或健康状态。</p>
  </section>
}
