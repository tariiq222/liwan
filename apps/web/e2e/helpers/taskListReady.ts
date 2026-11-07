import { expect, type Page } from '@playwright/test'

/** SSR rows precede hydration and the KPI result; establish the settled departure page before scrolling. */
export async function waitForTaskListReady(page: Page) {
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
  await expect(page.getByTestId('task-kpi-strip').getByTestId('metric-tile')).toHaveCount(4)
}
