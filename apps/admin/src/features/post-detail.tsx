import { useEffect, useState } from 'react'
import type { AdminPostDetail } from '@lynku/contracts'
import { readPost } from '../lib/admin-client'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../components/ui/sheet'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Skeleton } from '../components/ui/skeleton'
import { PostComments } from './post-comments'

export function PostDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<AdminPostDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setDetail(null); setError(null)
    void readPost(id).then(value => { if (active) setDetail(value) })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '详情暂时无法读取') })
    return () => { active = false }
  }, [id, attempt])
  return <Sheet open onOpenChange={open => { if (!open) onClose() }}><SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
    <SheetHeader><SheetTitle>帖子详情</SheetTitle><SheetDescription>读取当前保存的内容与状态</SheetDescription></SheetHeader>
    <div className="space-y-5 px-4 pb-6"><Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>刷新详情</Button>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : !detail ? <div role="status" className="space-y-4"><span className="sr-only">正在加载详情</span><Skeleton className="h-8 w-3/4" /><Skeleton className="h-40 w-full" /></div> : <>
        <div><div className="mb-3 flex flex-wrap gap-2"><Badge variant="secondary">{detail.status === 'published' ? '已发布' : detail.status === 'hidden' ? '已下架' : '历史受限'}</Badge><Badge variant="outline">版本 {detail.revision}</Badge></div><h2 className="break-words text-xl font-semibold">{detail.title}</h2><p className="mt-3 text-xs text-muted-foreground">{detail.authorLabel} · {new Date(detail.createdAt).toLocaleString('zh-CN')}</p></div>
        <article className="whitespace-pre-wrap break-words rounded-lg border p-4 text-sm leading-7">{detail.content}</article>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs"><dt className="text-muted-foreground">评论数</dt><dd>{detail.commentCount}</dd><dt className="text-muted-foreground">最后更新</dt><dd>{new Date(detail.updatedAt).toLocaleString('zh-CN')}</dd></dl>
        <PostComments key={`${detail.id}:${attempt}`} postId={detail.id} />
      </>}
    </div>
  </SheetContent></Sheet>
}
