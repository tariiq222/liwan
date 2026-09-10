export default defineAppConfig({
  ui: {
    colors: { primary: 'brand', secondary: 'brand2', neutral: 'zinc' },
    button: {
      slots: { base: 'min-h-9 rounded-lg font-medium' },
      variants: { square: { true: 'preview-icon-button' } },
      compoundVariants: [
        { color: 'primary', variant: 'solid', class: { base: 'preview-primary-solid' } },
        { color: 'secondary', variant: 'solid', class: { base: 'preview-secondary-solid' } },
      ],
    },
    input: { slots: { base: 'preview-field min-h-10 rounded-lg' } },
    inputNumber: { slots: { base: 'preview-field min-h-10 rounded-lg' } },
    select: { slots: { base: 'preview-field min-h-10 rounded-lg', content: 'z-[var(--preview-z-menu)]' } },
    popover: { slots: { content: 'z-[var(--preview-z-menu)]' } },
    calendar: { slots: { root: 'preview-calendar', cellTrigger: 'rounded-lg m-0' } },
    textarea: { slots: { base: 'preview-field rounded-lg leading-relaxed' } },
    card: { slots: { root: 'rounded-xl shadow-none', header: 'px-5 py-4', body: 'p-5', footer: 'px-5 py-4' } },
    table: { slots: { th: 'text-start font-medium text-muted', td: 'text-start py-4', tr: 'hover:bg-elevated/40' } },
    progress: { defaultVariants: { size: 'md' } },
    slideover: {
      slots: {
        content: 'z-[var(--preview-z-sheet)]',
        header: 'px-6 py-5', body: 'px-6 py-5', footer: 'px-6 py-4',
      },
    },
    modal: { slots: { content: 'z-[80] rounded-xl', overlay: 'z-[79]' } },
  },
})
