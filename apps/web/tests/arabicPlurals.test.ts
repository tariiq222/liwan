import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import { pluralRules } from '../i18n/pluralRules'

const localesDir = join(__dirname, '../i18n/locales')

function load(locale: 'ar' | 'en'): Record<string, unknown> {
  const merged: Record<string, unknown> = {}
  for (const file of readdirSync(join(localesDir, locale)).filter(f => f.endsWith('.json'))) {
    Object.assign(merged, JSON.parse(readFileSync(join(localesDir, locale, file), 'utf8')))
  }
  return merged
}

const messages = { ar: load('ar'), en: load('en') }
const i18n = createI18n({ legacy: false, locale: 'ar', fallbackLocale: 'ar', messages: messages as never, pluralRules })
const t = (key: string, n: number, named: Record<string, unknown> = {}) =>
  i18n.global.t(key, { count: n, n, ...named }, n)

function leaves(node: unknown, path = ''): Array<[string, string]> {
  if (typeof node === 'string') return [[path, node]]
  if (!node || typeof node !== 'object') return []
  return Object.entries(node).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k))
}

describe('Arabic plural forms', () => {
  it('renders zero, one, two, few, many and other forms for tasks', () => {
    const key = 'myTasks.list.total'
    expect(t(key, 0)).toBe('لا مهام')
    expect(t(key, 1)).toBe('مهمة واحدة')
    expect(t(key, 2)).toBe('مهمتان')
    expect(t(key, 3)).toBe('3 مهام')
    expect(t(key, 10)).toBe('10 مهام')
    expect(t(key, 11)).toBe('11 مهمة')
    expect(t(key, 99)).toBe('99 مهمة')
    expect(t(key, 100)).toBe('100 مهمة')
    expect(t(key, 103)).toBe('103 مهام')
    expect(t(key, 111)).toBe('111 مهمة')
  })

  it('renders days with the right noun form', () => {
    const key = 'tasks.deadline.inDays'
    expect(t(key, 1)).toBe('متبقي يوم واحد')
    expect(t(key, 2)).toBe('متبقي يومان')
    expect(t(key, 5)).toBe('متبقي 5 أيام')
    expect(t(key, 120)).toBe('متبقي 120 يومًا')
    expect(t(key, 100)).toBe('متبقي 100 يوم')
    expect(t('tasks.deadline.overdueDays', 1)).toBe('تجاوز يومًا واحدًا')
    expect(t('tasks.deadline.overdueDays', 2)).toBe('تجاوز يومين')
    expect(t('tasks.deadline.overdueDays', 11)).toBe('تجاوز 11 يومًا')
  })

  it('renders recommendations and combined phrases', () => {
    expect(t('meetingsUi.openCount', 1)).toBe('توصية مفتوحة واحدة')
    expect(t('meetingsUi.openCount', 4)).toBe('4 توصيات مفتوحة')
    expect(t('projects.progressOf', 3, { closed: 1, total: 3 })).toBe('1 من 3 مهام')
    expect(t('projects.progressOf', 2, { closed: 1, total: 2 })).toBe('1 من مهمتين')
  })

  it('keeps English singular and plural', () => {
    const en = createI18n({ legacy: false, locale: 'en', messages: messages as never })
    expect(en.global.t('myTasks.list.total', { count: 1 }, 1)).toBe('1 task')
    expect(en.global.t('myTasks.list.total', { count: 0 }, 0)).toBe('0 tasks')
    expect(en.global.t('myTasks.list.total', { count: 5 }, 5)).toBe('5 tasks')
  })

  it('keeps legacy three-form messages working', () => {
    const legacy = createI18n({ legacy: false, locale: 'ar', messages: { ar: { m: 'صفر | واحد | {n} كثير' } }, pluralRules })
    expect(legacy.global.t('m', { n: 0 }, 0)).toBe('صفر')
    expect(legacy.global.t('m', { n: 1 }, 1)).toBe('واحد')
    expect(legacy.global.t('m', { n: 7 }, 7)).toBe('7 كثير')
  })

  it('ships six forms for every Arabic plural message and two for English', () => {
    const badAr = leaves(messages.ar).filter(([, v]) => v.includes(' | ') && v.split(' | ').length !== 6).map(([k]) => k)
    expect(badAr).toEqual([])
    const arPlural = new Set(leaves(messages.ar).filter(([, v]) => v.includes(' | ')).map(([k]) => k))
    const enPlural = new Set(leaves(messages.en).filter(([, v]) => v.includes(' | ')).map(([k]) => k))
    expect([...arPlural].sort()).toEqual([...enPlural].sort())
    const badEn = leaves(messages.en).filter(([k, v]) => enPlural.has(k) && v.split(' | ').length !== 2).map(([k]) => k)
    expect(badEn).toEqual([])
  })
})
