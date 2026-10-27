import type { JournalEntry } from '@webvue/contracts'

type Can = (capability: string) => boolean

interface EntryActionSet {
  post: boolean
  /** A draft's header and lines can still change; a posted entry stays read-only. */
  edit: boolean
  resetToDraft: boolean
  unreconcile: boolean
  delete: boolean
}

/** What the record page offers: the entry's state decides what is possible, the capabilities decide who may. */
export function entryActions(entry: Pick<JournalEntry, 'state'>, can: Can): EntryActionSet {
  const draft = entry.state === 'draft'
  const posted = entry.state === 'posted'
  const post = can('finance.entries.post')
  const manage = can('finance.entries.manage')
  return {
    post: draft && post,
    edit: draft && manage,
    resetToDraft: posted && post,
    unreconcile: posted && post,
    delete: draft && manage,
  }
}
