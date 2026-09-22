import { useEffect, useState, type FormEvent } from 'react'
import type { AdminPostPage, AdminPostQuery, AdminPostCursor, AdminPostStatus } from '@lynku/contracts'
import { listPosts } from '../lib/admin-client'
import { PostDetail } from './post-detail'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import { Skeleton } from '../components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from '../components/ui/table'
const LABELS: Record<AdminPostStatus, string> = { published: '已发布', hidden: '已下架', flagged: '历史受限', deleted: '已删除' }
export function PostsPanel({ canRestore = false }: { canRestore?: boolean }) {
  const readSelected = () => new URLSearchParams(location.hash.split('?')[1] || '').get('post')
  const [selected, setSelected] = useState(readSelected)
  useEffect(() => {
    const update = () => setSelected(readSelected())
    addEventListener('hashchange', update)
    return () => removeEventListener('hashchange', update)
  }, [])
  const [text, setText] = useState('')
  const [request, setRequest] = useState<AdminPostQuery>({ query: '', status: 'published', cursor: null, limit: 25 })
  const [history, setHistory] = useState<(AdminPostCursor | null)[]>([])
  const [page, setPage] = useState<AdminPostPage | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    setPage(null); setError(false)
    void listPosts(request).then(value => { if (active) setPage(value) }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [request])
  function search(event: FormEvent) { event.preventDefault(); setHistory([]); setRequest(value => ({ ...value, query: text.trim(), cursor: null })) }
  return <section aria-label="帖子管理">
    {selected && <PostDetail key={selected} id={selected} canRestore={canRestore} onClose={() => { location.hash = 'content' }} />}
    <Tabs value={request.status} onValueChange={status => {
      if (status !== 'published' && status !== 'hidden' && status !== 'flagged' && status !== 'deleted') return
      setHistory([]); setText(''); setRequest({ status, query: '', cursor: null, limit: 25 })
    }}><TabsList className="mb-4" aria-label="帖子状态">{(Object.keys(LABELS) as AdminPostStatus[]).map(status => <TabsTrigger key={status} value={status}>{LABELS[status]}</TabsTrigger>)}</TabsList></Tabs>
    <form onSubmit={search} className="mb-4 flex flex-wrap gap-2"><Input aria-label="搜索帖子标题" placeholder="搜索帖子标题…" disabled={request.status === 'deleted'} maxLength={80} value={text} onChange={event => setText(event.target.value)} className="w-72" /><Button type="submit" variant="secondary" disabled={request.status === 'deleted'}>搜索</Button><Button type="button" variant="outline" onClick={() => setRequest(value => ({ ...value }))}>刷新</Button></form>
    {request.status === 'deleted' && <p className="mb-4 text-xs text-muted-foreground">已删除记录仅显示状态信息，标题与作者不再展示。</p>}
    <Card className="overflow-hidden py-0 shadow-none">
      {error ? <p role="alert" className="p-6 text-sm text-destructive">内容列表暂时无法加载，请重试。</p> : !page ? <div role="status" className="grid gap-4 p-6"><span className="sr-only">正在加载帖子</span>{[0, 1, 2].map(key => <Skeleton key={key} className="h-12" />)}</div>
        : !page.items.length ? <p className="p-8 text-center text-sm text-muted-foreground">没有符合条件的帖子。</p>
        : <Table><TableHeader className="bg-muted/50"><TableRow><TableHead className="pl-5">帖子</TableHead><TableHead>作者</TableHead><TableHead>状态</TableHead><TableHead className="text-right">评论</TableHead><TableHead className="pr-5">发布时间</TableHead></TableRow></TableHeader><TableBody>{page.items.map(post => <TableRow key={post.id} className="h-16"><TableCell className="max-w-96 whitespace-normal pl-5"><span className="font-medium">{post.status === 'deleted' ? post.title : <a className="text-primary underline-offset-4 hover:underline" href={`#content?post=${encodeURIComponent(post.id)}`}>{post.title}</a>}</span><p className="mt-1 text-xs text-muted-foreground">版本 {post.revision}</p></TableCell><TableCell className="text-muted-foreground">{post.authorLabel}</TableCell><TableCell><Badge variant={post.status === 'published' ? 'secondary' : 'outline'}>{LABELS[post.status]}</Badge></TableCell><TableCell className="text-right tabular-nums">{post.commentCount}</TableCell><TableCell className="pr-5 text-xs text-muted-foreground">{new Date(post.createdAt).toLocaleString('zh-CN')}</TableCell></TableRow>)}</TableBody></Table>}
    </Card>
    <div className="mt-4 flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">第 {history.length + 1} 页 · 每页最多25条</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={!history.length} onClick={() => { const cursor = history[history.length - 1] ?? null; setHistory(value => value.slice(0, -1)); setRequest(value => ({ ...value, cursor })) }}>上一页</Button><Button variant="outline" size="sm" disabled={!page?.nextCursor} onClick={() => { if (!page?.nextCursor) return; setHistory(value => [...value, request.cursor]); setRequest(value => ({ ...value, cursor: page.nextCursor })) }}>下一页</Button></div></div>
  </section>
}
