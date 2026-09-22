import { listCases } from '../lib/admin-client'
import { useEffect, useState } from 'react'
import { CaseDetail } from './case-detail'
import { useAdminQuery } from '../hooks/use-admin-query'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Skeleton } from '../components/ui/skeleton'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../components/ui/table'
export function GovernancePanel() {
  const selectedCase = () => new URLSearchParams(location.hash.split('?')[1] || '').get('case')
  const [selected, setSelected] = useState(selectedCase)
  useEffect(() => { const update = () => setSelected(selectedCase()); addEventListener('hashchange', update); return () => removeEventListener('hashchange', update) }, [])
  const { data, error, refresh } = useAdminQuery(listCases)
  return <section aria-label="社区治理"><div className="mb-4 flex items-center justify-between"><p className="text-xs text-muted-foreground">最近50条举报案件</p><Button variant="outline" size="sm" onClick={refresh}>刷新</Button></div><Card className="overflow-hidden py-0 shadow-none">
    {error ? <p role="alert" className="p-6 text-sm text-destructive">案件暂时无法读取，请检查权限或重试。</p> : !data ? <Skeleton className="m-5 h-32" /> : !data.length ? <p className="p-8 text-sm text-muted-foreground">暂无举报案件。</p> : <Table><TableHeader><TableRow><TableHead className="pl-5">举报对象</TableHead><TableHead>原因</TableHead><TableHead>状态</TableHead><TableHead>受理时间</TableHead></TableRow></TableHeader><TableBody>{data.map(item => <TableRow key={item.id} className="h-16"><TableCell className="pl-5">{item.targetType === 'post' ? <a href={`#content?post=${encodeURIComponent(item.targetId)}`} className="text-primary hover:underline">查看被举报帖子</a> : '评论'}<p className="mt-1 max-w-64 break-all text-xs text-muted-foreground">{item.targetId}</p></TableCell><TableCell><a className="text-primary hover:underline" href={`#governance?case=${encodeURIComponent(item.id)}`}>{item.reason}</a></TableCell><TableCell><Badge variant="outline">{item.status === 'open' ? '待处理' : item.status === 'closed' ? '已结案' : item.status}</Badge></TableCell><TableCell className="text-xs">{new Date(item.createdAt).toLocaleString('zh-CN')}</TableCell></TableRow>)}</TableBody></Table>}
  </Card>{selected && <CaseDetail key={selected} id={selected} onClose={() => { location.hash = 'governance' }} onSaved={refresh} />}</section>
}
