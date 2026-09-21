import { useEffect, useState } from 'react'
// matchMedia as a hook; degrades to `fallback` when the environment lacks it (jsdom)
export function useMedia(query, fallback = false) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : fallback)
  const [m, setM] = useState(get)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(query)
    const on = () => setM(mq.matches)
    on()
    if (mq.addEventListener) { mq.addEventListener('change', on); return () => mq.removeEventListener('change', on) }
    mq.addListener(on) // legacy Safari
    return () => mq.removeListener(on)
  }, [query])
  return m
}
