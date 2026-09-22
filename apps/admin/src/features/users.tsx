import { UserProtection } from './user-protection'
import { useEffect, useState, type FormEvent } from 'react'
import type { AdminUserPage, AdminUserQuery, AdminUserCursor } from '@lynku/contracts'
import { listUsers } from '../lib/admin-client'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import { Skeleton } from '../components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from '../components/ui/table'

const roleLabel: Record<string, string> = { admin: '业务管理员', user: '普通用户' }
function accountReference(id: string) { return id.length <= 14 ? id : `${id.slice(0, 8)}…${id.slice(-6)}` }

export function UsersPanel({ canEdit = false }: { canEdit?: boolean }) {
  const [selected, select] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [verification, setVerification] = useState<AdminUserQuery['verification']>('all')
  const [request, setRequest] = useState<AdminUserQuery>({ query: '', verification: 'all', cursor: null, limit: 25 })
  const [history, setHistory] = useState<(AdminUserCursor | null)[]>([])
  const [page, setPage] = useState<AdminUserPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    setPage(null); setError(null)
    void listUsers(request).then(value => { if (active) setPage(value) }).catch(() => { if (active) setError('用户列表暂时无法加载，请重试。') })
    return () => { active = false }
  }, [request])
  function search(event: FormEvent) {
    event.preventDefault(); setHistory([])
    setRequest({ query: query.trim(), verification, limit: 25, cursor: null })
  }
  return <section aria-label="用户与认证列表">
    <form onSubmit={search} className="mb-4 flex flex-wrap items-center gap-2">
      <Input aria-label="搜索昵称" placeholder="搜索昵称…" maxLength={80} value={query} onChange={event => setQuery(event.target.value)} className="w-64" />
      <Tabs value={verification} onValueChange={value => { if (value === 'all' || value === 'verified' || value === 'guest') setVerification(value) }}>
        <TabsList aria-label="认证状态"><TabsTrigger value="all">全部</TabsTrigger><TabsTrigger value="verified">学校已认证</TabsTrigger><TabsTrigger value="guest">游客</TabsTrigger></TabsList>
      </Tabs>
      <Button type="submit" variant="secondary">筛选</Button><Button type="button" variant="outline" onClick={() => setRequest(value => ({ ...value }))}>刷新</Button>
    </form>
    <Card className="overflow-hidden py-0 shadow-none">
      {error ? <p role="alert" className="p-6 text-sm text-destructive">{error}</p> : !page ? <div role="status" className="grid gap-4 p-6"><span className="sr-only">正在加载用户</span>{[0, 1, 2].map(key => <Skeleton key={key} className="h-12" />)}</div>
        : page.items.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">没有符合条件的账号。</p>
        : <Table><TableHeader className="bg-muted/50"><TableRow><TableHead className="pl-5">用户</TableHead><TableHead>账号编号</TableHead><TableHead>学校邮箱</TableHead><TableHead>认证状态</TableHead><TableHead>角色</TableHead><TableHead className="pr-5">注册时间</TableHead></TableRow></TableHeader>
          <TableBody>{page.items.map(user => <TableRow key={user.id} className="h-16"><TableCell className="pl-5 font-medium"><Button variant="link" className="h-auto p-0 text-left" onClick={() => select(user.id)}>{user.displayName}<span className="block text-xs font-normal text-muted-foreground">查看账号详情与受限能力</span></Button></TableCell><TableCell className="font-mono text-xs text-muted-foreground" title={user.id}>{accountReference(user.id)}</TableCell><TableCell className="text-muted-foreground">{user.email || '未绑定'}</TableCell><TableCell><Badge variant={user.verified ? 'secondary' : 'outline'}>{user.verified ? '学校已认证' : '游客'}</Badge></TableCell><TableCell className="text-xs text-muted-foreground">{roleLabel[user.role] || user.role}</TableCell><TableCell className="pr-5 text-xs tabular-nums text-muted-foreground">{new Date(user.createdAt).toLocaleString('zh-CN')}</TableCell></TableRow>)}</TableBody>
        </Table>}
    </Card>
    <div className="mt-4 flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">第 {history.length + 1} 页 · 每页最多 25 个账号</p><div className="flex gap-2">
      <Button variant="outline" size="sm" disabled={!history.length} onClick={() => { const cursor = history[history.length - 1] ?? null; setHistory(value => value.slice(0, -1)); setRequest(value => ({ ...value, cursor })) }}>上一页</Button>
      <Button variant="outline" size="sm" disabled={!page?.nextCursor} onClick={() => { if (!page?.nextCursor) return; setHistory(value => [...value, request.cursor]); setRequest(value => ({ ...value, cursor: page.nextCursor })) }}>下一页</Button>
    </div></div>
    {selected && <UserProtection key={selected} accountId={selected} canEdit={canEdit} onClose={() => select(null)} />}
  </section>
}
