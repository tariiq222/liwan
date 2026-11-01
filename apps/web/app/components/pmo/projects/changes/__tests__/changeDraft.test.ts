import { describe, expect, it } from 'vitest'
import type { ProjectChange } from '@liwan/contracts'
import { NO_CATEGORY, useChangeDraft } from '../changeDraft'

const item = (overrides: Partial<ProjectChange> = {}): ProjectChange => ({
  id: 4, project_id: 7, number: 1, title: 'Add a report', description: 'd', reason: 'r', category: { id: 6, name: 'Regulatory (archived)' },
  state: 'draft', requester: { id: 5, name: 'Sara' }, impact_schedule_days: 3, impact_cost: 10.5, currency: null, impact_scope: 's',
  decided_by: null, decided_at: null, decision_note: '', implemented_at: null, created_at: '2026-11-01T10:00:00Z', updated_at: 'v1',
  can_edit: true, can_submit: true, can_withdraw: true, can_decide: false, can_implement: false, ...overrides,
})

describe('change request draft', () => {
  it('does not resend an unchanged category, so an archived one is never reassigned', () => {
    const draft = useChangeDraft(item())
    draft.title.value = 'Add a better report'
    expect(draft.body()).not.toHaveProperty('category_id')
    expect(draft.body().title).toBe('Add a better report')
  })

  it('sends the category once the user picks another, or clears it', () => {
    const draft = useChangeDraft(item())
    draft.categoryId.value = '3'
    expect(draft.body().category_id).toBe(3)
    draft.categoryId.value = NO_CATEGORY
    expect(draft.body().category_id).toBeNull()
    draft.categoryId.value = '6'
    expect(draft.body()).not.toHaveProperty('category_id')
  })

  it('keeps the token it opened with while the live record moves on', () => {
    const live = item()
    const draft = useChangeDraft(live)
    // Another tab saved, and the window-focus refetch replaced the record: the draft must not follow it.
    Object.assign(live, item({ updated_at: 'v2', title: 'Edited elsewhere' }))
    draft.title.value = 'My edit'
    expect(draft.token.value).toBe('v1')
    expect(draft.body().title).toBe('My edit')
    expect(draft.dirty.value).toBe(true)
  })

  it('takes the server values and the new token only on an explicit reload', () => {
    const draft = useChangeDraft(item())
    draft.title.value = 'My edit'
    draft.reload(item({ updated_at: 'v2', title: 'Edited elsewhere', category: null }))
    expect(draft.title.value).toBe('Edited elsewhere')
    expect(draft.token.value).toBe('v2')
    expect(draft.dirty.value).toBe(false)
    expect(draft.body()).not.toHaveProperty('category_id')
  })

  it('has no token for a new request', () => {
    const draft = useChangeDraft()
    expect(draft.token.value).toBeUndefined()
    draft.categoryId.value = '2'
    expect(draft.body().category_id).toBe(2)
  })
})
