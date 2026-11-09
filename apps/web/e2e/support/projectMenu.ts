import { expect, type Page } from '@playwright/test'

/** The ⋯ menu at the end of the project workspace header (settings, copy, KPI toggle, archive). */
export async function openProjectMenu(page: Page) {
  const trigger = page.getByTestId('project-workspace-menu')
  await expect(trigger).toBeEnabled()
  await trigger.click()
}

/** Opens the header menu and returns one of its items by its visible name. */
export async function projectMenuItem(page: Page, name: string | RegExp) {
  await openProjectMenu(page)
  return page.getByRole('menuitem', { name })
}

export const PROJECT_SETTINGS_ITEM = 'إعدادات المشروع'
