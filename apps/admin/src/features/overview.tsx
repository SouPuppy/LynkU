import { useEffect, useState } from 'react'
import { ArrowUpRight, RefreshCw } from 'lucide-react'
import { loadOverview, type AdminOverview } from '../lib/admin-client'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Skeleton } from '../components/ui/skeleton'

const METRICS = [
  { key: 'users', label: '微信账号', note: '当前保留的账号记录', route: 'users' },
  { key: 'verifiedUsers', label: '学校认证', note: '已通过学校邮箱认证', route: 'users' },
  { key: 'posts', label: '公开帖子', note: '当前处于已发布状态', route: 'content' },
  { key: 'openCases', label: '待处理举报', note: '已受理且尚未结案', route: 'governance' },
] as const
export function OverviewPanel() {
  const [result, setResult] = useState<AdminOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setResult(null); setError(null)
    void loadOverview().then(value => { if (active) setResult(value) }).catch(() => { if (active) setError('暂时无法读取总览，请重试。') })
    return () => { active = false }
  }, [attempt])
  return <section aria-label="业务总览"><div className="mb-4 flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">当前累计 · 各项指标独立读取</p><Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}><RefreshCw />刷新</Button></div>
    {error ? <Card className="p-6"><p role="alert" className="text-sm text-destructive">{error}</p></Card> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{METRICS.map(item => {
      const metric = result?.metrics[item.key]
      return <Card key={item.key} className="gap-3 py-4 shadow-none"><CardHeader className="px-4"><CardTitle className="text-xs font-normal text-muted-foreground">{item.label}</CardTitle></CardHeader><CardContent className="px-4">{!metric ? <Skeleton className="my-2 h-9 w-20" /> : <p className="text-3xl font-semibold tabular-nums tracking-tight">{metric.state === 'available' ? metric.value?.toLocaleString() : <span className="text-sm font-normal text-muted-foreground">{metric.state === 'forbidden' ? '无查看权限' : '暂不可用'}</span>}</p>}<p className="mt-2 text-xs text-muted-foreground">{item.note}</p>{metric?.state === 'available' && <Button asChild variant="link" className="mt-2 h-auto p-0 text-xs"><a href={`#${item.route}`}>查看记录<ArrowUpRight /></a></Button>}</CardContent></Card>
    })}</div>}
    {result && <p className="mt-4 text-xs text-muted-foreground">读取时间：{new Date(result.observedAt).toLocaleString('zh-CN')}。读取失败的指标显示暂不可用。</p>}
  </section>
}
