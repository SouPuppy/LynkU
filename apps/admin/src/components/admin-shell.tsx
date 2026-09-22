import logo from '../../../../assets/logo.png'
import { useState, type ReactNode, type CSSProperties } from 'react'
import { Moon, Sun, LogOut, ChevronDown, type LucideIcon } from 'lucide-react'
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarProvider, SidebarTrigger } from './ui/sidebar'
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from './ui/breadcrumb'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'
import { Button } from './ui/button'
import { Separator } from './ui/separator'

type Navigation = { id: string; label: string; icon: LucideIcon }
export function AdminShell({ items, section, title, description, onSignOut, children }: { items: readonly Navigation[]; section: string; title: string; description: string; onSignOut: () => void; children: ReactNode }) {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  function toggleTheme() {
    const next = !dark
    document.documentElement.classList.toggle('dark', next)
    setDark(next)
    try { localStorage.setItem('lynku-admin-theme', next ? 'dark' : 'light') } catch { /* Theme remains usable without storage. */ }
  }
  return <SidebarProvider style={{ '--sidebar-width': '13rem' } as CSSProperties}>
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 py-6"><a href="#overview" className="flex items-center gap-2.5"><img src={logo} alt="LynkU" className="size-8 shrink-0 rounded-lg object-contain" /><span className="group-data-[collapsible=icon]:hidden"><strong className="text-lg tracking-tight">LynkU</strong><small className="block text-[10px] tracking-widest text-muted-foreground">ADMINISTRATION</small></span></a></SidebarHeader>
      <SidebarContent>{['社区管理', '系统管理'].map((label, index) => <SidebarGroup key={label}><SidebarGroupLabel>{label}</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>{items.slice(index * 4, index * 4 + 4).map(item => <SidebarMenuItem key={item.id}><SidebarMenuButton asChild isActive={item.id === section} tooltip={item.label}><a href={`#${item.id}`} aria-current={item.id === section ? 'page' : undefined}><item.icon /><span>{item.label}</span></a></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroupContent></SidebarGroup>)}</SidebarContent>
      <SidebarFooter className="border-t p-3"><DropdownMenu><DropdownMenuTrigger asChild><SidebarMenuButton className="h-11"><span className="grid size-7 shrink-0 place-items-center rounded-full border bg-muted text-xs">A</span><span className="flex-1 text-left">管理员<small className="block text-[11px] text-muted-foreground">管理工作台</small></span><ChevronDown className="size-4" /></SidebarMenuButton></DropdownMenuTrigger><DropdownMenuContent side="top" align="start"><DropdownMenuItem onClick={onSignOut}><LogOut />退出登录</DropdownMenuItem></DropdownMenuContent></DropdownMenu></SidebarFooter>
    </Sidebar>
    <SidebarInset><header className="flex h-14 shrink-0 items-center justify-between border-b px-5"><div className="flex items-center gap-3"><SidebarTrigger /><Separator orientation="vertical" className="h-4!" /><Breadcrumb><BreadcrumbList><BreadcrumbItem>管理后台</BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{title}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb></div><Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={dark ? '切换浅色主题' : '切换深色主题'}>{dark ? <Sun /> : <Moon />}</Button></header><main className="min-w-0 flex-1 p-5 md:p-7"><div className="mb-6"><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-2 text-sm text-muted-foreground">{description}</p></div>{children}</main></SidebarInset>
  </SidebarProvider>
}
