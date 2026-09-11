export default defineAppConfig({
  ui: {
    colors: { primary: 'brand', secondary: 'brand2', neutral: 'zinc' },
    button: {
      slots: { base: 'min-h-9 rounded-lg font-medium' },
      variants: { square: { true: 'nasq-ui-icon-button' } },
      compoundVariants: [
        { color: 'primary', variant: 'solid', class: { base: 'nasq-ui-primary-solid' } },
        { color: 'primary', variant: ['outline', 'soft', 'subtle', 'ghost', 'link'], class: { base: 'nasq-ui-primary-text' } },
        { color: 'secondary', variant: 'solid', class: { base: 'nasq-ui-secondary-solid' } },
        { color: 'secondary', variant: ['outline', 'soft', 'subtle', 'ghost', 'link'], class: { base: 'nasq-ui-secondary-text' } },
      ],
    },
    input: { slots: { base: 'nasq-ui-field min-h-10 rounded-lg' } },
    inputNumber: { slots: { base: 'nasq-ui-field min-h-10 rounded-lg' } },
    select: { slots: { base: 'nasq-ui-field min-h-10 rounded-lg', content: 'z-[var(--nasq-ui-z-menu)]' } },
    selectMenu: { slots: { base: 'nasq-ui-field min-h-10 rounded-lg', content: 'z-[var(--nasq-ui-z-menu)]' } },
    dropdownMenu: { slots: { content: 'z-[var(--nasq-ui-z-menu)]' } },
    tooltip: { slots: { content: 'z-[var(--nasq-ui-z-menu)]' } },
    popover: { slots: { content: 'z-[var(--nasq-ui-z-menu)]' } },
    calendar: { slots: { root: 'nasq-ui-calendar', cellTrigger: 'rounded-lg m-0' } },
    textarea: { slots: { base: 'nasq-ui-field rounded-lg leading-relaxed' } },
    card: { slots: { root: 'rounded-xl shadow-none', header: 'nasq-ui-card-header px-5 py-4', body: 'p-5', footer: 'px-5 py-4' } },
    table: {
      slots: {
        thead: 'nasq-ui-table-head',
        th: 'text-start text-xs font-medium text-muted px-4 py-3',
        td: 'text-start px-4 py-3.5 text-default',
        tr: 'hover:bg-elevated/40 transition-colors',
      },
    },
    progress: { defaultVariants: { size: 'md' } },
    slideover: {
      slots: {
        content: 'z-[var(--nasq-ui-z-sheet)]',
        header: 'px-6 py-5', body: 'px-6 py-5', footer: 'px-6 py-4',
      },
    },
    modal: { slots: { content: 'z-[80] rounded-xl', overlay: 'z-[79]' } },
  },
})
