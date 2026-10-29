import { describe, expect, it } from 'vitest'
import { PEOPLE_ENDPOINT, peopleSearch } from '../usePeople'

describe('peopleSearch', () => {
  it('searches /api/v1/people by default and drops an empty query', () => {
    expect(peopleSearch(PEOPLE_ENDPOINT, '')).toEqual({ key: ['people', '/api/v1/people', ''], query: { q: undefined, limit: 50 } })
    expect(peopleSearch(PEOPLE_ENDPOINT, 'sara').query).toEqual({ q: 'sara', limit: 50 })
  })

  it('keeps the results of another endpoint apart in the cache', () => {
    expect(peopleSearch('/api/v1/crm/agents', 'sara').key).not.toEqual(peopleSearch(PEOPLE_ENDPOINT, 'sara').key)
  })
})
