import { useEffect, useState, type FormEvent } from 'react'
import { parseAdminAuditQuery, type AdminAuditEvent, type AdminAuditPage, type AdminAuditQuery } from '@lynku/contracts'
import { listAudit, readAudit } from '../lib/admin-client'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Skeleton } from '../components/ui/skeleton'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../components/ui/sheet'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../components/ui/table'

const emptyQuery: AdminAuditQuery = { operation: '', target: '', actor: '', limit: 25, cursor: null }
function readRoute() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '')
  try {
    return { query: parseAdminAuditQuery({ operation: params.get('operation') || '', target: params.get('target') || '', actor: params.get('actor') || '',
      cursor: params.has('cursor') ? JSON.parse(params.get('cursor')!) as unknown : null }), id: params.get('event'), error: false }
  } catch { return { query: emptyQuery, id: null, error: true } }
}
function navigate(query: AdminAuditQuery, id: string | null = null) {
  const params = new URLSearchParams()
  for (const key of ['operation', 'actor', 'target'] as const) if (query[key]) params.set(key, query[key])
  if (query.cursor) params.set('cursor', JSON.stringify(query.cursor))
  if (id) params.set('event', id)
  location.hash = `audit${params.size ? `?${params}` : ''}`
}
function AuditDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<AdminAuditEvent | null>(null)
  const [error, setError] = useState(false), [attempt, retry] = useState(0)
  useEffect(() => {
    let active = true
    setDetail(null); setError(false)
    void readAudit(id).then(value => { if (active) setDetail(value) }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [id, attempt])
  return <Sheet open onOpenChange={open => { if (!open) onClose() }}><SheetContent className="overflow-y-auto sm:max-w-xl">
    <SheetHeader><SheetTitle>操作详情</SheetTitle><SheetDescription>只读审计记录。缺少的字段表示该事件没有记录此信息。</SheetDescription></SheetHeader>
    <div className="p-6">{error ? <div role="alert"><p>记录不存在或暂时无法读取。</p><Button variant="outline" onClick={() => retry(value => value + 1)}>重试</Button></div>
      : !detail ? <Skeleton className="h-64" /> : <dl className="space-y-5 text-sm">{[
        ['记录编号', detail.id], ['时间', new Date(detail.at).toLocaleString('zh-CN')], ['操作者编号', detail.actor],
        ['动作', detail.action], ['目标编号', detail.target], ['理由', detail.reason], ['结果', detail.result],
        ['生效版本', detail.revision?.toString() ?? null], ['请求编号', detail.requestId],
      ].map(([label, value]) => <div key={label}><dt className="mb-1 text-xs text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap break-all">{value ?? '未记录'}</dd></div>)}</dl>}</div>
  </SheetContent></Sheet>
}
export function AuditPanel() {
  const [route, setRoute] = useState(readRoute)
  const [filters, setFilters] = useState(route.query)
  const [page, setPage] = useState<AdminAuditPage | null>(null)
  const [error, setError] = useState(false), [attempt, refresh] = useState(0)
  const queryKey = JSON.stringify(route.query)
  useEffect(() => {
    const update = () => { const next = readRoute(); setRoute(next); setFilters(next.query) }
    addEventListener('hashchange', update)
    return () => removeEventListener('hashchange', update)
  }, [])
  useEffect(() => {
    let active = true
    setPage(null); setError(false)
    if (!route.error) void listAudit(parseAdminAuditQuery(JSON.parse(queryKey) as unknown))
      .then(value => { if (active) setPage(value) }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [queryKey, route.error, attempt])
  function search(event: FormEvent) {
    event.preventDefault()
    navigate({ ...filters, operation: filters.operation.trim(), actor: filters.actor.trim(), target: filters.target.trim(), cursor: null })
  }
  return <section aria-label="操作记录"><form onSubmit={search} className="mb-4 flex flex-wrap gap-2">
    {([['operation', '动作（精确匹配）'], ['actor', '操作者编号'], ['target', '目标编号']] as const).map(([key, label]) =>
      <Input key={key} aria-label={label} placeholder={label} maxLength={128} className="w-56" value={filters[key]} onChange={event => setFilters(value => ({ ...value, [key]: event.target.value }))} />)}
    <Button type="submit" variant="secondary">筛选</Button><Button type="button" variant="outline" onClick={() => refresh(value => value + 1)}>刷新</Button>
    <Button type="button" variant="ghost" onClick={() => navigate(emptyQuery)}>清除筛选</Button>
  </form><Card className="overflow-hidden py-0 shadow-none">
    {route.error ? <p role="alert" className="p-6 text-destructive">链接中的筛选或分页信息无效，请清除筛选后重试。</p>
      : error ? <p role="alert" className="p-6 text-sm text-destructive">操作记录暂时无法读取，请重试。</p>
        : !page ? <Skeleton className="m-5 h-32" /> : !page.items.length ? <p className="p-8 text-sm text-muted-foreground">没有符合条件的操作记录。</p>
          : <Table><TableHeader><TableRow><TableHead className="pl-5">时间</TableHead><TableHead>动作</TableHead><TableHead>操作者</TableHead><TableHead>目标</TableHead><TableHead>结果</TableHead></TableRow></TableHeader>
            <TableBody>{page.items.map(event => <TableRow key={event.id} className="h-14">
              <TableCell className="pl-5 text-xs whitespace-nowrap">{new Date(event.at).toLocaleString('zh-CN')}</TableCell>
              <TableCell><Button variant="link" className="p-0" onClick={() => navigate(route.query, event.id)}>{event.action}</Button></TableCell>
              <TableCell className="max-w-48 break-all whitespace-normal text-xs">{event.actor ?? '未记录'}</TableCell>
              <TableCell className="max-w-64 break-all whitespace-normal text-xs text-muted-foreground">{event.target}</TableCell><TableCell>{event.result ?? '未记录'}</TableCell>
            </TableRow>)}</TableBody></Table>}
  </Card><div className="mt-4 flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">按时间倒序 · 每页最多25条 · 仅记录实际已提交的事件</p><div className="flex gap-2">
    <Button variant="outline" size="sm" disabled={!route.query.cursor} onClick={() => navigate({ ...route.query, cursor: null })}>回到首页</Button>
    <Button variant="outline" size="sm" disabled={!page?.nextCursor} onClick={() => { if (page?.nextCursor) navigate({ ...route.query, cursor: page.nextCursor }) }}>下一页</Button>
  </div></div>{route.id && <AuditDetail key={route.id} id={route.id} onClose={() => navigate(route.query)} />}</section>
}
