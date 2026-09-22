import logo from '../../../assets/logo.png'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Activity, BookOpen, FileText, FolderTree, Gavel, LayoutDashboard, Settings, Users } from 'lucide-react'
import { createRoot } from 'react-dom/client'
import { Button } from './components/ui/button'
import { Card } from './components/ui/card'
import { currentSession, onSessionEnded, signIn, signOut, type AdminSession } from './lib/admin-client'
import './styles.css'
import { AdminShell } from './components/admin-shell'
import { OverviewPanel } from './features/overview'
import { UsersPanel } from './features/users'
import { PostsPanel } from './features/posts'
import { OperationsPanel } from './features/operations'
import { AuditPanel } from './features/audit'
import { GovernancePanel } from './features/governance'
import { SettingsPanel } from './features/settings'
import { Input } from './components/ui/input'
import { CategoriesPanel } from './features/categories'

type Section = 'overview' | 'content' | 'users' | 'categories' | 'governance' | 'operations' | 'audit' | 'settings'
type Item = { description: string; icon: typeof LayoutDashboard; id: Section; label: string }
const ITEMS: readonly Item[] = [
  { id: 'overview', label: '总览', description: '真实业务指标与待处理事项', icon: LayoutDashboard }, { id: 'content', label: '内容管理', description: '帖子、评论与治理状态', icon: FileText }, { id: 'users', label: '用户与认证', description: '账号、认证和受限能力', icon: Users }, { id: 'categories', label: '分类管理', description: '分类、排序与启停', icon: FolderTree }, { id: 'governance', label: '社区治理', description: '举报、申诉和权利请求', icon: Gavel }, { id: 'operations', label: '消息与运行', description: '投递、检查与补偿任务', icon: Activity }, { id: 'audit', label: '操作记录', description: '可信操作和结果回执', icon: BookOpen }, { id: 'settings', label: '设置与权限', description: '配置来源与管理成员', icon: Settings },
]
function route(): Section { const value = location.hash.slice(1).split('?')[0]; return ITEMS.some(item => item.id === value) ? value as Section : 'overview' }
function Login({ onReady, notice }: { onReady: (session: AdminSession) => void; notice: string | null }) {
  const [identifier, setIdentifier] = useState(''); const [password, setPassword] = useState(''); const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent) { event.preventDefault(); setPending(true); setError(null); try { await signIn(identifier.trim(), password); const session = await currentSession(); if (!session) throw Error('登录状态未建立'); onReady(session) } catch (reason) { setError(reason instanceof Error ? reason.message : '登录未完成') } finally { setPending(false) } }
  return <main className="grid min-h-screen place-items-center p-5"><Card className="w-full max-w-md p-7"><div className="mb-7 flex items-center gap-3"><img src={logo} alt="LynkU" className="size-12 rounded-xl object-contain" /><div><h1 className="text-xl font-semibold">LynkU 管理后台</h1><p className="mt-1 text-sm text-slate-500">使用已配置的 CloudBase 管理账号登录</p></div></div><form className="grid gap-4" onSubmit={submit}><label className="grid gap-1 text-sm font-medium">账号<Input required autoComplete="username" value={identifier} onChange={event => setIdentifier(event.target.value)} className="h-10 rounded-md border border-slate-300 px-3" /></label><label className="grid gap-1 text-sm font-medium">密码<Input required type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className="h-10 rounded-md border border-slate-300 px-3" /></label>{(error || notice) && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error || notice}</p>}<Button disabled={pending} type="submit">{pending ? '正在验证…' : '登录后台'}</Button></form><p className="mt-5 text-xs leading-5 text-slate-500">登录本身不授予权限。仅限已获授权的管理员访问。</p></Card></main>
}
function App() {
  const [session, setSession] = useState<AdminSession | null>(null); const [section, setSection] = useState(route); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    const refresh = () => setSection(route())
    const unsubscribe = onSessionEnded(() => { setSession(null); setError('管理会话已结束，请重新登录') })
    addEventListener('hashchange', refresh)
    void currentSession().then(value => { if (active) setSession(value) }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '会话无法恢复') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; unsubscribe(); removeEventListener('hashchange', refresh) }
  }, [])
  useEffect(() => {
    if (!session) return
    let active = true
    let pending = false
    const verify = async () => {
      if (pending || document.hidden) return
      pending = true
      try {
        const next = await currentSession()
        if (active) setSession(next)
      } catch (reason) {
        if (active) { setSession(null); setError(reason instanceof Error ? reason.message : '管理资格无法确认，请重新登录') }
      } finally { pending = false }
    }
    const focus = () => { void verify() }
    addEventListener('focus', focus)
    const timer = setInterval(focus, 60_000)
    return () => { active = false; clearInterval(timer); removeEventListener('focus', focus) }
  }, [session?.accountId, session?.memberVersion])
  const current = useMemo(() => ITEMS.find(item => item.id === section)!, [section]); if (loading) return <main className="grid min-h-screen place-items-center text-sm text-slate-500">正在恢复受控会话…</main>; if (!session) return <Login notice={error} onReady={value => { setSession(value); setError(null) }} />

  const body = section === 'overview' ? <OverviewPanel /> : section === 'categories' ? <CategoriesPanel canEdit={session.capabilities.includes('categories:write')} /> : section === 'users' ? <UsersPanel canEdit={session.capabilities.includes('governance:write')} /> : section === 'content' ? <PostsPanel /> : section === 'operations' ? <OperationsPanel canRetry={session.capabilities.includes('operations:retry')} /> : section === 'audit' ? <AuditPanel /> : section === 'governance' ? session.capabilities.includes('governance:write') ? <GovernancePanel /> : <Card className="p-6">当前账号没有社区治理权限。</Card> : <SettingsPanel session={session} />
  return <AdminShell items={ITEMS} section={section} title={current.label} description={current.description} onSignOut={() => { setSession(null); void signOut().catch(() => setError('本地会话已关闭；网络退出未完成，请重新登录')) }}>{error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}{body}</AdminShell>
}
try {
  const theme = localStorage.getItem('lynku-admin-theme')
  document.documentElement.classList.toggle('dark', theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches))
} catch { /* Rendering does not depend on local storage availability. */ }
createRoot(document.getElementById('root')!).render(<App />)
