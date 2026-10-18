/**
 * The desktop-only parts of the app stay out of the web (spec › Settings › Desktop, Sync › Desktop
 * sign-in): no Desktop section in Settings, no updates row in About, and the account signs in
 * with an emailed code rather than the desktop's device code. The desktop app's side is checked by
 * the desktop smoke test (`pnpm smoke:desktop`).
 */
import { expect, openApp, openSettings, test } from './support'

test('the web settings have no Desktop section, no updates row and no device sign-in', async ({
  page,
}) => {
  await openApp(page)
  const dialog = await openSettings(page)
  const tabs = dialog.getByRole('tab')
  await expect(tabs).toHaveText([
    'Appearance',
    'Behavior',
    'Keyboard',
    'Presets',
    'Data',
    'Account',
    'About',
  ])
  await expect(dialog.getByText('Launch at login')).toHaveCount(0)

  await dialog.getByRole('tab', { name: 'About', exact: true }).click()
  await expect(dialog.getByText('Web', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Updates', { exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Check for updates' })).toHaveCount(0)

  await dialog.getByRole('tab', { name: 'Account', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: 'Email' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Sign in with your browser' })).toHaveCount(0)
})
