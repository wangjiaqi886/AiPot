import { useRef } from 'react'
import { useLocation } from 'react-router'
import { motion } from 'framer-motion'
import { useReducedMotion, springPresets } from '@/renderer/hooks'

/**
 * Config page transition: the incoming page slides in from the right
 * (x +16 → 0) with a fade, one spring (stiffness 380 / damping 32 — reads
 * as ~180 ms).
 *
 * Deliberately NOT AnimatePresence/mode="wait": a wait chain between the
 * exiting page and a lazily-loaded (Suspense) entering page dead-locks on
 * rapid navigation — the old page waits for the new one to mount, the new
 * one waits for the old one to finish exiting, and the content area stays
 * blank. The old page unmounts immediately; only the entering page is
 * animated. First render (window mount) does not animate.
 */
export default function PageTransition({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const reducedMotion = useReducedMotion()
  // First render (window mount) should not animate — only route changes do.
  const isFirstRenderRef = useRef(true)
  if (isFirstRenderRef.current) {
    isFirstRenderRef.current = false
  }
  const shouldAnimate = !isFirstRenderRef.current && !reducedMotion

  return (
    <motion.div
      key={location.pathname}
      className="min-h-full"
      initial={shouldAnimate ? { opacity: 0, x: 16 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={shouldAnimate ? springPresets.page : { duration: 0 }}
    >
      {children}
    </motion.div>
  )
}
