import { useNavigate, useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { IconType } from 'react-icons'
import { BsInfoSquareFill } from 'react-icons/bs'
import { PiTranslateFill } from 'react-icons/pi'
import { AiFillAppstore } from 'react-icons/ai'
import { PiTextboxFill } from 'react-icons/pi'
import { MdExtension, MdKeyboardAlt, MdMiscellaneousServices } from 'react-icons/md'
import { preloadConfigRoute } from '../../routes'

const sideBarItems: Array<{
  path: string
  label: string
  icon: IconType
}> = [
  { path: '/general', label: 'config.general.label', icon: AiFillAppstore },
  { path: '/translate', label: 'config.translate.label', icon: PiTranslateFill },
  { path: '/recognize', label: 'config.recognize.label', icon: PiTextboxFill },
  { path: '/hotkey', label: 'config.hotkey.label', icon: MdKeyboardAlt },
  { path: '/service', label: 'config.service.label', icon: MdMiscellaneousServices },
  { path: '/plugin', label: 'config.plugin.label', icon: MdExtension },
  { path: '/about', label: 'config.about.label', icon: BsInfoSquareFill },
]

/**
 * Flat first-level settings navigation (7 items), restored by user
 * feedback — the grouped icon-rail + sub-nav felt too sparse per group.
 * Keeps the 1.4 visual language: accent capsule highlight for the current
 * item, hover feedback, preload-on-intent.
 */
export default function SideBar() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <nav aria-label={t('windows.config')} className="mx-3 overflow-y-auto">
      {sideBarItems.map((item) => {
        const Icon = item.icon
        const isCurrent = location.pathname === item.path

        return (
          <button
            key={item.path}
            type="button"
            aria-current={isCurrent ? 'page' : undefined}
            className={`aipot-press mb-1 flex w-full items-center gap-2.5 rounded-medium px-2.5 py-2.5 text-medium transition-colors ${
              isCurrent
                ? 'bg-primary/13 text-primary'
                : 'text-default-600 hover:bg-default-100/60 hover:text-foreground'
            }`}
            onMouseEnter={() => preloadConfigRoute(item.path)}
            onFocus={() => preloadConfigRoute(item.path)}
            onClick={() => {
              if (location.pathname !== item.path) {
                navigate(item.path)
              }
            }}
          >
            <Icon aria-hidden="true" className="text-[21px]" />
            <span className="w-full text-left">{t(item.label)}</span>
          </button>
        )
      })}
    </nav>
  )
}
