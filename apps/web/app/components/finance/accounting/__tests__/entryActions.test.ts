import { describe, expect, it } from 'vitest'
import { entryActions } from '../entryActions'

const ALL = new Set(['finance.entries.read', 'finance.entries.manage', 'finance.entries.post'])
const can = (capability: string) => ALL.has(capability)
const none = () => false

describe('entry actions by state', () => {
  it('a draft can be posted, edited and deleted', () => {
    expect(entryActions({ state: 'draft' }, can)).toEqual({ post: true, edit: true, resetToDraft: false, unreconcile: false, delete: true })
  })

  it('a posted entry is read-only: it can be reset or unreconciled', () => {
    expect(entryActions({ state: 'posted' }, can)).toEqual({ post: false, edit: false, resetToDraft: true, unreconcile: true, delete: false })
  })

  it('a cancelled entry offers nothing', () => {
    expect(entryActions({ state: 'cancel' }, can)).toEqual({ post: false, edit: false, resetToDraft: false, unreconcile: false, delete: false })
  })
})

describe('entry actions by capability', () => {
  it('posting needs the post capability, editing and deleting the manage one', () => {
    expect(entryActions({ state: 'draft' }, none)).toEqual({ post: false, edit: false, resetToDraft: false, unreconcile: false, delete: false })
    expect(entryActions({ state: 'draft' }, c => c === 'finance.entries.manage')).toMatchObject({ post: false, edit: true, delete: true })
    expect(entryActions({ state: 'posted' }, c => c === 'finance.entries.manage')).toMatchObject({ resetToDraft: false, unreconcile: false })
  })
})
