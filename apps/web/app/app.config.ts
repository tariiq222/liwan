export default defineAppConfig({
  ui: {
    colors: { primary: 'brand', secondary: 'brand', neutral: 'zinc' },
    button: {
      // Ranks: primary solid = one main action; neutral outline = cancel/back/print/close/pager;
      // ghost = tertiary; error = destroy. Use neutral for chrome.
      slots: { base: 'min-h-8 rounded-md font-medium' },
      variants: { square: { true: 'nasq-ui-icon-button' } },
      compoundVariants: [
        { color: 'primary', variant: 'solid', class: { base: 'nasq-ui-primary-solid' } },
        { color: 'primary', variant: ['outline', 'soft', 'subtle', 'ghost', 'link'], class: { base: 'nasq-ui-primary-text' } },
        { color: 'secondary', variant: 'solid', class: { base: 'nasq-ui-primary-solid' } },
        { color: 'secondary', variant: ['outline', 'soft', 'subtle', 'ghost', 'link'], class: { base: 'nasq-ui-primary-text' } },
      ],
    },
    input: { slots: { base: 'nasq-ui-field min-h-8 rounded-md' } },
    inputNumber: { slots: { base: 'nasq-ui-field min-h-8 rounded-md' } },
    selectMenu: { slots: { base: 'nasq-ui-field min-h-8 rounded-md', content: 'z-[var(--nasq-ui-z-menu)] nasq-elevation-3', item: 'data-[state=checked]:nasq-ui-selected' } },
    dropdownMenu: { slots: { content: 'z-[var(--nasq-ui-z-menu)] nasq-elevation-3' } },
    tooltip: { slots: { content: 'z-[var(--nasq-ui-z-menu)] nasq-elevation-2' } },
    popover: { slots: { content: 'z-[var(--nasq-ui-z-menu)] nasq-elevation-3' } },
    select: { slots: { base: 'nasq-ui-field min-h-8 rounded-md', content: 'z-[var(--nasq-ui-z-menu)] nasq-elevation-3', item: 'data-[state=checked]:nasq-ui-selected' } },
    calendar: { slots: { root: 'nasq-ui-calendar', cellTrigger: 'rounded-md m-0' } },
    textarea: { slots: { base: 'nasq-ui-field rounded-md leading-relaxed' } },
    // Content surfaces are hairline: shadows belong to floating layers only.
    card: { slots: { root: 'rounded-lg border border-default', header: 'nasq-ui-card-header px-4 py-3', body: 'p-4', footer: 'px-4 py-3' } },
    table: {
      slots: {
        thead: 'nasq-ui-table-head',
        th: 'text-start text-xs font-medium text-muted px-3 py-2 whitespace-nowrap',
        td: 'text-start px-3 py-2 text-default',
        tr: 'hover:bg-surface-hover data-[selected=true]:nasq-ui-selected transition-colors',
      },
    },
    progress: { slots: { root: 'nasq-ui-progress' }, defaultVariants: { size: 'md' } },
    badge: { slots: { base: 'font-medium rounded-md' } },
    slideover: {
      slots: {
        content: 'z-[var(--nasq-ui-z-sheet)] nasq-elevation-4',
        header: 'px-6 py-5', body: 'px-6 py-5', footer: 'px-6 py-4',
      },
    },
    modal: { slots: { content: 'z-[80] rounded-xl nasq-elevation-4', overlay: 'z-[79]' } },
  },
})
