import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AdminPostDetail, RestoreGovernedPostRequest } from '@lynku/contracts'
import { readPost, restorePost, AdminRequestError } from '../lib/admin-client'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../components/ui/sheet'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Skeleton } from '../components/ui/skeleton'
import { PostComments } from './post-comments'

function RestoreControl({ detail, onRestored }: { detail: AdminPostDetail; onRestored: () => void }) {
  const [reason, setReason] = useState(''), [request, setRequest] = useState<RestoreGovernedPostRequest | null>(null)
  const [pending, setPending] = useState(false), [error, setError] = useState<AdminRequestError | null>(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  if (detail.status !== 'hidden' || !detail.governanceCaseId) return null
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    const operation = error?.uncertain && request ? request : { requestId: crypto.randomUUID(), postId: detail.id, caseId: detail.governanceCaseId!, expectedRevision: detail.revision, reason: reason.trim() }
    setRequest(operation); setPending(true); setError(null)
    try { await restorePost(operation); if (alive.current) onRestored() }
    catch (failure) { if (alive.current) setError(failure instanceof AdminRequestError ? failure : new AdminRequestError('恢复未完成，请重新核对。', 'UNCONFIRMED', true)) }
    finally { if (alive.current) setPending(false) }
  }
  return <section className="rounded-lg border border-primary/25 bg-primary/[.03] p-4"><h3 className="text-sm font-medium">恢复下架内容</h3><p className="mt-2 text-xs leading-6 text-muted-foreground">仅恢复当前保存的原正文。提交前会重新执行微信自动安全检查，服务端会再次核验帖子版本、作者删除状态、关联案件结论及分类计数；任何变化都会拒绝恢复。</p>
    <form className="mt-4 flex flex-wrap gap-2" onSubmit={submit}><Input aria-label="恢复理由" required maxLength={1000} disabled={pending || !!error?.uncertain} value={reason} onChange={event => setReason(event.target.value)} placeholder="填写恢复理由，写入操作记录" className="min-w-56 flex-1" /><Button type="submit" disabled={pending || !reason.trim()}>{pending ? '正在核对并恢复…' : error?.uncertain ? '确认原请求结果' : '确认恢复'}</Button></form>
    {error && <p role="alert" className="mt-3 text-xs text-destructive">{error.code === 'CONFLICT' ? '帖子、案件或分类已变化，请刷新后重新核对。' : error.message}</p>}
  </section>
}

export function PostDetail({ id, onClose, canRestore = false }: { id: string; onClose: () => void; canRestore?: boolean }) {
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
        {canRestore && <RestoreControl detail={detail} onRestored={() => setAttempt(value => value + 1)} />}
        <PostComments key={`${detail.id}:${attempt}`} postId={detail.id} />
      </>}
    </div>
  </SheetContent></Sheet>
}
