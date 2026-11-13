// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  hide: vi.fn(),
  listeners: new Map<string, Set<() => void>>(),
  setAlwaysOnTop: vi.fn(),
  unsubscribe: vi.fn(),
}))

vi.mock('@/renderer/lib/electron/events', () => ({
  onAppEvent: (event: string, callback: () => void) => {
    const listeners = mocks.listeners.get(event) ?? new Set()
    listeners.add(callback)
    mocks.listeners.set(event, listeners)

    return () => {
      mocks.unsubscribe(event)
      listeners.delete(callback)
    }
  },
}))

vi.mock('@/renderer/lib/electron/window', () => ({
  getCurrentWindow: () => ({
    close: mocks.close,
    hide: mocks.hide,
    setAlwaysOnTop: mocks.setAlwaysOnTop,
  }),
}))

vi.mock('@/renderer/components/windowChrome', () => ({
  PIN_ICON_CLASS: 'pin-icon',
}))

import { useCloseOnBlur } from '../../src/renderer/components/WindowPinning'

function emit(event: string) {
  for (const listener of mocks.listeners.get(event) ?? []) {
    listener()
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.listeners.clear()
  mocks.close.mockResolvedValue(undefined)
  mocks.hide.mockResolvedValue(undefined)
  mocks.setAlwaysOnTop.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useCloseOnBlur', () => {
  it('closes after the configured blur delay and cancels a pending close on focus', () => {
    renderHook(() => useCloseOnBlur({ enabled: true, delayMs: 100 }))

    act(() => emit('aipot://blur'))
    act(() => vi.advanceTimersByTime(99))
    expect(mocks.hide).not.toHaveBeenCalled()

    act(() => emit('aipot://focus'))
    act(() => vi.advanceTimersByTime(1))
    expect(mocks.hide).not.toHaveBeenCalled()

    act(() => emit('aipot://blur'))
    act(() => vi.advanceTimersByTime(100))
    expect(mocks.hide).toHaveBeenCalledTimes(1)
  })

  it('keeps pinned windows open and skips the blur caused by minimizing', async () => {
    const { result } = renderHook(() => useCloseOnBlur({ enabled: true, delayMs: 50 }))

    await act(() => result.current.togglePinned())
    expect(mocks.setAlwaysOnTop).toHaveBeenCalledWith(true)

    act(() => emit('aipot://blur'))
    act(() => vi.advanceTimersByTime(50))
    expect(mocks.hide).not.toHaveBeenCalled()

    await act(() => result.current.togglePinned())
    expect(mocks.setAlwaysOnTop).toHaveBeenLastCalledWith(false)

    act(() => {
      emit('aipot://minimize')
      emit('aipot://blur')
      vi.advanceTimersByTime(50)
    })
    expect(mocks.hide).not.toHaveBeenCalled()

    act(() => emit('aipot://blur'))
    act(() => vi.advanceTimersByTime(50))
    expect(mocks.hide).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes every window event listener on unmount', () => {
    const { unmount } = renderHook(() => useCloseOnBlur({ enabled: true, delayMs: 50 }))

    unmount()

    expect(mocks.unsubscribe).toHaveBeenCalledTimes(4)
    expect([...mocks.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true)
  })
})
