export type MeetingPerson = { id: number; name: string }

export function mergeMeetingPeople(input: {
  selectedIds: number[]
  secretaryId: number | null
  known: MeetingPerson[]
  results: MeetingPerson[]
}): MeetingPerson[] {
  const people = new Map<number, string>()
  for (const person of input.known) people.set(person.id, person.name)
  for (const person of input.results) people.set(person.id, person.name)
  for (const id of [...input.selectedIds, ...(input.secretaryId ? [input.secretaryId] : [])]) {
    if (!people.has(id)) people.set(id, String(id))
  }
  return [...people.entries()].map(([id, name]) => ({ id, name }))
}

export function splitMeetingPeople(input: {
  selectedIds: number[]
  secretaryId: number | null
  known: MeetingPerson[]
  results: MeetingPerson[]
  limit?: number
}) {
  const merged = mergeMeetingPeople(input)
  const selectedSet = new Set(input.selectedIds)
  const selected = input.selectedIds.map(id => merged.find(person => person.id === id) ?? { id, name: String(id) })
  const results = input.results.filter(person => !selectedSet.has(person.id)).slice(0, input.limit ?? 50)
  const visiblePeople = [...input.known, ...results]
  const secretaryIds = new Set<number>([
    ...visiblePeople.map(person => person.id),
    ...input.selectedIds,
    ...(input.secretaryId ? [input.secretaryId] : []),
  ])
  const secretary = [...secretaryIds].map(id => merged.find(person => person.id === id) ?? { id, name: String(id) })
  return { selected, results, secretary }
}
