import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const nav = (locale: string) => (JSON.parse(readFileSync(resolve(import.meta.dirname, `../i18n/locales/${locale}/common.json`), 'utf8')) as { nav: Record<string, string> }).nav

describe.each(['ar', 'en'])('shell navigation labels (%s)', locale => {
  const labels = nav(locale)

  it('distinguishes foundation Home from the project overview', () => {
    expect(labels.home).not.toBe(labels.projectDashboard)
  })

  it('does not label two different pages «my tasks»', () => {
    expect(labels.myTasks).not.toBe(labels.tasks)
  })

  it('gives the rail navigation groups names that differ from the rail landmark and from each other', () => {
    expect(new Set([labels.modules, labels.railApps, labels.railAdmin]).size).toBe(3)
  })
})
