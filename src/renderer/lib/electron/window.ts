interface CurrentWindow {
  close(): Promise<void>
  hide(): Promise<void>
  show(): Promise<void>
  setFocus(_focus?: boolean): Promise<void>
  setAlwaysOnTop(_alwaysOnTop: boolean): Promise<void>
  setResizable(_resizable: boolean): Promise<void>
  setSize(_size: { width: number; height: number }): Promise<void>
  setPosition(_position: { x: number; y: number }): Promise<void>
  outerPosition(): Promise<{ x: number; y: number }>
  outerSize(): Promise<{ width: number; height: number }>
  isMaximized(): Promise<boolean>
  minimize(): Promise<void>
  maximize(): Promise<void>
  unmaximize(): Promise<void>
  getDisplay(): Promise<{
    id: number
    position: { x: number; y: number }
    size: { width: number; height: number }
    scaleFactor: number
  }>
}

export function getCurrentWindow(): CurrentWindow {
  return {
    close: () => window.aiPot.app.closeCurrentWindow(),
    hide: () => window.aiPot.app.hideCurrentWindow(),
    show: () => window.aiPot.app.showCurrentWindow(),
    setFocus: () => window.aiPot.app.focusCurrentWindow(),
    setAlwaysOnTop: (alwaysOnTop) => window.aiPot.app.setCurrentWindowAlwaysOnTop(alwaysOnTop),
    setResizable: (resizable) => window.aiPot.app.setCurrentWindowResizable(resizable),
    setSize: ({ width, height }) => window.aiPot.app.setCurrentWindowBounds({ width, height }),
    setPosition: ({ x, y }) => window.aiPot.app.setCurrentWindowBounds({ x, y }),
    outerPosition: async () => {
      const bounds = await window.aiPot.app.getCurrentWindowBounds()
      return {
        x: bounds.x,
        y: bounds.y,
      }
    },
    outerSize: async () => {
      const bounds = await window.aiPot.app.getCurrentWindowBounds()
      return {
        width: bounds.width,
        height: bounds.height,
      }
    },
    isMaximized: () => window.aiPot.app.isCurrentWindowMaximized(),
    minimize: () => window.aiPot.app.minimizeCurrentWindow(),
    maximize: () => window.aiPot.app.maximizeCurrentWindow(),
    unmaximize: () => window.aiPot.app.unmaximizeCurrentWindow(),
    getDisplay: () => window.aiPot.app.getCurrentDisplay(),
  }
}
