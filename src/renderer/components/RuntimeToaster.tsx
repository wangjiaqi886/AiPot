import { semanticColors } from '@heroui/theme'
import { useTheme } from 'next-themes'
import { Toaster } from 'react-hot-toast'

type ToastPalette = {
  content1: { DEFAULT: string }
  foreground: { DEFAULT: string }
}

export default function RuntimeToaster() {
  const { theme } = useTheme()
  const palette = (theme === 'dark' ? semanticColors.dark : semanticColors.light) as ToastPalette

  return (
    <Toaster
      position="bottom-center"
      gutter={8}
      toastOptions={{
        style: {
          background: palette.content1.DEFAULT,
          color: palette.foreground.DEFAULT,
          maxWidth: 'min(520px, calc(100vw - 32px))',
          padding: '10px 14px',
          borderRadius: '12px',
          border: '1px solid color-mix(in srgb, currentColor 8%, transparent)',
          boxShadow: '0 8px 24px -8px rgba(0, 0, 0, 0.35)',
          wordBreak: 'normal',
          overflowWrap: 'break-word',
          // Slide up + fade (bottom-center), consistent with the app's spring
          // motion system; react-hot-toast animates via these transition keys.
          animation: 'aipot-toast-in 0.2s cubic-bezier(0.34, 1.2, 0.5, 1)',
        },
        error: {
          duration: 5000,
        },
      }}
    />
  )
}
