export type AuditDiffLine = { text: string; changed: boolean }

const lines = (value: unknown) => JSON.stringify(value ?? null, null, 2).split('\n')

/**
 * Pretty-print the two sides of an audit event line by line. A line is `changed` when the other side has no identical
 * line, so removed values stand out on `before` and added ones on `after`. A missing side (null) marks nothing.
 */
export function auditDiffLines(before: unknown, after: unknown): { before: AuditDiffLine[]; after: AuditDiffLine[] } {
  const beforeLines = lines(before)
  const afterLines = lines(after)
  const mark = (own: string[], other: string[], ownValue: unknown, otherValue: unknown): AuditDiffLine[] => {
    const known = new Set(other)
    const comparable = (ownValue ?? null) !== null && (otherValue ?? null) !== null
    return own.map((text) => ({ text, changed: comparable && !known.has(text) }))
  }
  return { before: mark(beforeLines, afterLines, before, after), after: mark(afterLines, beforeLines, after, before) }
}
