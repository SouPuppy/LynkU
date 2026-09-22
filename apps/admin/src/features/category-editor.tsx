import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { CategoryChange, CategoryChangeReceipt } from '@lynku/contracts'
import { updateCategory, AdminRequestError, type AdminCategory } from '../lib/admin-client'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'

export function CategoryEditor({ category, onClose, onSaved }: { category: AdminCategory; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState(category)
  const [reason, setReason] = useState('')
  const [request, setRequest] = useState<CategoryChange | null>(null)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<AdminRequestError | null>(null)
  const [receipt, setReceipt] = useState<CategoryChangeReceipt | null>(null)
  const live = useRef(true)
  const inFlight = useRef(false)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const locked = pending || !!failure?.uncertain || !!receipt
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (inFlight.current || receipt || failure?.code === 'CONFLICT') return
    const operation = failure?.uncertain && request ? request : { requestId: crypto.randomUUID(), category: draft, reason }
    inFlight.current = true; setRequest(operation); setPending(true); setFailure(null)
    try {
      const value = await updateCategory(operation)
      if (live.current) { setReceipt(value); onSaved() }
    } catch (error) {
      if (live.current) setFailure(error instanceof AdminRequestError ? error : new AdminRequestError('输入格式不正确，请检查名称、排序和理由。', 'INVALID_INPUT', false))
    } finally { inFlight.current = false; if (live.current) setPending(false) }
  }
  return <Sheet open onOpenChange={open => { if (!open && !pending && !failure?.uncertain) onClose() }}>
    <SheetContent className="w-full overflow-y-auto sm:max-w-xl" showCloseButton={!pending && !failure?.uncertain}>
      <SheetHeader><SheetTitle>编辑分类</SheetTitle><SheetDescription>修改 {category.name} · 当前版本 {category.managementRevision}。保存后影响分类展示和发帖可选项。</SheetDescription></SheetHeader>
      <form onSubmit={submit} className="grid gap-5 px-4 pb-6">
        <fieldset disabled={locked} className="grid gap-4 disabled:opacity-70">
          <div className="grid gap-2"><Label htmlFor="category-name">名称</Label><Input id="category-name" required maxLength={50} value={draft.name} onChange={event => setDraft(value => ({ ...value, name: event.target.value }))} /></div>
          <div className="grid gap-2"><Label htmlFor="category-description">描述</Label><Input id="category-description" maxLength={500} value={draft.description} onChange={event => setDraft(value => ({ ...value, description: event.target.value }))} /></div>
          <div className="grid gap-2"><Label htmlFor="category-order">展示顺序（数字越小越靠前）</Label><Input id="category-order" required type="number" step="1" value={Number.isNaN(draft.sort_order) ? '' : draft.sort_order} onChange={event => setDraft(value => ({ ...value, sort_order: event.target.valueAsNumber }))} /></div>
          <Tabs value={draft.status} onValueChange={status => { if (status === 'active' || status === 'hidden') setDraft(value => ({ ...value, status })) }}><TabsList aria-label="分类状态"><TabsTrigger disabled={locked} value="active">启用</TabsTrigger><TabsTrigger disabled={locked} value="hidden">停用</TabsTrigger></TabsList></Tabs>
          <div className="grid gap-2"><Label htmlFor="category-reason">操作理由</Label><Input id="category-reason" required maxLength={500} placeholder="说明修改原因，将记录在操作日志中" value={reason} onChange={event => setReason(event.target.value)} /></div>
        </fieldset>
        <div className="rounded-lg border bg-muted/40 p-4 text-sm"><h3 className="mb-3 font-medium">变更预览</h3><dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs"><dt className="text-muted-foreground">名称</dt><dd>{category.name} → {draft.name}</dd><dt className="text-muted-foreground">描述</dt><dd className="break-words">{category.description || '无'} → {draft.description || '无'}</dd><dt className="text-muted-foreground">排序</dt><dd>{category.sort_order} → {String(draft.sort_order)}</dd><dt className="text-muted-foreground">状态</dt><dd>{category.status === 'active' ? '启用' : '停用'} → {draft.status === 'active' ? '启用' : '停用'}</dd></dl><p className="mt-3 text-xs text-muted-foreground">已有帖子不会因分类停用被删除。</p></div>
        {failure && <p role="alert" className="text-sm text-destructive">{failure.code === 'CONFLICT' ? '该分类已被修改。你的输入仍保留在这里，请记录需要的变更，返回列表刷新后重新编辑。' : failure.message}</p>}
        {receipt && <div role="status" className="rounded-md border p-3 text-sm">已保存为版本 {receipt.category.managementRevision}<p className="mt-1 break-all text-xs text-muted-foreground">回执：{receipt.requestId}</p></div>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={pending || !!failure?.uncertain} onClick={onClose}>{receipt ? '完成' : '返回列表'}</Button>{!receipt && <Button type="submit" disabled={pending || failure?.code === 'CONFLICT'}>{pending ? '正在提交…' : failure?.uncertain ? '重试确认原请求' : '确认并保存'}</Button>}</div>
      </form>
    </SheetContent>
  </Sheet>
}
