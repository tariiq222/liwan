/**
 * Keep an editor's local body draft while an older server response catches up.
 * Once the response contains the pending body, it is the acknowledgement and
 * may be applied normally.
 */
export function shouldApplyDocumentBodyModel(
  editorHtml: string,
  incomingHtml: string,
  pendingDraft: string | null,
): boolean {
  if (pendingDraft === null || incomingHtml === pendingDraft) return true
  return editorHtml !== pendingDraft
}
