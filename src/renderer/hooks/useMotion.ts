import { useEffect, useState } from 'react'
import { useConfig } from './useConfig'

/**
 * Global motion preference for AiPot 1.4.
 *
 * Three sources are combined, most specific wins:
 * 1. The user's in-app "reduce motion" switch (`reduce_motion` config, default
 *    false — animations on).
 * 2. The OS-level `prefers-reduced-motion` media query (accessibility).
 * 3. Nothing else — if both are off, animations run.
 *
 * Every window/transition animation helper in the app reads this hook, so a
 * single switch (or the OS setting) silences the whole motion layer at once.
 */
export function useReducedMotion(): boolean {
  const [userPref] = useConfig<boolean>('reduce_motion', false)
  const [systemPref, setSystemPref] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return false
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return
    }
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (event: MediaQueryListEvent) => setSystemPref(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return userPref === true || systemPref === true
}

/**
 * Shared spring presets (framer-motion). One motion vocabulary for the whole
 * app so every surface moves with the same physical feel:
 * - `window`: translate window pop-in (scale .96→1 + fade, feels like ~150ms)
 * - `page`: config page slide (x +16→0 + fade, ~180ms)
 * - `modal`: modal pop (scale .96→1 + fade, ~220ms, slightly softer)
 * - `micro`: switch/button presses (very quick, slight overshoot)
 */
export const springPresets = {
  window: { type: 'spring', stiffness: 420, damping: 30, mass: 0.9 },
  page: { type: 'spring', stiffness: 380, damping: 32, mass: 1 },
  modal: { type: 'spring', stiffness: 340, damping: 28, mass: 1 },
  micro: { type: 'spring', stiffness: 500, damping: 26, mass: 0.7 },
} as const

/** Instant transition used when reduced motion is on. */
export const noMotion = { duration: 0 } as const

/**
 * Central helper: returns the spring preset for a role, or the zero-duration
 * transition when reduced motion is active. Every animation call site goes
 * through here so the reduce-motion switch is honoured uniformly.
 */
export function motionFor(
  role: keyof typeof springPresets,
  reducedMotion: boolean,
): { type: 'spring'; stiffness: number; damping: number; mass: number } | { duration: 0 } {
  if (reducedMotion) {
    return noMotion
  }
  return springPresets[role]
}
