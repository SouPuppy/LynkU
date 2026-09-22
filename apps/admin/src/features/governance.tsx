import { listCases } from '../lib/admin-client'
import { useEffect, useState, type FormEvent } from 'react'
import { parseAdminCaseQuery, type AdminCaseQuery, type AdminCasePage } from '@lynku/contracts'
import { CaseDetail } from './case-detail'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Skeleton } from '../components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../components/ui/table'
const initialQuery: AdminCaseQuery = { status: 'open', targetType: 'all', targetId: '', limit: 25, cursor: null }
function readRoute() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '')
  try { return { query: parseAdminCaseQuery({ status: params.get('status') ?? 'open', targetType: params.get('type') ?? 'all', targetId: params.get('target') ?? '',
    cursor: params.has('cursor') ? JSON.parse(params.get('cursor')!) as unknown : null }), selected: params.get('case'), error: false } }
  catch { return { query: initialQuery, selected: null, error: true } }
}
function link(query: AdminCaseQuery, selected: string | null = null) {
  const params = new URLSearchParams({ status: query.status, type: query.targetType })
  if (query.targetId) params.set('target', query.targetId)
  if (query.cursor) params.set('cursor', JSON.stringify(query.cursor))
  if (selected) params.set('case', selected)
  return `governance?${params}`
}
export function GovernancePanel() {
  const [route, setRoute] = useState(readRoute), [attempt, refresh] = useState(0)
  const [filters, setFilters] = useState(route.query)
  const [page, setPage] = useState<AdminCasePage | null>(null), [error, setError] = useState(false)
  const queryKey = JSON.stringify(route.query)
  useEffect(() => {
    const update = () => { const next = readRoute(); setRoute(next); setFilters(next.query) }
    addEventListener('hashchange', update)
    return () => removeEventListener('hashchange', update)
  }, [])
  useEffect(() => {
    let active = true
    setPage(null); setError(false)
    if (!route.error) void listCases(parseAdminCaseQuery(JSON.parse(queryKey) as unknown)).then(value => { if (active) setPage(value) }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [queryKey, route.error, attempt])
  function search(event: FormEvent) { event.preventDefault(); location.hash = link({ ...filters, targetId: filters.targetId.trim(), cursor: null }) }
  return <section aria-label="社区治理">
    <form className="mb-4 flex flex-wrap items-center gap-2" onSubmit={search}>
      <Tabs value={filters.status} onValueChange={status => { if (status === 'all' || status === 'open' || status === 'closed') setFilters(value => ({ ...value, status })) }}><TabsList aria-label="案件状态">
        <TabsTrigger value="open">待处理</TabsTrigger><TabsTrigger value="closed">已结案</TabsTrigger><TabsTrigger value="all">全部</TabsTrigger>
      </TabsList></Tabs>
      <Tabs value={filters.targetType} onValueChange={targetType => { if (targetType === 'all' || targetType === 'post' || targetType === 'comment') setFilters(value => ({ ...value, targetType })) }}><TabsList aria-label="举报对象类型">
        <TabsTrigger value="all">全部对象</TabsTrigger><TabsTrigger value="post">帖子</TabsTrigger><TabsTrigger value="comment">评论</TabsTrigger>
      </TabsList></Tabs>
      <Input className="w-52" aria-label="目标编号" placeholder="目标编号（精确匹配）" maxLength={128} value={filters.targetId} onChange={event => setFilters(value => ({ ...value, targetId: event.target.value }))} />
      <Button type="submit" variant="secondary">筛选</Button><Button type="button" variant="outline" onClick={() => refresh(value => value + 1)}>刷新</Button>
      <Button type="button" variant="ghost" onClick={() => { location.hash = link(initialQuery) }}>重置</Button>
    </form><Card className="overflow-hidden py-0 shadow-none">
      {route.error ? <p role="alert" className="p-6 text-destructive">筛选或分页链接无效，请重置列表。</p>
        : error ? <p role="alert" className="p-6 text-sm text-destructive">案件暂时无法读取，请检查权限或重试。</p>
          : !page ? <Skeleton className="m-5 h-32" /> : !page.items.length ? <p className="p-8 text-sm text-muted-foreground">没有符合条件的案件。</p>
            : <Table><TableHeader><TableRow><TableHead className="pl-5">举报对象</TableHead><TableHead>原因</TableHead><TableHead>状态</TableHead><TableHead>最近更新</TableHead></TableRow></TableHeader><TableBody>{page.items.map(item =>
              <TableRow key={item.id} className="h-16"><TableCell className="pl-5">{item.targetType === 'post' ? <a href={`#content?post=${encodeURIComponent(item.targetId)}`} className="text-primary hover:underline">查看被举报帖子</a> : '评论'}<p className="mt-1 max-w-64 break-all text-xs text-muted-foreground">{item.targetId}</p></TableCell>
                <TableCell><a className="text-primary hover:underline" href={`#${link(route.query, item.id)}`}>{item.reason}</a></TableCell>
                <TableCell><Badge variant="outline">{item.status === 'open' ? '待处理' : '已结案'}</Badge>{item.appealed && <Badge variant="secondary" className="ml-1">申诉复核</Badge>}</TableCell>
                <TableCell className="text-xs"><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString('zh-CN')}</time></TableCell></TableRow>)}</TableBody></Table>}
    </Card><div className="mt-4 flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">每页最多25条 · 新举报或申诉可能改变顺序，可回到首页刷新</p><div className="flex gap-2">
      <Button variant="outline" size="sm" disabled={!route.query.cursor} onClick={() => { location.hash = link({ ...route.query, cursor: null }) }}>回到首页</Button>
      <Button variant="outline" size="sm" disabled={!page?.nextCursor} onClick={() => { if (page?.nextCursor) location.hash = link({ ...route.query, cursor: page.nextCursor }) }}>下一页</Button>
    </div></div>{route.selected && <CaseDetail key={route.selected} id={route.selected} onClose={() => { location.hash = link(route.query) }} onSaved={() => refresh(value => value + 1)} />}</section>
}
