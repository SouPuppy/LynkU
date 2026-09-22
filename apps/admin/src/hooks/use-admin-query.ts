import { useEffect, useState } from 'react'
/** Lifecycle of a read-only admin screen; stale results cannot refill an unmounted screen. */
export function useAdminQuery<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setData(null); setError(false)
    void load().then(value => { if (active) setData(value) }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [load, attempt])
  return { data, error, refresh: () => setAttempt(value => value + 1) }
}
