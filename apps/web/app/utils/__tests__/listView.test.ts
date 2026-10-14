import { describe, expect, it } from 'vitest'
import { currentListView, listViewQuery } from '../listView'

const views = [{ value: 'table' }, { value: 'board' }]

describe('currentListView', () => {
  it.each([
    ['board', 'board'],
    [undefined, 'table'],
    ['gantt', 'table'],
    [['board', 'table'], 'board'],
    [null, 'table'],
  ] as const)('the query %o shows %s', (query, view) => {
    expect(currentListView(query, views)).toBe(view)
  })

  it('has no view without options', () => {
    expect(currentListView('board', [])).toBe('')
  })
})

describe('listViewQuery', () => {
  it('writes a non-default view and drops the key for the default, keeping every other key', () => {
    expect(listViewQuery({ q: 'alpha', offset: '25' }, 'board', views)).toEqual({ q: 'alpha', offset: '25', view: 'board' })
    expect(listViewQuery({ q: 'alpha', view: 'board' }, 'table', views)).toEqual({ q: 'alpha', view: undefined })
  })
})
