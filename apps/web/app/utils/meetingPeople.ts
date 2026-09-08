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
