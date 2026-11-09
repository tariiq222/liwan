/*
 * A select or select menu that reads as plain text (a record's property): no box, no chevron, a soft fill on hover
 * and focus. It is still the button that opens the list, so it stays keyboard accessible. Use with `variant="none"`.
 */
export const plainSelectUi = {
  base: 'h-auto min-h-0 w-fit max-w-full -mx-1.5 rounded-inner bg-transparent px-1.5 py-0.5 text-sm font-normal text-highlighted ring-0 hover:bg-elevated focus-visible:bg-elevated focus-visible:ring-2 focus-visible:ring-primary',
  trailing: 'hidden',
  placeholder: 'text-muted',
} as const
