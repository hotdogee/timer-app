/**
 * What the desktop app says about its self-update, in the UI language: one status line per
 * {@link DesktopUpdatePhase}. Settings › About's updates row and the update prompt both show it,
 * so they never say different things.
 */
import { m } from '../i18n'
import type { DesktopUpdates } from '../pwa.svelte'

/** The status of `updates` as a sentence (`''` before the first check); percents in `locale`. */
export function updateStatusText(
  updates: Pick<DesktopUpdates, 'phase' | 'info' | 'progress'>,
  locale: string,
): string {
  switch (updates.phase) {
    case 'idle':
      return ''
    case 'unconfigured':
      return m.about_update_unconfigured()
    case 'checking':
      return m.about_update_checking()
    case 'none':
      return m.about_update_none()
    case 'check-failed':
      return m.about_update_check_failed()
    case 'offline':
      return m.about_update_offline()
    case 'available':
      return m.about_update_available({ version: updates.info?.version ?? '' })
    case 'downloading':
      return updates.progress === null
        ? m.about_update_downloading()
        : m.about_update_downloading_percent({
            percent: new Intl.NumberFormat(locale, { style: 'percent' }).format(updates.progress),
          })
    case 'installing':
      return m.about_update_installing()
    case 'restarting':
      return m.about_update_restarting()
    case 'failed':
      return m.about_update_install_failed()
  }
}
