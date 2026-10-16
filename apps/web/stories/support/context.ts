// Every component story cites the real parent it copies, so its size matches the app.
export function storyContext(ref: string, note?: string) {
  const source = ref === 'unused' ? 'غير مستخدم حاليًا' : `السياق: \`${ref}\``
  return { webvueContext: ref, docs: { description: { story: note ? `${note}\n\n${source}` : source } } }
}
