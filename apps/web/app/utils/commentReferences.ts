// `@` mentions a person and `/` references a task of the same conversation.
// The comment body stays plain text; these helpers find the token being typed,
// write a picked suggestion into the text, and decide which picked references
// are still present when the comment is sent.
export type CommentReferenceKind = 'person' | 'task'
export interface CommentReference { kind: CommentReferenceKind, id: number, label: string }
export interface CommentTrigger { kind: CommentReferenceKind, start: number, end: number, query: string }

const SYMBOL: Record<CommentReferenceKind, string> = { person: '@', task: '/' }
const MAX_QUERY = 40

// A trigger opens at the start of the text or after whitespace, so an email
// address or a URL path never opens the menu, and it closes on a new line.
export function activeCommentTrigger(text: string, caret: number): CommentTrigger | null {
  const before = text.slice(0, caret)
  const match = /(^|\s)([@/])([^\n@/]*)$/.exec(before)
  if (!match) return null
  const query = match[3] ?? ''
  if (query.length > MAX_QUERY || query.startsWith(' ')) return null
  return { kind: match[2] === '@' ? 'person' : 'task', start: caret - query.length - 1, end: caret, query }
}

export function insertCommentReference(text: string, trigger: CommentTrigger, reference: CommentReference): { text: string, caret: number } {
  const token = `${SYMBOL[reference.kind]}${reference.label} `
  return { text: text.slice(0, trigger.start) + token + text.slice(trigger.end), caret: trigger.start + token.length }
}

export function declaredReferences(text: string, picked: CommentReference[]): { mentions: number[], taskRefs: number[] } {
  const present = picked.filter(reference => text.includes(`${SYMBOL[reference.kind]}${reference.label}`))
  const ids = (kind: CommentReferenceKind) => [...new Set(present.filter(reference => reference.kind === kind).map(reference => reference.id))]
  return { mentions: ids('person'), taskRefs: ids('task') }
}
