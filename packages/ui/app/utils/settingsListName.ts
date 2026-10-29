/**
 * The name to save after an edit of a settings list row's name input, or null when nothing should be saved. An emptied
 * input gets the stored name back, so the row never shows a name the server does not hold.
 */
export function committedName(input: HTMLInputElement, stored: string): string | null {
  const name = input.value.trim()
  if (!name) {
    input.value = stored
    return null
  }
  return name === stored ? null : name
}
