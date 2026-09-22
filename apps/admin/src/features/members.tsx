import { useState } from 'react'
import type { AdminMemberView, AdminMemberChange } from '@lynku/contracts'
import { listMembers, updateMember, AdminRequestError } from '../lib/admin-client'
import { useAdminQuery } from '../hooks/use-admin-query'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from '../components/ui/table'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../components/ui/sheet'
import { Input } from '../components/ui/input'
const roles = { owner: '所有者', community: '社区管理员', viewer: '只读管理员' }
export function MembersPanel() {
  const query = useAdminQuery(listMembers)
  const [selected, select] = useState<AdminMemberView | null>(null)
  return <Card className="shadow-none lg:col-span-2"><CardHeader className="flex-row items-center justify-between"><CardTitle>管理成员</CardTitle><Button variant="outline" onClick={() => query.refresh()}>刷新</Button></CardHeader><CardContent>
    <p className="mb-4 text-xs text-muted-foreground">管理资格独立于学校认证。不能修改自己的资格；请由另一位所有者操作。新增登录账号通过受控初始化流程关联。</p>
    {!query.data && !query.error ? <p>正在加载…</p> : query.error ? <p role="alert" className="text-destructive">成员暂时无法加载，请刷新重试。</p> : <Table><TableHeader><TableRow><TableHead>成员编号</TableHead><TableHead>角色</TableHead><TableHead>状态</TableHead><TableHead>版本</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{query.data?.map(member => <TableRow key={member.id}><TableCell className="max-w-64 truncate" title={member.id}>{member.id}<small className="block text-muted-foreground">{member.kind === 'platform-owner' ? '独立平台账号' : '关联业务账号'}</small></TableCell><TableCell>{roles[member.role]}</TableCell><TableCell><Badge variant={member.status === 'active' ? 'secondary' : 'outline'}>{member.status === 'active' ? '有效' : '已撤权'}</Badge></TableCell><TableCell>{member.version}</TableCell><TableCell><Button variant="outline" size="sm" onClick={() => select(member)}>管理权限</Button></TableCell></TableRow>)}</TableBody></Table>}
    {selected && <MemberEditor key={selected.id + ':' + selected.version} member={selected} onClose={() => select(null)} onSaved={() => { select(null); query.refresh() }} />}
  </CardContent></Card>
}
function MemberEditor({ member, onClose, onSaved }: { member: AdminMemberView; onClose: () => void; onSaved: () => void }) {
  const [role, setRole] = useState(member.role), [status, setStatus] = useState(member.status), [reason, setReason] = useState('')
  const [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null), [retry, setRetry] = useState<AdminMemberChange | null>(null)
  const locked = pending || retry !== null
  async function save() {
    if (pending) return
    const request = retry || { id: member.id, role, status, reason, expectedVersion: member.version, requestId: crypto.randomUUID() }
    setPending(true); setError(null)
    try { await updateMember(request); onSaved() }
    catch (failure) { setError(failure instanceof Error ? failure.message : '修改失败'); setRetry(failure instanceof AdminRequestError && failure.uncertain ? request : null) }
    finally { setPending(false) }
  }
  return <Sheet open onOpenChange={open => { if (!open && !locked) onClose() }}><SheetContent className="overflow-y-auto sm:max-w-lg"><SheetHeader><SheetTitle>修改管理资格</SheetTitle><SheetDescription>成员 {member.id} · 当前版本 {member.version}</SheetDescription></SheetHeader><div className="space-y-6 p-6">
    <fieldset disabled={locked} className="space-y-3"><legend className="mb-2 text-sm font-medium">角色</legend><div className="flex flex-wrap gap-2">{(['owner', 'community', 'viewer'] as const).map(value => <Button key={value} variant={role === value ? 'default' : 'outline'} disabled={member.kind === 'platform-owner' && value !== 'owner'} onClick={() => setRole(value)}>{roles[value]}</Button>)}</div><div className="flex gap-2">{(['active', 'revoked'] as const).map(value => <Button key={value} variant={status === value ? 'default' : 'outline'} onClick={() => setStatus(value)}>{value === 'active' ? '启用资格' : '撤销资格'}</Button>)}</div><label className="grid gap-2 text-sm">操作原因<Input maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label></fieldset>
    <p className="rounded-md bg-muted p-3 text-sm">{roles[member.role]} → {roles[role]}；{member.status === 'active' ? '有效' : '已撤权'} → {status === 'active' ? '有效' : '已撤权'}。版本 {member.version} → {member.version + 1}。</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button disabled={pending || !reason.trim() || role === member.role && status === member.status} onClick={() => { void save() }}>{pending ? '正在提交…' : retry ? '确认原请求结果' : '确认修改'}</Button>
  </div></SheetContent></Sheet>
}
