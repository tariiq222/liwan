import { describe, expect, it } from 'vitest'
import { activeReportTab, isReportsPath, reportTabs } from '../inboxReportNav'

describe('inbox report navigation', () => {
  it('knows the reports area from the conversations', () => {
    expect(isReportsPath('/inbox/reports')).toBe(true)
    expect(isReportsPath('/inbox/reports/costs/')).toBe(true)
    expect(isReportsPath('/inbox/reports/templates/7')).toBe(true)
    expect(isReportsPath('/inbox')).toBe(false)
    expect(isReportsPath('/inbox/12')).toBe(false)
    expect(isReportsPath('/inbox/reportsx')).toBe(false)
  })

  it('lights the right tab, the template detail under templates', () => {
    expect(activeReportTab('/inbox/reports')).toBe('overview')
    expect(activeReportTab('/inbox/reports/costs')).toBe('costs')
    expect(activeReportTab('/inbox/reports/templates/9')).toBe('templates')
  })

  it('carries the period and channel between tabs but not the department or agent', () => {
    const tabs = reportTabs('/inbox/reports', { period: '7', channel_id: '1', department_id: '2', agent_id: '3' })
    expect(tabs.map(tab => tab.id)).toEqual(['overview', 'costs', 'templates'])
    expect(tabs[1]!.to).toEqual({ path: '/inbox/reports/costs', query: { period: '7', channel_id: '1' } })
    expect(tabs.filter(tab => tab.active).map(tab => tab.id)).toEqual(['overview'])
  })
})
