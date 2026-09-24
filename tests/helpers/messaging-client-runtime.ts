import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { createRequire } from 'node:module'

type Row = Record<string, unknown>
type Request = { name: string; data: Row }
type Response = { result: { data: unknown } }
type Visible = { dataset: { id: string }; intersectionRatio: number }
const requireDependency = createRequire(path.join(process.cwd(), 'package.json'))

export function messagingRuntime() {
  const storage = new Map<string, unknown>(), timers = new Map<number, () => Promise<void>>()
  const observers: { selector: string; active: boolean; callback: (event: Visible) => void }[] = []
  const badgeWrites: string[] = []
  let page: Row = {}, nextTimer = 0
  const app = { globalData: { user: null, openid: null } }
  const wx = {
    getStorageSync: (key: string) => storage.get(key), setStorageSync: (key: string, value: unknown) => { storage.set(key, value) },
    removeStorageSync: (key: string) => { storage.delete(key) }, nextTick: (work: () => void) => work(),
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    setTabBarBadge: (value: { text: string }) => { badgeWrites.push(value.text) }, removeTabBarBadge: () => { badgeWrites.push('0') },
    setTabBarStyle: () => {}, showToast: () => {}, showModal: async () => ({ confirm: false }),
    cloud: { callFunction: async (_request: Request): Promise<Response> => { throw Error('Unexpected cloud request') } },
  }
  const modules = new Map<string, { exports: Row }>()
  function load<T>(relative: string): T {
    const filename = path.resolve(relative), known = modules.get(filename)
    if (known) return known.exports as T
    const module = { exports: {} }
    modules.set(filename, module)
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
    vm.runInNewContext(code, { wx, console, getApp: () => app, getCurrentPages: () => [],
      setTimeout, clearTimeout,
      setInterval: (callback: () => Promise<void>) => { timers.set(++nextTimer, callback); return nextTimer },
      clearInterval: (id: number) => { timers.delete(id) },
      Page: (value: Row) => {
        page = value
        page.setData = (change: Row) => Object.assign(page.data as Row, change)
        page.createIntersectionObserver = () => {
          let tracked: typeof observers[number] | undefined
          return { relativeTo() { return this }, observe(selector: string, callback: (event: Visible) => void) {
            tracked = { selector, callback, active: true }; observers.push(tracked)
          }, disconnect() { if (tracked) tracked.active = false } }
        }
      }, module, exports: module.exports,
      require: (specifier: string): unknown => {
        if (!specifier.startsWith('.')) return requireDependency(specifier)
        const base = path.resolve(path.dirname(filename), specifier)
        const found = [base + '.ts', base + '.js'].find(existsSync)
        if (!found) throw Error(`Missing client file ${specifier}`)
        return load(found)
      },
    }, { filename })
    return module.exports as T
  }
  return { wx, load, storage, timers, badgeWrites, page: <T>() => page as T,
    see: (selector: string, id: string) => {
      for (const observer of observers.filter(item => item.active && item.selector === selector)) observer.callback({ dataset: { id }, intersectionRatio: 1 })
    } }
}
