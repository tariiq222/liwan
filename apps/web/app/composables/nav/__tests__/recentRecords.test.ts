import { describe, expect, it } from 'vitest'
import { RECENT_RECORDS_MAX, recentRecordsOwner, rememberRecentRecord, savedRecentRecords } from '../recentRecords'

describe('recently opened records', () => {
  it('moves a record to the front without repeating it and keeps the newest few', () => {
    let items = [] as ReturnType<typeof rememberRecentRecord>
    for (let id = 1; id <= RECENT_RECORDS_MAX + 2; id++) items = rememberRecentRecord(items, { id, name: `P${id}` })
    expect(items.map(item => item.id)).toEqual([7, 6, 5, 4, 3])
    expect(rememberRecentRecord(items, { id: 4, name: 'Renamed' }).map(item => [item.id, item.name])).toEqual([[4, 'Renamed'], [7, 'P7'], [6, 'P6'], [5, 'P5'], [3, 'P3']])
  })

  it('cuts a long name so the cookie stays small', () => {
    expect(rememberRecentRecord([], { id: 1, name: 'ا'.repeat(100) })[0]!.name).toHaveLength(40)
  })

  it('reads only what the same person saved in the same company', () => {
    const owner = recentRecordsOwner(3, 9)
    const cookie = { owner: owner!, items: [{ id: 5, name: 'x' }, { id: -1, name: 'bad' }, { id: 6, name: 7 as unknown as string }] }
    expect(savedRecentRecords(cookie, owner)).toEqual([{ id: 5, name: 'x' }])
    expect(savedRecentRecords(cookie, recentRecordsOwner(3, 10))).toEqual([])
    expect(savedRecentRecords(cookie, null)).toEqual([])
    expect(savedRecentRecords(null, owner)).toEqual([])
  })
})
