/*
 * The one rule of in-place editing: what a draft becomes when the reader leaves the field.
 * A trimmed draft that is empty (unless allowed) or equal to the saved value is dropped (null);
 * anything else is the value to save.
 */
export function resolveInlineDraft(draft: string, saved: string, allowEmpty = false): string | null {
  const value = draft.trim()
  if (!value && !allowEmpty) return null
  return value === saved ? null : value
}
