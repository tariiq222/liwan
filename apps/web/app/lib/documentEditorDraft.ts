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

import type { DocumentDetail, DocumentPatch } from '@webvue/contracts'
type EditableDocument = Pick<DocumentDetail, 'id' | 'revision' | 'name' | 'body' | 'expiry_date' | 'context' | 'tags'>
/** Receive once per record; refreshed server state never overwrites an open draft. */
export function createDocumentDraft() {
  return {
    id: 0, revision: 0, name: '', body: '', expiry_date: null as string | null,
    context: null as { kind: string; id: number } | null, tag_ids: [] as number[], baseline: '',
    receive(document: EditableDocument) { if (this.id !== document.id) this.reload(document) },
    reload(document: EditableDocument) {
      this.id = document.id; this.revision = document.revision; this.name = document.name; this.body = document.body
      this.expiry_date = document.expiry_date; this.context = document.context ? { kind: document.context.kind, id: document.context.id } : null
      this.tag_ids = document.tags.map(tag => tag.id); this.baseline = JSON.stringify(this.values())
    },
    values() { return { name: this.name.trim(), body: this.body, expiry_date: this.expiry_date || null, context: this.context, tag_ids: [...this.tag_ids] } },
    patch(): DocumentPatch {
      const saved = JSON.parse(this.baseline || '{}') as Record<string, unknown>
      const changes = Object.fromEntries(Object.entries(this.values()).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(saved[key])))
      return { expected_revision: this.revision, ...changes } as DocumentPatch
    },
    isDirty() { return this.id !== 0 && JSON.stringify(this.values()) !== this.baseline },
  }
}
