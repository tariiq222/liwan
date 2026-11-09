import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type NavMessages = { nav: Record<string, string> }
const read = (path: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, path), 'utf8')) as NavMessages
// The shell labels live in the ui layer; i18n merges them with the app's own nav keys.
const nav = (locale: string) => ({
  ...read(`../../../packages/ui/i18n/locales/${locale}/ui.json`).nav,
  ...read(`../i18n/locales/${locale}/common.json`).nav,
})

describe.each(['ar', 'en'])('shell navigation labels (%s)', locale => {
  const labels = nav(locale)

  it('distinguishes foundation Home from the project overview', () => {
    expect(labels.home).not.toBe(labels.projectDashboard)
  })

  it('does not label two different pages «my tasks»', () => {
    expect(labels.myTasks).not.toBe(labels.tasks)
  })

})
