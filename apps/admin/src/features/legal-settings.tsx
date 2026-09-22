import { useEffect, useState } from 'react'
import { legalDocumentKind, type LegalDocumentKind } from '@lynku/contracts'
import { legalPolicies } from '../generated/legal-policies'
import { readLegalManifest } from '../lib/admin-client'
import { useAdminQuery } from '../hooks/use-admin-query'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../components/ui/sheet'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../components/ui/table'

const kinds: LegalDocumentKind[] = ['terms', 'privacy', 'rules', 'about']
const selectedDocument = () => legalDocumentKind(new URLSearchParams(location.hash.split('?')[1] || '').get('document'))
export function LegalSettings() {
  const { data, error, refresh } = useAdminQuery(readLegalManifest)
  const [selected, select] = useState(selectedDocument)
  useEffect(() => {
    const update = () => select(selectedDocument())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  const document = selected ? legalPolicies.documents[selected] : null
  return <Card className="shadow-none lg:col-span-2">
    <CardHeader className="flex-row items-center justify-between gap-3"><CardTitle>规则与协议</CardTitle><Button variant="outline" size="sm" onClick={refresh}>核对服务版本</Button></CardHeader>
    <CardContent className="space-y-4">
      <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">公开联系邮箱</dt><dd>{legalPolicies.supportEmail}</dd></div><div><dt className="text-muted-foreground">备案展示</dt><dd>{legalPolicies.filingNumberVerified ? legalPolicies.filingNumber : '后台字符串待核对，当前公开文案未展示'}</dd></div></dl>
      {error && <p role="alert" className="text-sm text-destructive">无法读取管理服务版本，不能确认一致性。可重试；下方仍可阅读本网页构建中的文案。</p>}
      <Table><TableHeader><TableRow><TableHead>文档</TableHead><TableHead>网页版本</TableHead><TableHead>生效日期</TableHead><TableHead>与管理服务对照</TableHead><TableHead className="text-right">正文</TableHead></TableRow></TableHeader><TableBody>{kinds.map(kind => {
        const local = legalPolicies.documents[kind], remote = data?.[kind]
        const matching = remote && local.hash === remote.hash && local.version === remote.version && local.status === remote.status && local.effectiveAt === remote.effectiveAt
        return <TableRow key={kind}><TableCell>{local.title}</TableCell><TableCell>{local.version} <Badge variant="secondary">{local.status === 'active' ? '生效配置' : '草稿'}</Badge></TableCell><TableCell>{local.effectiveAt || '未设置'}</TableCell><TableCell>{remote ? <Badge variant={matching ? 'secondary' : 'destructive'}>{matching ? '一致' : '版本不一致'}</Badge> : error ? '无法核对' : '正在读取…'}</TableCell><TableCell className="text-right"><Button variant="ghost" size="sm" asChild><a href={`#settings?document=${kind}`}>查看正文</a></Button></TableCell></TableRow>
      })}</TableBody></Table>
      <p className="text-xs leading-6 text-muted-foreground">正文由项目统一文案生成，只读。版本对照仅核对当前网页与管理云函数，不代表身份云函数、小程序客户端已同步，也不代表已通过微信审核。变更须通过现有构建与部署流程发布。</p>
    </CardContent>
    {document && <Sheet open onOpenChange={open => { if (!open) location.hash = 'settings' }}><SheetContent className="overflow-y-auto sm:max-w-2xl"><SheetHeader><SheetTitle>{document.title}</SheetTitle><SheetDescription>网页构建文案 · 版本 {document.version} · 更新 {document.updatedAt || '未设置'}</SheetDescription></SheetHeader><article className="space-y-6 px-4 pb-8 text-sm leading-7">{document.sections.map(section => <section key={section.id}><h3 className="mb-2 font-semibold">{section.heading}</h3>{section.paragraphs.map((paragraph, index) => <p key={index} className="mb-2 whitespace-pre-wrap">{paragraph}</p>)}</section>)}<p className="break-all text-xs text-muted-foreground">正文摘要：{document.hash}</p></article></SheetContent></Sheet>}
  </Card>
}
