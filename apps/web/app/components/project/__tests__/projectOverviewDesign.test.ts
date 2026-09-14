import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const appRoot = resolve(import.meta.dirname, '../../..')
const overview = readFileSync(resolve(appRoot, 'components/project/ProjectOverview.vue'), 'utf8')
const shell = readFileSync(resolve(appRoot, 'assets/css/shell.css'), 'utf8')

describe('project overview record design', () => {
  it('is a two-column record: content main, properties + milestones aside', () => {
    expect(overview).toContain('class="nasq-record-grid"')
    expect(overview).toContain('nasq-record-main')
    expect(overview).toContain('nasq-record-aside')
    expect(overview).toMatch(/nasq-record-aside[\s\S]*?<dl class="nasq-record-props"/)
    expect(overview).toMatch(/nasq-record-aside[\s\S]*?projects\.overview\.deliveryMilestones/)
  })

  it('metric tiles are hairline surfaces with tabular figures', () => {
    expect(overview).toMatch(/nasq-ui-record-surface[^"]*p-4[\s\S]*?nasq-ui-num/)
    expect(overview).not.toContain('text-3xl')
  })

  it('has no scoped stylesheet; the record grid lives in the shared shell css', () => {
    expect(overview).not.toContain('<style')
    expect(shell).toMatch(/\.nasq-record-grid \{/)
    expect(shell).toMatch(/@media \(min-width: 1024px\)[\s\S]*?\.nasq-record-grid \{[^}]*300px/)
  })
})
