import { describe, expect, it } from 'vitest'
import { DEFAULT_TASK_COLUMNS, parseTaskColumns, TASK_COLUMN_IDS, taskColumnOptions, toggleTaskColumn, visibleTaskColumns } from '../taskColumns'

describe('task table columns', () => {
  it('starts without the record number and the stage, and with the assignee', () => {
    expect(DEFAULT_TASK_COLUMNS).not.toContain('record_number')
    expect(DEFAULT_TASK_COLUMNS).not.toContain('stage')
    expect(DEFAULT_TASK_COLUMNS).toContain('assignees')
    expect(parseTaskColumns(undefined)).toEqual([...DEFAULT_TASK_COLUMNS])
    expect(parseTaskColumns(null)).toEqual([...DEFAULT_TASK_COLUMNS])
  })

  it('reads a cookie as the known columns in reading order, dropping anything else', () => {
    expect(parseTaskColumns('deadline,record_number,bogus,state')).toEqual(['record_number', 'state', 'deadline'])
    expect(parseTaskColumns('')).toEqual([])
  })

  it('offers a project list the stage but not the project, and the all-projects list both', () => {
    expect(taskColumnOptions('project')).toEqual(['record_number', 'stage', 'state', 'priority', 'deadline', 'assignees'])
    expect(taskColumnOptions('mine')).toEqual([...TASK_COLUMN_IDS])
  })

  it('draws only the columns the variant has and the person chose', () => {
    expect(visibleTaskColumns('project', [...DEFAULT_TASK_COLUMNS])).toEqual(['state', 'priority', 'deadline', 'assignees'])
    expect(visibleTaskColumns('mine', [...DEFAULT_TASK_COLUMNS])).toEqual(['project', 'state', 'priority', 'deadline', 'assignees'])
    expect(visibleTaskColumns('project', ['stage', 'record_number', 'project'])).toEqual(['record_number', 'stage'])
  })

  it('turns one column on or off without touching the rest', () => {
    const shown = toggleTaskColumn(DEFAULT_TASK_COLUMNS, 'stage', true)
    expect(shown).toEqual(['project', 'stage', 'state', 'priority', 'deadline', 'assignees'])
    expect(toggleTaskColumn(shown, 'stage', false)).toEqual([...DEFAULT_TASK_COLUMNS])
    expect(toggleTaskColumn(shown, 'state', true)).toEqual(shown)
  })

  it('survives a round trip through the cookie text', () => {
    const chosen = toggleTaskColumn(DEFAULT_TASK_COLUMNS, 'record_number', true)
    expect(parseTaskColumns(chosen.join(','))).toEqual(chosen)
    expect(parseTaskColumns([].join(','))).toEqual([])
  })
})
