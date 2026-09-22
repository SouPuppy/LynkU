import { useEffect, useState } from 'react'
import type { AdminCommentPage, CommentHistoryCursor } from '@lynku/contracts'
import { listComments } from '../lib/admin-client'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Skeleton } from '../components/ui/skeleton'

export function PostComments({ postId }: { postId: string }) {
  const [request, setRequest] = useState<{ cursor: CommentHistoryCursor | null }>({ cursor: null })
  const [history, setHistory] = useState<(CommentHistoryCursor | null)[]>([])
  const [page, setPage] = useState<AdminCommentPage | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    setPage(null); setError(false)
    void listComments(postId, request.cursor).then(value => { if (active) setPage(value) }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [postId, request])
  return <section aria-label="帖子评论" className="space-y-3 border-t pt-5"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">评论与回复</h3><Button size="sm" variant="ghost" onClick={() => { setHistory([]); setRequest({ cursor: null }) }}>刷新</Button></div>
    {error ? <p role="alert" className="text-sm text-destructive">评论暂时无法读取，所属帖子可能已删除。请刷新确认。</p> : !page ? <Skeleton aria-label="正在读取评论" className="h-24" /> : !page.items.length ? <p className="py-5 text-sm text-muted-foreground">暂无评论。</p> : <ol className="divide-y rounded-lg border px-4">{page.items.map(item => <li key={item._id} className="py-4"><div className="mb-2 flex flex-wrap items-center gap-2 text-xs"><span className="font-medium">{item.authorLabel}</span><span className="text-muted-foreground">{new Date(item.created_at).toLocaleString('zh-CN')}</span>{item.status !== 'published' && <Badge variant="outline">{item.status === 'deleted' ? '已删除' : '历史受限'}</Badge>}</div>{item.parent_id && <p className="mb-2 break-all text-xs text-muted-foreground">回复评论：{item.parent_id}</p>}<p className="whitespace-pre-wrap break-words text-sm leading-6">{item.status === 'published' ? item.content : '该评论正文不再展示。'}</p><p className="mt-2 break-all text-[10px] text-muted-foreground">评论编号：{item._id}</p></li>)}</ol>}
    <div className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">第 {history.length + 1} 页 · 按发布时间排列</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={!history.length} onClick={() => { setRequest({ cursor: history[history.length - 1] ?? null }); setHistory(value => value.slice(0, -1)) }}>上一页</Button><Button variant="outline" size="sm" disabled={!page?.nextCursor} onClick={() => { if (!page?.nextCursor) return; setHistory(value => [...value, request.cursor]); setRequest({ cursor: page.nextCursor }) }}>下一页</Button></div></div>
  </section>
}
