import { useState, useCallback } from 'react'

export function useLocalStorage(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored ? JSON.parse(stored) : initial
    } catch {
      return initial
    }
  })

  const set = useCallback((v) => {
    setValue(prev => {
      const next = typeof v === 'function' ? v(prev) : v
      localStorage.setItem(key, JSON.stringify(next))
      return next
    })
  }, [key])

  return [value, set]
}
