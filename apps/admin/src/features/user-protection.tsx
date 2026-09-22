import { useEffect, useState } from 'react'
import type { RestrictedCapability, RestrictionChange } from '@lynku/contracts'
import { readUserProtection, updateUserProtection, AdminRequestError } from '../lib/admin-client'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../components/ui/sheet'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
const labels = { posts: '发帖及编辑', comments: '发表评论', messages: '发送私信' }
function accountReference(id: string) { return id.length <= 14 ? id : `${id.slice(0, 8)}…${id.slice(-6)}` }
export function UserProtection({ accountId, canEdit, onClose }: { accountId: string; canEdit: boolean; onClose: () => void }) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof readUserProtection>> | null>(null)
  const [capability, setCapability] = useState<RestrictedCapability>('posts'), [hours, setHours] = useState(24), [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null), [pending, setPending] = useState(false), [retry, setRetry] = useState<RestrictionChange | null>(null), [refresh, setRefresh] = useState(0)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    let active = true
    setDetail(null); setError(null)
    void readUserProtection(accountId).then(value => { if (active) setDetail(value) }).catch(() => { if (active) setError('用户详情暂时无法读取') })
    return () => { active = false }
  }, [accountId, refresh])
  async function save() {
    if (!detail || pending) return
    const request = retry || { accountId, expectedVersion: detail.restrictions.version, capability, until: hours ? new Date(Date.now() + hours * 3600000).toISOString() : null, requestId: crypto.randomUUID(), reason }
    setPending(true); setError(null); setSaved(false)
    try { const restrictions = await updateUserProtection(request); setDetail({ ...detail, restrictions }); setRetry(null); setReason(''); setSaved(true) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '操作失败'); setRetry(failure instanceof AdminRequestError && failure.uncertain ? request : null) }
    finally { setPending(false) }
  }
  const locked = pending || retry !== null
  return <Sheet open onOpenChange={open => { if (!open && !locked) onClose() }}><SheetContent className="overflow-y-auto sm:max-w-lg"><SheetHeader><SheetTitle>{detail?.user.displayName || '用户详情'}</SheetTitle><SheetDescription>账号能力与学校认证分别管理。</SheetDescription></SheetHeader><div className="space-y-5 p-6">
    <Button variant="outline" disabled={locked} onClick={() => setRefresh(value => value + 1)}>刷新详情</Button>
    {detail && <><div className="space-y-2 text-sm"><p>账号编号：<code className="text-xs">{accountReference(detail.user.id)}</code></p><p>注册时间：{new Date(detail.user.createdAt).toLocaleString('zh-CN')}</p><p>学校认证：{detail.user.verified ? '已认证' : '游客'}</p><p>学校邮箱：{detail.user.contactEmail || '未绑定'}</p>{(['posts', 'comments', 'messages'] as const).map(key => <p key={key}>{labels[key]}：{detail.restrictions[key] && Date.parse(detail.restrictions[key]) > Date.now() ? `受限至 ${new Date(detail.restrictions[key]).toLocaleString('zh-CN')}` : '未限制'}</p>)}<p className="text-muted-foreground">限制版本 {detail.restrictions.version}</p></div>
    {canEdit && <fieldset disabled={locked} className="space-y-4"><legend className="mb-3 font-medium">调整能力</legend><div className="flex flex-wrap gap-2">{(['posts', 'comments', 'messages'] as const).map(key => <Button key={key} variant={capability === key ? 'default' : 'outline'} onClick={() => setCapability(key)}>{labels[key]}</Button>)}</div><div className="flex flex-wrap gap-2">{[0, 1, 24, 168, 720].map(value => <Button key={value} size="sm" variant={hours === value ? 'default' : 'outline'} onClick={() => setHours(value)}>{value === 0 ? '解除限制' : value < 24 ? `${value}小时` : `${value / 24}天`}</Button>)}</div><label className="grid gap-2 text-sm">处理原因<Input maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label></fieldset>}
    <p className="rounded-md bg-muted p-3 text-xs leading-6">限制只影响选中的能力，到期自动解除。保留学校认证、浏览、举报、申诉及个人信息权利。</p>
    {canEdit && <Button disabled={pending || !reason.trim()} onClick={() => { void save() }}>{pending ? '提交中…' : retry ? '确认原请求结果' : hours ? `确认限制${labels[capability]}` : `确认解除${labels[capability]}限制`}</Button>}</>}
    {saved && <p role="status" className="text-sm">设置已生效，已记录操作回执。</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div></SheetContent></Sheet>
}
