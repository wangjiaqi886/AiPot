import { useEffect, useState, useRef } from 'react'
import { getCurrentWindow } from '@/renderer/lib/electron/window'
import { invokeCommand } from '@/renderer/lib/electron/command'
import { onAppEvent } from '@/renderer/lib/electron/events'
import { logger } from '@/renderer/lib/logger'
import { calculateCropRect } from './selection'
const appWindow = getCurrentWindow()

/**
 * Transparent overlay for direct-on-screen region capture (QQ-screenshot
 * style). The window covers the display and is fully transparent; the user
 * drags a rectangle directly over the real screen. On mouse-up the main
 * process re-captures the screen and crops to the dragged rectangle.
 */
export default function Screenshot() {
  const [error, setError] = useState('')
  const [action, setAction] = useState<'recognize' | 'translate'>('recognize')
  const [isMoved, setIsMoved] = useState(false)
  const [isDown, setIsDown] = useState(false)
  const [mouseDownX, setMouseDownX] = useState(0)
  const [mouseDownY, setMouseDownY] = useState(0)
  const [mouseMoveX, setMouseMoveX] = useState(0)
  const [mouseMoveY, setMouseMoveY] = useState(0)
  const readyRef = useRef(false)

  useEffect(() => {
    const unlisten = onAppEvent('capture_screenshot', (payload) => {
      if (payload === 'translate' || payload === 'recognize') {
        setAction(payload)
      }
      if (readyRef.current) {
        return
      }
      readyRef.current = true
      // The overlay is transparent; show it as soon as the renderer is ready
      // so the user drags directly over the live screen.
      void appWindow.show()
      void appWindow.setFocus()
      void appWindow.setResizable(false)
    })
    void window.aiPot.app.rendererReady()

    return unlisten
  }, [])

  return (
    <>
      {error && (
        <div className="fixed inset-0 z-20 bg-background p-4 text-sm text-danger">{error}</div>
      )}
      <div
        className={`fixed bg-[#2080f020] border border-solid border-sky-500 ${
          isMoved ? '' : 'hidden'
        }`}
        style={{
          top: Math.min(mouseDownY, mouseMoveY),
          left: Math.min(mouseDownX, mouseMoveX),
          bottom: window.innerHeight - Math.max(mouseDownY, mouseMoveY),
          right: window.innerWidth - Math.max(mouseDownX, mouseMoveX),
        }}
      />
      <div
        className="fixed top-0 left-0 bottom-0 right-0 cursor-crosshair select-none"
        onMouseDown={(e) => {
          if (e.buttons === 1) {
            setIsDown(true)
            setMouseDownX(e.clientX)
            setMouseDownY(e.clientY)
            setMouseMoveX(e.clientX)
            setMouseMoveY(e.clientY)
          } else {
            void appWindow.close()
          }
        }}
        onMouseMove={(e) => {
          if (isDown) {
            setIsMoved(true)
            setMouseMoveX(e.clientX)
            setMouseMoveY(e.clientY)
          }
        }}
        onMouseUp={async (e) => {
          const monitor = await appWindow.getDisplay()
          const viewportScale = monitor.size.width / window.innerWidth
          logger.debug('Screenshot selection ended.', {
            clientX: e.clientX,
            clientY: e.clientY,
            mouseDownX,
            mouseDownY,
            monitorWidth: monitor.size.width,
            windowWidth: window.innerWidth,
            viewportScale,
            isMoved,
          })
          appWindow
            .hide()
            .then(async () => {
              setIsDown(false)
              setIsMoved(false)
              const cropRect = calculateCropRect(
                { x: mouseDownX, y: mouseDownY },
                { x: e.clientX, y: e.clientY },
                window.innerWidth,
                monitor.size.width,
              )
              if (!cropRect) {
                logger.warn('Screenshot area is too small.', {
                  viewportWidth: window.innerWidth,
                  monitorWidth: monitor.size.width,
                })
                await appWindow.close()
                return
              }

              try {
                // Direct-on-screen capture: take a fresh screenshot of the live
                // screen at release time, then crop to the dragged rectangle.
                // The overlay is hidden before this runs, so it never appears
                // in the result.
                await invokeCommand('screenshot', {
                  x: monitor.position.x,
                  y: monitor.position.y,
                })
                await invokeCommand('cut_image', {
                  left: cropRect.left,
                  top: cropRect.top,
                  width: cropRect.width,
                  height: cropRect.height,
                })
                await invokeCommand('screenshot_complete', { action })
                await appWindow.close()
              } catch (captureError) {
                logger.error('Screenshot completion failed.', captureError, {
                  action,
                })
                setError(String(captureError))
                await appWindow.show()
                await appWindow.setFocus()
              }
            })
            .catch((hideError) => {
              logger.error('Screenshot overlay hide failed.', hideError)
              void appWindow.close()
            })
        }}
      />
    </>
  )
}
