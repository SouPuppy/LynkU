import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { listCategories, type AdminCategory } from '../lib/admin-client'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Skeleton } from '../components/ui/skeleton'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption } from '../components/ui/table'
import { CategoryEditor } from './category-editor'

export function CategoriesPanel({ canEdit }: { canEdit: boolean }) {
  const [items, setItems] = useState<AdminCategory[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<AdminCategory | null>(null)
  const [creating, setCreating] = useState(false)
  useEffect(() => {
    let active = true
    setItems(null); setError(null)
    void listCategories().then(value => { if (active) setItems(value) })
      .catch(() => { if (active) setError('分类暂时无法加载，请重试。') })
    return () => { active = false }
  }, [attempt])
  return <section aria-label="分类列表" aria-busy={items === null && !error}>
    <div className="mb-4 flex items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">全部分类 · 包含停用项 · 按展示顺序排列</p>
      <div className="flex gap-2">{canEdit && <Button size="sm" disabled={items === null || items.length >= 100} onClick={() => setCreating(true)}>新增分类</Button>}<Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}><RefreshCw />刷新</Button></div>
    </div>
    <Card className="overflow-hidden py-0 shadow-none">
      {error ? <p role="alert" className="p-6 text-sm text-destructive">{error}</p>
        : items === null ? <div role="status" className="grid gap-4 p-6"><span className="sr-only">正在加载分类</span>{[0, 1, 2].map(key => <Skeleton key={key} className="h-10 w-full" />)}</div>
        : items.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">暂无分类。</p>
        : <Table><TableCaption className="pb-4">共 {items.length} 个分类</TableCaption>
          <TableHeader className="bg-muted/50"><TableRow><TableHead className="pl-5">分类</TableHead><TableHead>状态</TableHead><TableHead className="text-right">排序</TableHead><TableHead className="pr-5 text-right">内容数</TableHead>{canEdit && <TableHead><span className="sr-only">操作</span></TableHead>}</TableRow></TableHeader>
          <TableBody>{items.map(item => <TableRow key={item._id} className="h-16">
            <TableCell className="max-w-96 whitespace-normal pl-5"><span className="font-medium">{item.name}</span>{item.description && <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>}</TableCell>
            <TableCell><Badge variant={item.status === 'active' ? 'secondary' : 'outline'}>{item.status === 'active' ? '启用' : '停用'}</Badge></TableCell>
            <TableCell className="text-right tabular-nums">{item.sort_order}</TableCell><TableCell className="pr-5 text-right tabular-nums">{item.post_count.toLocaleString()}</TableCell>
            {canEdit && <TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => setSelected(item)}>编辑<span className="sr-only">{item.name}</span></Button></TableCell>}
          </TableRow>)}</TableBody>
        </Table>}
    </Card>
    {selected && <CategoryEditor key={selected._id} category={selected} onClose={() => setSelected(null)} onSaved={() => setAttempt(value => value + 1)} />}
    {creating && <CategoryEditor key="new" category={null} onClose={() => setCreating(false)} onSaved={() => setAttempt(value => value + 1)} />}
  </section>
}
