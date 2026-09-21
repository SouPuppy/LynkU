// utils/util.ts — shared helpers
// ponytail: add date-fns/moment only if these grow unwieldy
// ponytail: no LoadState Behavior — Page() doesn't support behaviors, and
// converting 12 pages to Component() is riskier than 3 lines of setData each.
// Revisit if WeChat adds Page.behaviors support.

export function formatTime(date: Date | string | number): string {
  const d = new Date(date)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const min = 60 * 1000
  const hour = 60 * min
  const day = 24 * hour

  if (diff < min) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / min)}分钟前`
  if (diff < day) return `${Math.floor(diff / hour)}小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)}天前`

  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

type Callable = (this: unknown, ...args: never[]) => unknown

export type DebouncedFunction<T extends Callable> = ((...args: Parameters<T>) => void) & {
  cancel: () => void
}

export function debounce<T extends Callable>(
  fn: T,
  delay: number = 300
): DebouncedFunction<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const debounced = function (this: ThisParameterType<T>, ...args: Parameters<T>) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn.apply(this, args)
    }, delay)
  } as DebouncedFunction<T>
  debounced.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  return debounced
}

export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '...'
}

/** Stable enough for one client-side mutation attempt; retain it across retries. */
export function createRequestId(): string {
  const random = Math.random().toString(36).slice(2, 14)
  return `req_${Date.now().toString(36)}_${random}`
}
