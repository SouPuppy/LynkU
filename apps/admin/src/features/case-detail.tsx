import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { CaseDetail as Detail, CloseCaseRequest, CaseOutcome, AdminPostDetail, AdminCommentDetail } from '@lynku/contracts'
import { readCase, readPost, readComment, closeCase, AdminRequestError } from '../lib/admin-client'
import { Sheet, SheetHeader, SheetTitle, SheetDescription, SheetContent } from '../components/ui/sheet'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Skeleton } from '../components/ui/skeleton'
export function CaseDetail({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [target, setTarget] = useState<AdminPostDetail | null>(null)
  const [comment, setComment] = useState<AdminCommentDetail | null>(null)
  const [error, setError] = useState<AdminRequestError | null>(null)
  const [reason, setReason] = useState('')
  const [outcome, setOutcome] = useState<CaseOutcome>('no_violation')
  const [pending, setPending] = useState(false)
  const [operation, setOperation] = useState<CloseCaseRequest | null>(null)
  const [attempt, setAttempt] = useState(0)
  const alive = useRef(true), busy = useRef(false)
  useEffect(() => {
    alive.current = true
    let active = true
    setDetail(null); setTarget(null); setComment(null); setError(null)
    void readCase(id).then(async value => {
      if (!active) return
      setDetail(value)
      if (value.targetType === 'post') {
        try { const post = await readPost(value.targetId); if (active) setTarget(post) } catch { /* An unavailable target cannot be selected for takedown. */ }
      } else {
        try { const item = await readComment(value.targetId); if (active) setComment(item) } catch { /* Missing or removed comments cannot be selected. */ }
      }
    }).catch(() => { if (active) setError(new AdminRequestError('案件详情暂不可用，请重试。', 'QUERY_ERROR', false)) })
    return () => { active = false; alive.current = false }
  }, [id, attempt])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!detail || busy.current || detail.status !== 'open' || error?.code === 'CONFLICT') return
    if (outcome === 'hide_post' && (!target || target.status !== 'published') && !error?.uncertain) return
    if (outcome === 'remove_comment' && !comment && !error?.uncertain) return
    const request = error?.uncertain && operation ? operation : { id, expectedVersion: detail.version, outcome, reason: reason.trim(), requestId: crypto.randomUUID(), ...(outcome === 'hide_post' && target ? { targetRevision: target.revision } : {}), ...(outcome === 'remove_comment' && comment ? { targetToken: comment.versionToken } : {}) }
    setOperation(request); setPending(true); setError(null); busy.current = true
    try { const value = await closeCase(request); if (alive.current) { setDetail(value); onSaved() } }
    catch (reason) { if (alive.current) setError(reason instanceof AdminRequestError ? reason : new AdminRequestError('请填写处理理由。', 'INVALID_INPUT', false)) }
    finally { busy.current = false; if (alive.current) setPending(false) }
  }
  const locked = pending || !!error?.uncertain
  return <Sheet open onOpenChange={open => { if (!open && !locked) onClose() }}><SheetContent className="w-full overflow-y-auto sm:max-w-xl" showCloseButton={!locked}><SheetHeader><SheetTitle>举报案件</SheetTitle><SheetDescription>仅展示处理当前举报所需的资料。</SheetDescription></SheetHeader><div className="space-y-5 px-4 pb-6">
    {error && <p role="alert" className="text-sm text-destructive">{error.code === 'CONFLICT' ? '案件已被其他操作更新，请刷新后重新核对。' : error.message}</p>}
    {!detail ? error ? <Button variant="outline" onClick={() => setAttempt(value => value + 1)}>重试</Button> : <Skeleton className="h-40" /> : <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm"><dt>状态</dt><dd>{detail.status === 'open' ? '待处理' : '已结案'} · 版本 {detail.version}</dd><dt>举报类型</dt><dd>{detail.reasonCode}</dd><dt>对象</dt><dd className="break-all">{detail.targetType === 'post' ? <a href={`#content?post=${encodeURIComponent(detail.targetId)}`} className="text-primary underline">查看帖子</a> : `评论 ${detail.targetId}`}</dd></dl>
      <section><h3 className="mb-2 text-sm font-medium">举报说明</h3><p className="whitespace-pre-wrap break-words rounded-md border p-3 text-sm leading-6">{detail.statement || '举报人未补充说明。'}</p></section>
      {detail.appeal && <section className="space-y-3 rounded-md border border-primary/30 p-4"><h3 className="text-sm font-medium">举报人申诉 · {new Date(detail.appeal.submittedAt).toLocaleString('zh-CN')}</h3><p className="whitespace-pre-wrap break-words text-sm">{detail.appeal.statement}</p><details><summary className="cursor-pointer text-xs text-muted-foreground">原处理记录 · 版本 {detail.appeal.previousVersion} · {detail.appeal.previousOutcome}</summary><p className="mt-2 whitespace-pre-wrap text-sm">{detail.appeal.previousResolution}</p></details><p className="text-xs text-muted-foreground">请结合申诉重新核对，复核结论会反馈给举报人。受理申诉不会自动恢复内容。</p></section>}
      {comment && <section className="rounded-md border p-3"><h3 className="text-sm font-medium">被举报评论 · {comment.authorLabel}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm">{comment.content}</p><a className="mt-3 block text-xs text-primary underline" href={`#content?post=${encodeURIComponent(comment.post_id)}`}>查看所属帖子与回复语境</a></section>}
      {target && <details className="rounded-md border p-3"><summary className="cursor-pointer text-sm font-medium">被举报帖子：{target.title} · 版本 {target.revision}</summary><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{target.content}</p></details>}
      {detail.targetType === 'post' && !target && <p className="text-xs text-muted-foreground">正在读取帖子或内容已不可用；取得当前版本后才能下架。</p>}
      {detail.status === 'closed' ? <section role="status" className="rounded-md border p-4"><h3 className="text-sm font-medium">{detail.outcome === 'remove_comment' ? '违规评论已移除' : detail.outcome === 'hide_post' ? '违规内容已下架' : detail.outcome === 'duplicate' ? '重复举报' : '未发现违规'} · 已结案</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm">{detail.resolution}</p>{operation && <p className="mt-2 break-all text-xs text-muted-foreground">回执：{operation.requestId}</p>}</section>
        : <form onSubmit={submit} className="space-y-4"><Tabs value={outcome} onValueChange={value => { if (value === 'no_violation' || value === 'duplicate' || value === 'hide_post' || value === 'remove_comment') setOutcome(value) }}><TabsList aria-label="结案结论"><TabsTrigger disabled={locked} value="no_violation">未发现违规</TabsTrigger><TabsTrigger disabled={locked} value="duplicate">重复举报</TabsTrigger>{detail.targetType === 'post' && <TabsTrigger disabled={locked || !target || target.status !== 'published'} value="hide_post">违规下架</TabsTrigger>}{detail.targetType === 'comment' && <TabsTrigger disabled={locked || !comment} value="remove_comment">移除违规评论</TabsTrigger>}</TabsList></Tabs><div className="grid gap-2"><Label htmlFor="case-resolution">处理理由（向举报人提供）</Label><Input id="case-resolution" required maxLength={1000} disabled={locked} value={reason} onChange={event => setReason(event.target.value)} /></div><p className="text-xs text-muted-foreground">{outcome === 'remove_comment' ? '将移除预览中的评论正文、更新评论计数并结案。回复关系保留为占位。' : outcome === 'hide_post' ? '将下架上述版本的帖子并结案，公开列表和通知预览将不再展示该内容。' : '本操作只结案，不修改被举报内容。'}</p><Button type="submit" disabled={pending || error?.code === 'CONFLICT'}>{pending ? '正在提交…' : error?.uncertain ? '确认原请求结果' : '确认结案'}</Button>{error?.code === 'CONFLICT' && <Button type="button" variant="outline" onClick={() => setAttempt(value => value + 1)}>刷新案件</Button>}</form>}
    </>}
  </div></SheetContent></Sheet>
}
