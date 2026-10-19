import { describe, expect, it } from 'vitest'
import { myTaskKpiTiles } from '../myTaskKpi'

const t = (key: string, named?: Record<string, unknown>) => named ? `${key}:${named.percent}` : key

describe('myTaskKpiTiles', () => {
  it('builds the four tiles with shares of the total and the completion share on the total tile', () => {
    const tiles = myTaskKpiTiles({ total: 8, open: 4, overdue: 2, done: 2 }, t)
    expect(tiles.map(tile => [tile.id, tile.value, tile.progress])).toEqual([['total', 8, 25], ['open', 4, 50], ['overdue', 2, 25], ['done', 2, 25]])
    expect(tiles[0]!.hint).toBe('myTasks.kpi.percentDone:25')
    expect(tiles[1]!.hint).toBe('myTasks.kpi.percentOfTotal:50')
  })

  it('shows counts only for an empty selection and links just the open tile', () => {
    const tiles = myTaskKpiTiles({ total: 0, open: 0, overdue: 0, done: 0 }, t, '/my-tasks?scope=created')
    expect(tiles.every(tile => tile.progress === undefined && tile.hint === undefined)).toBe(true)
    expect(tiles.filter(tile => tile.to).map(tile => [tile.id, tile.to])).toEqual([['open', '/my-tasks?scope=created']])
  })
})
