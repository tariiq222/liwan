import { describe, expect, it } from 'vitest'
import type { InboxBusinessProfile } from '@webvue/contracts'
import { InboxBusinessProfilePatchSchema } from '@webvue/contracts'
import { changedProfileFields, draftPatch, mergeDraft, profileErrors, profileToDraft } from '../inboxProfile'

const PROFILE: InboxBusinessProfile = {
  about: 'عيادة', address: 'الرياض', description: null, email: 'a@b.test', websites: ['https://a.test'], vertical: 'health', picture_url: null,
}
const base = profileToDraft(PROFILE)

describe('business profile draft', () => {
  it('turns a profile into form fields with empty strings for nothing', () => {
    expect(base).toEqual({ about: 'عيادة', address: 'الرياض', description: '', email: 'a@b.test', website1: 'https://a.test', website2: '', vertical: 'health' })
  })

  it('sends only the changed fields, and every websites change as the whole list', () => {
    expect(draftPatch(base, base)).toEqual({})
    expect(draftPatch(base, { ...base, about: ' جديد ' })).toEqual({ about: 'جديد' })
    expect(draftPatch(base, { ...base, website2: 'https://b.test' })).toEqual({ websites: ['https://a.test', 'https://b.test'] })
    expect(draftPatch(base, { ...base, website1: '' })).toEqual({ websites: [] })
  })

  it('clears with the empty string, a cleared vertical is null, and the result passes the contract', () => {
    const patch = draftPatch(base, { ...base, address: '', email: '', vertical: '' })
    expect(patch).toEqual({ address: '', email: '', vertical: null })
    expect(InboxBusinessProfilePatchSchema.safeParse(patch).success).toBe(true)
  })

  it('finds the fields Meta would refuse at its exact limits', () => {
    expect(profileErrors(base, { ...base, about: 'x'.repeat(139) }).size).toBe(0)
    expect([...profileErrors(base, { ...base, about: 'x'.repeat(140) })]).toEqual(['about'])
    expect([...profileErrors(base, { ...base, about: '' })]).toEqual(['about'])
    expect([...profileErrors(base, { ...base, address: 'x'.repeat(257) })]).toEqual(['address'])
    expect(profileErrors(base, { ...base, address: 'x'.repeat(256) }).size).toBe(0)
    expect([...profileErrors(base, { ...base, description: 'x'.repeat(513) })]).toEqual(['description'])
    expect([...profileErrors(base, { ...base, email: 'not-an-email' })]).toEqual(['email'])
    expect([...profileErrors(base, { ...base, email: `${'x'.repeat(125)}@b.co` })]).toEqual(['email'])
    expect([...profileErrors(base, { ...base, website1: 'ftp://x.test' })]).toEqual(['website1'])
    expect(profileErrors(base, { ...base, website2: 'http://ok.test' }).size).toBe(0)
  })

  it('does not flag an untouched empty about text', () => {
    const empty = profileToDraft({ ...PROFILE, about: null })
    expect(profileErrors(empty, empty).size).toBe(0)
    expect(changedProfileFields(empty, empty)).toEqual([])
  })

  it('keeps what the user is typing when a fresh profile arrives, and takes the rest', () => {
    const typing = { ...base, about: 'قيد الكتابة' }
    const fresh = profileToDraft({ ...PROFILE, description: 'وصف جديد', about: 'نبذة من ميتا' })
    expect(mergeDraft(typing, base, fresh)).toEqual({ ...fresh, about: 'قيد الكتابة' })
    expect(mergeDraft(base, base, fresh)).toEqual(fresh)
  })
})
