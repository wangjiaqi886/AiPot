import { heroui } from '@heroui/theme'

/**
 * AiPot 1.4 design tokens — "night sky" system (taste-skill dealt palette
 * blue-black-cornflower, refined). Dark: near-black blue-tinted ground with
 * a luminous cornflower accent; light: warm stone ground with the same hue
 * deepened for contrast. One radius scale (soft), consistent surfaces.
 */

// Shared accent ramp — cornflower blue (#5ab9fc dark / #1e6fd9 light).
const darkPrimary = {
  50: '#e3f2fe',
  100: '#c2e2fd',
  200: '#8fcefc',
  300: '#5ab9fc', // accent — dark mode primary
  DEFAULT: '#5ab9fc',
  400: '#43a4ee',
  500: '#2f8bd8',
  600: '#2170b4',
  700: '#18578d',
  800: '#124067',
  900: '#0c2b45',
  foreground: '#0a0d14',
}

const lightPrimary = {
  50: '#e8f2fd',
  100: '#cbe2fa',
  200: '#98c6f4',
  300: '#5aa7ec',
  400: '#2b87dd',
  500: '#1e6fd9', // accent — light mode primary
  DEFAULT: '#1e6fd9',
  600: '#1a5cb8',
  700: '#16498f',
  800: '#123768',
  900: '#0c2547',
  foreground: '#ffffff',
}

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    './node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {},
  },
  darkMode: 'class',
  plugins: [
    heroui({
      themes: {
        dark: {
          colors: {
            background: '#0a0d14',
            foreground: '#e9edf3',
            content1: '#131824',
            content2: '#1a2130',
            content3: '#232b3d',
            content4: '#2c3549',
            divider: 'rgba(233, 237, 243, 0.08)',
            focus: '#5ab9fc',
            default: {
              DEFAULT: '#8891a1',
              50: '#131824',
              100: '#1c2231',
              200: '#2a3247',
              300: '#3d4860',
              400: '#5a6580',
              500: '#8891a1',
              600: '#a3acbd',
              700: '#bdc5d3',
              800: '#d6dce7',
              900: '#e9edf3',
            },
            primary: darkPrimary,
          },
        },
        light: {
          colors: {
            background: '#f4f6f9',
            foreground: '#141922',
            content1: '#ffffff',
            content2: '#eef1f5',
            content3: '#e3e7ee',
            content4: '#d6dbe4',
            divider: 'rgba(20, 25, 34, 0.09)',
            focus: '#1e6fd9',
            default: {
              DEFAULT: '#626d80',
              50: '#eef1f5',
              100: '#dfe4ec',
              200: '#c3ccd9',
              300: '#a3aec1',
              400: '#7d8aa1',
              500: '#626d80',
              600: '#4d566b',
              700: '#3a4152',
              800: '#282e3c',
              900: '#141922',
            },
            primary: lightPrimary,
          },
        },
      },
    }),
  ],
}
