export default defineAppConfig({
  ui: {
    colors: { primary: 'brand', secondary: 'brand2', neutral: 'zinc' },
    button: {
      // Ranks: primary solid = one main action; neutral outline = cancel/back/print/close/pager;
      // ghost = tertiary; error = destroy. Do not use secondary solid for chrome.
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
    selectMenu: { slots: { base: 'nasq-ui-field min-h-10 rounded-lg', content: 'z-[var(--nasq-ui-z-menu)] nasq-elevation-3', item: 'data-[state=checked]:nasq-ui-selected' } },
    dropdownMenu: { slots: { content: 'z-[var(--nasq-ui-z-menu)] nasq-elevation-3' } },
    tooltip: { slots: { content: 'z-[var(--nasq-ui-z-menu)] nasq-elevation-2' } },
    popover: { slots: { content: 'z-[var(--nasq-ui-z-menu)] nasq-elevation-3' } },
    select: { slots: { base: 'nasq-ui-field min-h-10 rounded-lg', content: 'z-[var(--nasq-ui-z-menu)] nasq-elevation-3', item: 'data-[state=checked]:nasq-ui-selected' } },
    calendar: { slots: { root: 'nasq-ui-calendar', cellTrigger: 'rounded-lg m-0' } },
    textarea: { slots: { base: 'nasq-ui-field rounded-lg leading-relaxed' } },
    card: { slots: { root: 'rounded-xl nasq-elevation-1', header: 'nasq-ui-card-header px-5 py-4', body: 'p-5', footer: 'px-5 py-4' } },
    table: {
      slots: {
        thead: 'nasq-ui-table-head',
        th: 'text-start text-xs font-medium text-muted px-4 py-3',
        td: 'text-start px-4 py-3.5 text-default',
        tr: 'hover:bg-elevated/40 data-[selected=true]:nasq-ui-selected transition-colors',
      },
    },
    progress: { slots: { root: 'nasq-ui-progress' }, defaultVariants: { size: 'md' } },
    badge: { slots: { base: 'font-medium' } },
    slideover: {
      slots: {
        content: 'z-[var(--nasq-ui-z-sheet)] nasq-elevation-4',
        header: 'px-6 py-5', body: 'px-6 py-5', footer: 'px-6 py-4',
      },
    },
    modal: { slots: { content: 'z-[80] rounded-xl nasq-elevation-4', overlay: 'z-[79]' } },
  },
})
