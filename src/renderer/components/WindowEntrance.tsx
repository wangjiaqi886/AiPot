import { useEffect } from 'react'
import { motion, useAnimationControls } from 'framer-motion'
import { onAppEvent } from '@/renderer/lib/electron/events'
import { useReducedMotion, springPresets } from '@/renderer/hooks'

interface WindowEntranceProps {
  children: React.ReactNode
}

/**
 * Window entrance animation: scale .96 → 1 with fade, one spring
 * (stiffness 420 / damping 30 — reads as ~150 ms).
 *
 * The animation REPLAYS on every `aipot://window-shown` event via an
 * animation controller, NOT by re-keying/remounting the subtree: the
 * pre-created translate window never remounts, and remounting it on every
 * show would throw away all loaded state (plugin lists, service configs,
 * listeners) and visibly flash. `controls.start()` replays in place.
 * Silenced entirely when reduced motion is on.
 */
export default function WindowEntrance({ children }: WindowEntranceProps) {
  const reducedMotion = useReducedMotion()
  const controls = useAnimationControls()

  useEffect(() => {
    if (reducedMotion) {
      return
    }
    // The main process owns showing; every show replays the entrance
    // in place — no remount, no state loss.
    return onAppEvent('aipot://window-shown', () => {
      void controls.start({ opacity: 1, scale: 1 })
    })
  }, [controls, reducedMotion])

  return (
    <motion.div
      className="h-full w-full"
      initial={reducedMotion ? false : { opacity: 0, scale: 0.96 }}
      animate={controls}
      transition={springPresets.window}
    >
      {children}
    </motion.div>
  )
}
