import type { JournalEntry } from '@webvue/contracts'

type Can = (capability: string) => boolean

export interface EntryActionSet {
  post: boolean
  resetToDraft: boolean
  unreconcile: boolean
  delete: boolean
}

/** What the record page offers: the entry's state decides what is possible, the capabilities decide who may. */
export function entryActions(entry: Pick<JournalEntry, 'state'>, can: Can): EntryActionSet {
  const draft = entry.state === 'draft'
  const posted = entry.state === 'posted'
  const post = can('finance.entries.post')
  return {
    post: draft && post,
    resetToDraft: posted && post,
    unreconcile: posted && post,
    delete: draft && can('finance.entries.manage'),
  }
}
