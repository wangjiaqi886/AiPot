export const info = {
  name: 'openai_compatible',
  icon: 'logo/openai.svg',
}

export const Language = {
  auto: 'Auto',
  zh_cn: 'Simplified Chinese',
  zh_tw: 'Traditional Chinese',
  yue: 'Cantonese',
  ja: 'Japanese',
  en: 'English',
  ko: 'Korean',
  fr: 'French',
  es: 'Spanish',
  ru: 'Russian',
  de: 'German',
  it: 'Italian',
  tr: 'Turkish',
  pt_pt: 'Portuguese',
  pt_br: 'Brazilian Portuguese',
  vi: 'Vietnamese',
  id: 'Indonesian',
  th: 'Thai',
  ms: 'Malay',
  ar: 'Arabic',
  hi: 'Hindi',
  km: 'Khmer',
  fa: 'Persian',
  sv: 'Swedish',
  pl: 'Polish',
  nl: 'Dutch',
  uk: 'Ukrainian',
  he: 'Hebrew',
} as const

export type Language = (typeof Language)[keyof typeof Language]
