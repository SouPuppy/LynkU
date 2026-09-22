import { listAudit } from '../lib/admin-client'
import { useAdminQuery } from '../hooks/use-admin-query'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Skeleton } from '../components/ui/skeleton'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../components/ui/table'
export function AuditPanel() {
  const { data, error, refresh } = useAdminQuery(listAudit)
  return <section aria-label="操作记录"><div className="mb-4 flex items-center justify-between"><p className="text-xs text-muted-foreground">最近50条操作记录</p><Button variant="outline" size="sm" onClick={refresh}>刷新</Button></div><Card className="overflow-hidden py-0 shadow-none">
    {error ? <p role="alert" className="p-6 text-sm text-destructive">操作记录暂时无法读取。</p> : !data ? <Skeleton className="m-5 h-32" /> : !data.length ? <p className="p-8 text-sm text-muted-foreground">暂无操作记录。</p> : <Table><TableHeader><TableRow><TableHead className="pl-5">时间</TableHead><TableHead>操作</TableHead><TableHead>对象编号</TableHead></TableRow></TableHeader><TableBody>{data.map(event => <TableRow key={event.id} className="h-14"><TableCell className="pl-5 text-xs">{new Date(event.at).toLocaleString('zh-CN')}</TableCell><TableCell>{event.action}</TableCell><TableCell className="max-w-80 whitespace-normal break-all text-xs text-muted-foreground">{event.target}</TableCell></TableRow>)}</TableBody></Table>}
  </Card></section>
}
