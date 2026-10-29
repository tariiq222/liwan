import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AI_STARTER_KEYS, followUpKeys } from '../aiSuggestions'

const locale = (code: 'ar' | 'en') => JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../i18n/locales/${code}/ai.json`), 'utf8')).ai

describe('followUpKeys', () => {
  it('picks the list of the page the conversation came from', () => {
    expect(followUpKeys('project')).toContain('projectRisks')
    expect(followUpKeys('finance')).toContain('financeCash')
  })

  it('uses the project and task lists for the projects and tasks rail modules', () => {
    expect(followUpKeys('projects')).toEqual(followUpKeys('project'))
    expect(followUpKeys('tasks')).toEqual(followUpKeys('task'))
    expect(followUpKeys('tasks')).toContain('taskBlockers')
  })

  it('falls back to the generic list for no page or an unknown one', () => {
    expect(followUpKeys(null)).toEqual(['summary', 'next', 'risks'])
    expect(followUpKeys('chat')).toEqual(['summary', 'next', 'risks'])
    expect(followUpKeys('constructor')).toEqual(['summary', 'next', 'risks'])
  })
})

describe.each(['ar', 'en'] as const)('suggestion keys in %s', (code) => {
  it('every starter and follow-up key has a text', () => {
    const ai = locale(code)
    for (const key of AI_STARTER_KEYS) expect(ai.starters[key], key).toEqual(expect.any(String))
    for (const page of [null, 'project', 'projects', 'task', 'tasks', 'finance']) for (const key of followUpKeys(page)) expect(ai.followUps[key], key).toEqual(expect.any(String))
  })
})

describe('starter questions', () => {
  it('offers only questions the registered tools can answer, each translated in both locales', () => {
    expect(AI_STARTER_KEYS).not.toContain('meetings')
    for (const code of ['ar', 'en'] as const) {
      for (const key of AI_STARTER_KEYS) expect(locale(code).starters[key]).toEqual(expect.any(String))
      expect(Object.keys(locale(code).starters).filter(key => key !== 'label').sort()).toEqual([...AI_STARTER_KEYS].sort())
    }
  })
})
