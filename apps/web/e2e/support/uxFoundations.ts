import { expect, type Page } from '@playwright/test'
import { login, open } from './tasmim6'

export const foundationTask = { id: 101, name: 'مهمة جارية', href: '/projects/1/tasks/101' } as const
export const foundationOrigin = '/my-tasks?q=%D9%85%D9%87%D9%85%D8%A9&scope=assigned#tasks'

export async function enterFoundation(page: Page, path: string) {
  await login(page)
  await open(page, path)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
}
