import { useEffect, useRef, useState } from 'react'
import { parseOperationQuery, type OperationQuery, type OperationPage, type OperationKind, type OperationTask, type OperationRetry } from '@lynku/contracts'
import { listOperationTasks, readOperationTask, retryOperation, AdminRequestError } from '../lib/admin-client'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Skeleton } from '../components/ui/skeleton'
import { Input } from '../components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../components/ui/sheet'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../components/ui/table'
const initial: OperationQuery = { kind: 'notifications', status: 'pending', limit: 25, cursor: null }
const statusLabels = { pending: '待执行', processing: '处理中', delivered: '已完成' }
const displayTime = (value: number | string | null) => value === null ? '未记录' : new Date(value).toLocaleString('zh-CN')
function readRoute() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '')
  try { return { query: parseOperationQuery({ kind: params.get('kind') ?? 'notifications', status: params.get('status') ?? 'pending', cursor: params.has('cursor') ? JSON.parse(params.get('cursor')!) as unknown : null }), id: params.get('task'), error: false } }
  catch { return { query: initial, id: null, error: true } }
}
function navigate(query: OperationQuery, id: string | null = null) {
  const params = new URLSearchParams({ kind: query.kind, status: query.status })
  if (query.cursor) params.set('cursor', JSON.stringify(query.cursor))
  if (id) params.set('task', id)
  location.hash = `operations?${params}`
}
function TaskDetail({ kind, id, close, canRetry, onSaved }: { kind: OperationKind; id: string; close: () => void; canRetry: boolean; onSaved: () => void }) {
  const [task, setTask] = useState<OperationTask | null>(null), [error, setError] = useState(false), [attempt, refresh] = useState(0)
  const [reason, setReason] = useState(''), [pending, setPending] = useState(false), [retry, setRetry] = useState<OperationRetry | null>(null)
  const [message, setMessage] = useState(''), [failure, setFailure] = useState('')
  const alive = useRef(true), busy = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    let active = true
    setTask(null); setError(false)
    void readOperationTask(kind, id).then(value => { if (active) setTask(value) }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [kind, id, attempt])
  async function schedule() {
    if (!task || busy.current || task.status === 'delivered') return
    const request = retry ?? { kind, id, expectedAttempts: task.attempts, expectedRetryRevision: task.retryRevision, expectedStatus: task.status, reason: reason.trim(), requestId: crypto.randomUUID() }
    busy.current = true; setPending(true); setFailure(''); setMessage('')
    try {
      const receipt = await retryOperation(request)
      if (!alive.current) return
      setRetry(null); setReason(''); setMessage(`已安排重试（版本 ${receipt.retryRevision}），等待调度器执行；尚未确认投递成功。`)
      refresh(value => value + 1); onSaved()
    } catch (error) {
      if (!alive.current) return
      setFailure(error instanceof Error ? error.message : '操作失败')
      setRetry(error instanceof AdminRequestError && error.uncertain ? request : null)
    } finally { busy.current = false; if (alive.current) setPending(false) }
  }
  const locked = pending || retry !== null
  const eligible = task && (task.status === 'pending' && task.attempts > 0 && task.lastError === 'DELIVERY_FAILED' || task.status === 'processing' && task.leaseUntil !== null && task.leaseUntil <= Date.now())
  return <Sheet open onOpenChange={open => { if (!open && !locked) close() }}><SheetContent showCloseButton={!locked} className="overflow-y-auto sm:max-w-xl"><SheetHeader>
    <SheetTitle>运行任务</SheetTitle><SheetDescription>仅展示投递元数据。已完成表示任务处理完成，不代表用户已阅读。</SheetDescription>
  </SheetHeader><div className="space-y-5 p-6"><Button variant="outline" disabled={locked} onClick={() => refresh(value => value + 1)}>刷新状态</Button>
    {error ? <p role="alert" className="text-destructive">任务不存在或暂时无法读取。</p> : !task ? <Skeleton className="h-56" /> : <dl className="space-y-4 text-sm">{[
      ['任务编号', task.id], ['类型', task.kind === 'notifications' ? '业务通知' : '资料同步'], ['状态', statusLabels[task.status]], ['创建时间', displayTime(task.createdAt)],
      ['已尝试次数', String(task.attempts)], ['上次开始时间', displayTime(task.lastAttemptAt)], ['下次可尝试时间', displayTime(task.nextAttemptAt)],
      ['处理租约截止', displayTime(task.leaseUntil)], ['完成时间', displayTime(task.deliveredAt)], ['历史错误分类', task.lastError === null ? '未记录' : task.lastError === 'DELIVERY_FAILED' ? '投递失败' : '未分类错误'],
    ].map(([label, value]) => <div key={label}><dt className="mb-1 text-xs text-muted-foreground">{label}</dt><dd className="break-all">{value}</dd></div>)}</dl>}
    <p className="text-xs leading-6 text-muted-foreground">等待重试和过期租约由现有任务调度器处理。历史错误可能保留在已完成任务中。安排重试只调整原任务的可执行时间，不复制任务或更改正文。</p>
    {canRetry && task && <div className="space-y-3 rounded-lg border p-4"><p className="text-sm font-medium">受控重试</p><p className="text-xs text-muted-foreground">当前尝试次数 {task.attempts}，重试版本 {task.retryRevision}。提交时会重新检查版本、来源及处理租约。</p>
      <label className="grid gap-2 text-sm">原因<Input maxLength={500} disabled={locked || !eligible} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <Button disabled={pending || (!retry && (!eligible || !reason.trim()))} onClick={() => { void schedule() }}>{pending ? '提交中…' : retry ? '确认原请求结果' : '确认安排重试'}</Button>
      {!eligible && <p className="text-xs text-muted-foreground">仅失败待执行或租约已过期的任务可申请重试。</p>}
    </div>}
    {message && <p role="status" className="text-sm">{message}</p>}{failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
  </div></SheetContent></Sheet>
}
export function OperationTasks({ canRetry }: { canRetry: boolean }) {
  const [route, setRoute] = useState(readRoute), [attempt, refresh] = useState(0)
  const [page, setPage] = useState<OperationPage | null>(null), [error, setError] = useState(false)
  const queryKey = JSON.stringify(route.query)
  useEffect(() => { const update = () => setRoute(readRoute()); addEventListener('hashchange', update); return () => removeEventListener('hashchange', update) }, [])
  useEffect(() => {
    let active = true
    setPage(null); setError(false)
    if (!route.error) void listOperationTasks(parseOperationQuery(JSON.parse(queryKey) as unknown)).then(value => { if (active) setPage(value) }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [queryKey, route.error, attempt])
  return <div className="mt-6 space-y-4"><div className="flex flex-wrap items-center gap-2">
    <Tabs value={route.query.kind} onValueChange={kind => { if (kind === 'notifications' || kind === 'profiles') navigate({ ...route.query, kind, cursor: null }) }}><TabsList aria-label="任务类型"><TabsTrigger value="notifications">业务通知</TabsTrigger><TabsTrigger value="profiles">资料同步</TabsTrigger></TabsList></Tabs>
    <Tabs value={route.query.status} onValueChange={status => { if (status === 'all' || status === 'pending' || status === 'processing' || status === 'delivered') navigate({ ...route.query, status, cursor: null }) }}><TabsList aria-label="任务状态">{(['pending', 'processing', 'delivered', 'all'] as const).map(status => <TabsTrigger key={status} value={status}>{status === 'all' ? '全部' : statusLabels[status]}</TabsTrigger>)}</TabsList></Tabs>
    <Button variant="outline" onClick={() => refresh(value => value + 1)}>刷新列表</Button><Button variant="ghost" onClick={() => navigate(initial)}>重置</Button>
  </div><Card className="overflow-hidden py-0 shadow-none">{route.error ? <p role="alert" className="p-6 text-destructive">链接中的筛选或分页无效，请重置。</p>
    : error ? <p role="alert" className="p-6 text-destructive">任务列表暂不可用，请重试。</p> : !page ? <Skeleton className="m-5 h-36" /> : !page.items.length ? <p className="p-8 text-sm text-muted-foreground">没有符合条件的任务。</p>
      : <Table><TableHeader><TableRow><TableHead className="pl-5">任务编号</TableHead><TableHead>状态</TableHead><TableHead>尝试次数</TableHead><TableHead>创建时间</TableHead><TableHead>历史错误</TableHead></TableRow></TableHeader><TableBody>{page.items.map(task => <TableRow key={task.id} className="h-14">
        <TableCell className="pl-5"><Button variant="link" className="max-w-64 justify-start truncate p-0" onClick={() => navigate(route.query, task.id)}>{task.id}</Button></TableCell><TableCell><Badge variant="outline">{statusLabels[task.status]}</Badge></TableCell>
        <TableCell>{task.attempts}</TableCell><TableCell className="text-xs">{displayTime(task.createdAt)}</TableCell><TableCell className="text-xs">{task.lastError === null ? '未记录' : task.lastError === 'DELIVERY_FAILED' ? '投递失败' : '未分类错误'}</TableCell>
      </TableRow>)}</TableBody></Table>}</Card><div className="flex justify-between gap-2"><p className="text-xs text-muted-foreground">按创建时间倒序，每页最多25条</p><div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={!route.query.cursor} onClick={() => navigate({ ...route.query, cursor: null })}>回到首页</Button><Button size="sm" variant="outline" disabled={!page?.nextCursor} onClick={() => { if (page?.nextCursor) navigate({ ...route.query, cursor: page.nextCursor }) }}>下一页</Button>
      </div></div>{route.id && <TaskDetail key={`${route.query.kind}:${route.id}`} kind={route.query.kind} id={route.id} canRetry={canRetry} onSaved={() => refresh(value => value + 1)} close={() => navigate(route.query)} />}</div>
}
