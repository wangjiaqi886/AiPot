import { useLocation, useRoutes } from 'react-router'
import { Suspense, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import ErrorBoundary from '../../components/ErrorBoundary'
import WindowControl from '../../components/WindowControl'
import SideBar from './components/SideBar'
import PageTransition from './components/PageTransition'
import { osType } from '@/renderer/lib/config/env'
import {
  DragRegion,
  LINUX_LEFT_WINDOW_FRAME_CLASS,
  LINUX_RIGHT_WINDOW_FRAME_CLASS,
  WINDOW_TOPBAR_HEIGHT_CLASS,
} from '@/renderer/components/windowChrome'
import routes from './routes'
import './style.css'

export default function Config() {
  const { t } = useTranslation()
  const location = useLocation()
  const page = useRoutes(routes)
  const pageTitleKey = location.pathname === '/' ? 'general' : location.pathname.slice(1)

  useEffect(() => {
    void window.aiPot.app.rendererReady()
  }, [])

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <div
        className={`h-screen w-57.5 shrink-0 bg-content1 ${LINUX_LEFT_WINDOW_FRAME_CLASS} border-r-1 border-divider select-none`}
      >
        <div className={`${WINDOW_TOPBAR_HEIGHT_CLASS} p-1.25`}>
          <DragRegion className="h-full w-full" />
        </div>
        <div className="p-1.25">
          <DragRegion>
            <img
              alt={t('accessibility.app_logo')}
              src="icon.svg"
              className="m-auto h-15 w-15 mb-7.5"
              draggable={false}
            />
          </DragRegion>
        </div>
        <SideBar />
      </div>
      <div
        className={`flex h-screen min-w-0 flex-1 flex-col bg-background ${LINUX_RIGHT_WINDOW_FRAME_CLASS} select-none`}
      >
        {/* The topbar itself is the drag region: -webkit-app-region: drag is
            hit-tested in the compositor and swallows every mouse event in its
            area regardless of z-index, so an overlaying drag layer would make
            the window controls unclickable. Making the topbar the drag element
            (like the translate window's topbar) keeps it draggable while the
            no-drag button descendants stay clickable. */}
        <DragRegion
          className={`${WINDOW_TOPBAR_HEIGHT_CLASS} flex shrink-0 items-center justify-between px-1.25`}
        >
          <h2 className="ml-1.25 cursor-default">{t(`config.${pageTitleKey}.title`)}</h2>
          <div className="flex">{osType !== 'Darwin' && <WindowControl />}</div>
        </DragRegion>
        <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
          <ErrorBoundary fallbackTitle={t('errors.config_page_render_failed')}>
            <Suspense fallback={null}>
              <PageTransition>
                {page ?? (
                  <div className="rounded-medium border border-warning/30 bg-warning/10 p-4 text-sm text-warning-700">
                    {t('errors.config_route_missing', { route: location.pathname })}
                  </div>
                )}
              </PageTransition>
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    </div>
  )
}
